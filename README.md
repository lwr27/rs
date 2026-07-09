# osrs-xp-tracker

Polls the OSRS hiscores hourly for a small set of players, records XP gains per skill, and serves a static dashboard via GitHub Pages.

## Setup

1. Create a new GitHub repo and push this folder to it.
2. Edit `data/players.json` with real usernames. `mode` can be `normal`, `ironman`, `hardcore_ironman`, or `ultimate`.
3. In the repo settings, enable **Actions** (should be on by default) and make sure workflow permissions allow "Read and write permissions" (Settings → Actions → General → Workflow permissions) so the tracker can commit snapshots back.
4. In **Settings → Pages**, set source to "Deploy from a branch", branch `main`, folder `/docs`.
5. Trigger the workflow manually once (Actions tab → Track XP → Run workflow) to generate the first `data/latest.json`, then it will run hourly on its own via cron.

## Local test

```
node scripts/track.js
```

Requires Node 18+ (built-in `fetch`).

## Structure

- `scripts/track.js` — fetches hiscores, diffs against the last snapshot, writes history + `latest.json`.
- `data/players.json` — list of tracked usernames.
- `data/snapshots/<username>.json` — append-only XP history per player (bounded to ~30 days of hourly entries).
- `data/latest.json` — current state, consumed by the dashboard.
- `docs/index.html` — minimal static dashboard (no build step).
- `.github/workflows/track.yml` — hourly cron + manual trigger, commits data back to the repo.
