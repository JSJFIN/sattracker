# Orbit — Satellite Tracker

A local 3D satellite tracker built with React, TypeScript and Three.js. Track up to **50 satellites** simultaneously, search by name or NORAD ID, inspect orbital telemetry and follow a satellite around Earth.

## Run locally

Requires **Node.js 24+** and npm.

```sh
npm ci
cp .env.example .env
```

If `.env` already exists, keep it. Add your key to `N2YO_API_KEY=` in that file, then run:

```sh
npm run dev
```

Open **http://127.0.0.1:5174**. The local API listens on `127.0.0.1:3001`; Vite proxies `/api` requests to it. Both servers bind to loopback only. The development port is fixed so an occupied port produces an explicit error.

The backend rereads the API key from `.env` automatically. Other settings require restarting the server. `.env` and the local SQLite cache are excluded from Git. Never put the key in a `VITE_` variable, the browser, or a commit.

Without a key, the app opens in **Demo** mode. Demo uses ten bundled CelesTrak orbital-element snapshots from 19 October 2026 and a corresponding simulated clock. Switch to **Live** after adding a key. Demo and live elements are kept separate.

## Controls

- Drag the globe to orbit the camera; scroll or use `+` / `−` to zoom.
- Choose **Add satellite** to search the local active-satellite catalogue by name, partial name or NORAD ID. A numeric NORAD ID can also be entered directly for objects outside the catalogue.
- Click a satellite marker or a row in the watchlist to inspect it. **Follow satellite** keeps it centered; **Reset camera** returns to Earth.
- Toggle orbits, labels, recent paths, sunlight and the geographic grid below the globe.
- Use each row's eye to show or hide a satellite; use its `×` to remove it. The watchlist is saved in this browser.
- Earth and orbital distances use the same scale. Satellite markers are enlarged so they remain visible; they do not represent actual spacecraft size or attitude.

## Motion and API usage

N2YO supplies **TLE orbital elements**. A browser worker runs SGP4/SDP4 twice per second; the renderer extrapolates position from velocity between worker updates. Earth rotation, sunlight and latitude/longitude calculations use the same UTC clock. New element sets are visually blended to avoid position jumps.

The app currently uses only N2YO's `tle` endpoint, documented at **1,000 requests per rolling hour**. It never polls satellite positions for animation. Default cache lifetime is **6 hours**: 50 satellites need 50 initial fetches and about 200 fetches per day during continuous use. Selecting cached satellites, typing in search and opening another tab do not create duplicate upstream requests.

The server:

- Persists cached elements and request timestamps in `.data/tracker.sqlite`.
- Enforces a rolling budget of **800 attempted requests/hour**, counted before network access and retained through restarts.
- Serializes and spaces upstream requests by at least 1.1 seconds; deduplicates concurrent requests for the same satellite.
- Watches N2YO's reported transaction count and pauses when the configured budget is reached. HTTP 429 pauses upstream requests for one hour.
- Backs off after failed requests and keeps stale cached elements available, with a visible warning.
- Validates element checksums and NORAD IDs, including Alpha-5 TLE catalogue identifiers.

Use a dedicated N2YO key for this app if possible. Its local request counter cannot account continuously for unrelated software using the same key; N2YO's last reported count is also monitored. Predicted positions depend on element age and unmodelled maneuvers. This app does not receive live position or attitude telemetry.

Optional `.env` settings:

| Setting | Default | Range |
| --- | --- | --- |
| `PORT` | `3001` | 1024–65535 |
| `TLE_REFRESH_HOURS` | `6` | 1–24 |
| `N2YO_HOURLY_BUDGET` | `800` | 1–900 |

## Search catalogue

Name search uses a bundled **CelesTrak active-satellite catalogue**, initially containing 15,928 entries. It is independent of N2YO and consumes no N2YO requests. It is a dated snapshot, rather than a live list of every object in orbit. Display names for the ten starter satellites include familiar aliases such as “ISS” and “Hubble”.

To update it manually (at most once a day):

```sh
npm run catalog:update
```

Restart the local API afterward. Updating this catalogue changes names and IDs only; live orbital elements still come from N2YO. The bundled demo snapshot remains fixed.

## Checks and production build

```sh
npm test
npm run build
npm start
```

After building, `npm start` serves the app and API together at **http://127.0.0.1:3001**. Stop the development server first to release the API port.

Tests cover rolling quotas through restarts, duplicate requests, stale-data fallback, upstream rate limits, credential loading, Alpha-5 IDs, the Vallado SGP4 reference case, orbital coordinates and short-term extrapolation error. Automated tests use mocked N2YO responses and consume no real API requests.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Watchlist, catalogue search, controls and telemetry |
| `src/Scene.tsx` | Earth shader, atmosphere, orbits, markers and camera |
| `src/engine.worker.ts` | Local orbital calculations |
| `shared/orbits.ts` | Propagation, units and coordinate conventions |
| `server/n2yo.ts` | Cached N2YO client, validation and request scheduling |
| `server/store.ts` | Persistent SQLite cache and rolling quota |

API reference: https://www.n2yo.com/api/

Asset sources and attribution: [ASSETS.md](ASSETS.md).
