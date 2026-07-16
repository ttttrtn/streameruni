const fetch = require('node-fetch');

const HELIX_BASE = 'https://api.twitch.tv/helix';

class TwitchClient {
  constructor({ clientId, accessToken }) {
    if (!clientId || !accessToken) {
      throw new Error('TwitchClient requires clientId and accessToken');
    }
    this.clientId = clientId;
    this.accessToken = accessToken;
  }

  get _headers() {
    return {
      'Client-Id': this.clientId,
      Authorization: `Bearer ${this.accessToken}`,
    };
  }

  async _get(path, params = {}) {
    const url = new URL(`${HELIX_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }

    const res = await fetch(url.toString(), { headers: this._headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Twitch API error ${res.status} on ${path}: ${body}`);
    }
    return res.json();
  }

  /**
   * Search Twitch categories/games by name and return the best match.
   * Uses GET /helix/search/categories
   */
  async findCategoryByName(name) {
    const data = await this._get('/search/categories', { query: name });
    const results = data.data || [];
    // Prefer an exact case-insensitive match, otherwise first result.
    const exact = results.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    return exact || results[0] || null;
  }

  /**
   * Get all live streams for a given game/category id, handling pagination.
   * GET /helix/streams?game_id=...
   */
  async getLiveStreamsForCategory(gameId, { maxPages = 5 } = {}) {
    let streams = [];
    let cursor;
    let page = 0;

    do {
      const data = await this._get('/streams', {
        game_id: gameId,
        first: 100,
        after: cursor,
      });
      streams = streams.concat(data.data || []);
      cursor = data.pagination && data.pagination.cursor;
      page += 1;
    } while (cursor && page < maxPages);

    return streams;
  }
}

module.exports = { TwitchClient };
