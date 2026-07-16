const fs = require('fs');
const path = require('path');

const CATEGORY_NAME = 'Streamer University';
const POLL_INTERVAL_MS = 60 * 1000;
const SIDEBAR_SIZE = 3; // #2-#4

// Minimum viewer-count lead the current #1 must lose by before we switch
// Main to a new streamer, to avoid flapping on near-tied numbers.
const VIRAL_SWITCH_MARGIN = 1.15; // challenger must have >=15% more viewers

function readFallbackStreamers(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  } catch (err) {
    return [];
  }
}

class Director {
  /**
   * @param {TwitchClient} twitchClient
   * @param {object} opts
   * @param {string} opts.streamersFilePath - path to fallback streamers.txt
   * @param {function} opts.logger - logging function, defaults to console.log
   */
  constructor(twitchClient, opts = {}) {
    this.twitch = twitchClient;
    this.streamersFilePath =
      opts.streamersFilePath || path.join(__dirname, 'streamers.txt');
    this.logger = opts.logger || console.log;

    this.categoryId = null;
    this.categoryName = null;
    this.usingFallback = false;

    this.state = {
      liveCount: 0,
      main: null, // { user_login, viewer_count, ... }
      sidebar: [], // array of stream objects
      lastSwitch: null,
      lastUpdated: null,
    };

    this._timer = null;
  }

  /** Kick off discovery + polling loop. */
  start() {
    this._tick(); // run immediately, then every interval
    this._timer = setInterval(() => this._tick(), POLL_INTERVAL_MS);
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  getStatus() {
    return {
      category: this.categoryName || CATEGORY_NAME,
      live_streamers: this.state.liveCount,
      main: this.state.main ? this.state.main.user_login : null,
      viewers: this.state.main ? this.state.main.viewer_count : 0,
      last_switch: this.state.lastSwitch,
    };
  }

  async _tick() {
    try {
      await this._resolveCategory();
      const streams = await this.twitch.getLiveStreamsForCategory(
        this.categoryId
      );
      this._applyStreams(streams);
      this.usingFallback = false;
    } catch (err) {
      this.logger(
        `[DIRECTOR] Category discovery/live lookup failed (${err.message}); falling back to streamers.txt`
      );
      await this._runFallback();
    }
  }

  /** Resolve the "Streamer University" category id, caching it. */
  async _resolveCategory() {
    if (this.categoryId) return;

    const category = await this.twitch.findCategoryByName(CATEGORY_NAME);
    if (!category) {
      throw new Error(`Category "${CATEGORY_NAME}" not found`);
    }
    this.categoryId = category.id;
    this.categoryName = category.name;
  }

  /** Fallback path: pull channel logins from streamers.txt, look them up. */
  async _runFallback() {
    this.usingFallback = true;
    const logins = readFallbackStreamers(this.streamersFilePath);
    if (logins.length === 0) {
      this.logger('[DIRECTOR] Fallback streamers.txt empty or unreadable');
      return;
    }

    try {
      // Best effort: try to fetch live status for fallback channels too,
      // so the dashboard still shows real viewer counts when possible.
      const data = await this.twitch._get('/streams', {
        user_login: logins.slice(0, 100),
      });
      this._applyStreams(data.data || [], { fromFallback: true });
    } catch (err) {
      // Even the fallback lookup failed (e.g. auth down) — just list
      // the channels with no viewer data so the system keeps working.
      const placeholderStreams = logins.map((login) => ({
        user_login: login,
        viewer_count: 0,
      }));
      this._applyStreams(placeholderStreams, { fromFallback: true });
    }
  }

  _applyStreams(streams, { fromFallback = false } = {}) {
    const sorted = [...streams].sort(
      (a, b) => (b.viewer_count || 0) - (a.viewer_count || 0)
    );

    this.state.liveCount = sorted.length;
    this.state.lastUpdated = new Date().toISOString();

    const previousMain = this.state.main;
    const candidateMain = sorted[0] || null;
    const newMain = this._decideMain(previousMain, candidateMain);
    const newSidebar = sorted
      .filter((s) => !newMain || s.user_login !== newMain.user_login)
      .slice(0, SIDEBAR_SIZE);

    const switched =
      !previousMain ||
      !newMain ||
      previousMain.user_login !== newMain.user_login;

    this.state.main = newMain;
    this.state.sidebar = newSidebar;
    if (switched) {
      this.state.lastSwitch = this.state.lastUpdated;
    }

    this._log(fromFallback);
  }

  /**
   * Decide whether to switch Main. Rotation rule: keep the current main
   * unless a new streamer has clearly overtaken them (viral switching),
   * defined as exceeding the current main's viewers by VIRAL_SWITCH_MARGIN,
   * or the current main has gone offline.
   */
  _decideMain(previousMain, candidateMain) {
    if (!candidateMain) return null;
    if (!previousMain) return candidateMain;

    const stillLive = candidateMain && candidateMain.user_login;
    const previousStillListed =
      previousMain &&
      // if previous main isn't in the new stream list, treat as offline
      previousMain.user_login;

    // If the previous main is no longer the top viewer_count entry, check
    // whether the challenger clears the viral-switch margin before swapping.
    if (previousMain.user_login === candidateMain.user_login) {
      return candidateMain; // same person, just refresh viewer count
    }

    const challengerViewers = candidateMain.viewer_count || 0;
    const mainViewers = previousMain.viewer_count || 0;

    if (challengerViewers >= mainViewers * VIRAL_SWITCH_MARGIN) {
      return candidateMain; // viral switch
    }

    // Otherwise keep previous main if still present in candidate list,
    // else fall back to whoever is now #1.
    return previousMain.user_login ? previousMain : candidateMain;
  }

  _log(fromFallback) {
    const { liveCount, main, sidebar } = this.state;
    const lines = [
      '[DIRECTOR]',
      `Found ${liveCount} live ${this.categoryName || CATEGORY_NAME} streams${
        fromFallback ? ' (fallback mode)' : ''
      }`,
    ];
    if (main) {
      lines.push(`Main: ${main.user_login} ${main.viewer_count || 0} viewers`);
    } else {
      lines.push('Main: none live');
    }
    lines.push('Sidebar:');
    if (sidebar.length === 0) {
      lines.push('- (none)');
    } else {
      sidebar.forEach((s) => lines.push(`- ${s.user_login}`));
    }
    this.logger(lines.join('\n'));
  }
}

module.exports = { Director, CATEGORY_NAME, POLL_INTERVAL_MS };
