# Streamer University Director

Automatic category-based director for a "Streamer University" multi-POV stream:
discovers the category on Twitch, polls live streams every 60s, ranks them,
assigns Main/Sidebar, and falls back to `streamers.txt` if Twitch lookups fail.

## Files

- `twitch.js` — Helix API wrapper: category search (`GET /helix/search/categories`)
  and live streams by game id (`GET /helix/streams?game_id=...`), with pagination.
- `director.js` — Core polling loop, ranking (viewer_count DESC), Main/Sidebar
  assignment, viral-switch rule, fallback to `streamers.txt`, and `[DIRECTOR]` logging.
- `server.js` — Express server exposing `GET /api/status`.
- `streamers.txt` — Fallback channel list (one Twitch login per line), used only
  if category search or the streams lookup fails.
- `.env.example` — Copy to `.env` and fill in your Twitch app credentials.

## Setup

```bash
cp .env.example .env
# edit .env with your TWITCH_CLIENT_ID and TWITCH_ACCESS_TOKEN
npm install
node server.js
```

Twitch credentials: create an app at https://dev.twitch.tv/console/apps, then
get an app access token via the OAuth client-credentials flow. The token needs
no special scopes for these public endpoints — a plain app token is enough.

## Behavior

Every 60 seconds:
1. Resolve (and cache) the category id for "Streamer University" via
   `search/categories`.
2. Fetch all live streams for that category id (`streams?game_id=...`),
   paginating through results.
3. Sort by `viewer_count` DESC.
4. Assign `#1` as Main, `#2-#4` as Sidebar.
5. Apply the rotation rule: Main only changes to a new streamer if that
   streamer's viewer count exceeds the current Main's by at least 15%
   (the "viral switch" threshold) — this avoids flapping between near-tied
   streamers. If the previous Main isn't in the live list anymore, Main is
   reassigned to the new #1 automatically.

If category search or the streams request fails for any reason, the system
logs the failure and falls back to `streamers.txt`, looking up those channels'
live status directly by login so the dashboard keeps working with real (or
best-effort) data.

## Dashboard endpoint

`GET /api/status` returns:

```json
{
  "category": "Streamer University",
  "live_streamers": 25,
  "main": "Kai_Cenat",
  "viewers": 60000,
  "last_switch": "2026-07-16T02:40:16.294Z"
}
```

## Logging

Each poll cycle logs:

```
[DIRECTOR]
Found 25 live Streamer University streams
Main: Kai_Cenat 60000 viewers
Sidebar:
- StableRonaldo
- Ludwig
- Fanum
```

## Tuning

- `POLL_INTERVAL_MS` and `SIDEBAR_SIZE` in `director.js`.
- `VIRAL_SWITCH_MARGIN` in `director.js` controls how much bigger a
  challenger's viewer count must be before Main switches (default 1.15 = 15%
  lead required).
