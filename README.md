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
- Click a satellite marker or a row in the watchlist to inspect it. Use a row's crosshair or **Center & follow satellite** to view it directly from above, keeping Earth centered and rotating the viewpoint with the satellite, in live mode and replay. Zoom remains available; stop following to rotate the camera freely; **Reset camera** returns to Earth.
- Select a satellite and choose **Go onboard** in the left-side view controls to ride at its interpolated position. Drag with a mouse or touch to look around; after clicking the view, arrow keys also turn your gaze. Scroll or use `+` / `−` to change the field of view. **Look ahead** restores the initial view toward the orbital horizon, **Earth** looks straight down, and **Space** looks away from Earth. **Return to Earth view**, **Reset camera**, or Escape while the view has focus exits onboard mode. Onboard viewing works in live mode and paused, forward or reverse replay. Its frame uses the orbital direction and radial up; it does not represent measured spacecraft attitude. The ridden satellite's marker, label and path are hidden to keep the view clear. Other satellites remain visible, and selecting another satellite transfers the view to it.
- Use **View controls** inside the orbital view along its left edge for camera zoom/reset, orbits, labels, recent paths, sunlight and the geographic grid. History playback and follow status are there too, leaving the globe unobstructed. Click the panel heading to minimize it into a compact button or expand it again; this preference is remembered in your browser.
- Under **Earth style**, switch between NASA **Imagery**, **Natural Earth**, **Gray Earth**, and a dark **Country map**. Optional **Country borders** and **Country names** work with every style. Your choice is saved in this browser. Textures are bundled locally and consume no N2YO requests. Turn off **Sunlight** for even map illumination; map styles also retain some night-side brightness to keep geography readable.
- Use each row's eye to show or hide a satellite; use its `×` to remove it. The watchlist is saved in this browser.
- Earth and orbital distances use the same scale. Satellite markers are enlarged so they remain visible; they do not represent actual spacecraft size or attitude.

## Motion and API usage

N2YO supplies **TLE orbital elements**. A browser worker runs SGP4/SDP4 twice per second and calculates bracketing positions and velocities. The renderer uses cubic Hermite interpolation between them, including during accelerated or reverse playback. Earth rotation, sunlight, camera following and latitude/longitude calculations share the same simulation clock. New element sets are visually blended to avoid position jumps.

The app currently uses only N2YO's `tle` endpoint, documented at **1,000 requests per rolling hour**. It never polls satellite positions for animation. Default cache lifetime is **6 hours**: 50 satellites need 50 initial fetches and about 200 fetches per day during continuous use. Selecting cached satellites, typing in search and opening another tab do not create duplicate upstream requests.

The server:

- Persists cached elements, an append-only archive of every successful TLE fetch and its source response, and request timestamps in `.data/tracker.sqlite`.
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

## History and replay

Open **History & replay** along the left edge of the orbital view under **View controls**. Drag the timeline, enter a UTC date/time, or step backward/forward a minute. Play, pause, or choose a speed from −60× to 60×. **Return to live** restores the current time; forward playback also returns to live when it catches up, and reverse playback pauses at the beginning of saved history.

Every successful N2YO fetch is retained as a separate, timestamped snapshot, even if its TLE is unchanged. Refreshing the latest cache never overwrites previous history. Each new snapshot also stores the successful source response (`info` and `tle`); credentials and request URLs are never archived. Cached reads do not create duplicates. Existing cached elements are automatically migrated into the archive on startup, without deleting or refetching them. Historical raw responses from before this upgrade cannot be recovered, but their cached element data is retained.

For a requested time, replay uses each satellite's **last snapshot fetched at or before that time**. Satellites not yet recorded are hidden and marked “Not yet recorded”; the app never substitutes a later TLE and presents it as historical data. When playback crosses a saved snapshot boundary, it loads the corresponding element set automatically. Satellite positions, labels, Earth lighting, telemetry and camera following all use the replay clock.

Replayed positions are reconstructed predictions from saved TLEs, rather than recordings of actual spacecraft telemetry. Storing the source elements allows arbitrary-time playback without saving millions of rendered positions. Replay reads only the local database and makes no additional N2YO requests. The normal live cache refresh can continue in the background while the app is open.

The archive has no automatic expiration. Recording occurs when the running app fetches data; closing the app does not continue unattended collection. History predating the first saved fetch cannot be backfilled from N2YO's current-TLE endpoint. The local database and backups remain outside Git. To back up the archive yourself, stop the local server and copy the `.data/` directory.

Local, read-only history endpoints:

- `GET /api/history?ids=25544,20580` — available ranges and snapshot counts. Omitting `ids` lists all archived satellites.
- `GET /api/history/elements?ids=25544,20580&at=<unix-milliseconds>` — elements known at that UTC instant, missing satellite IDs, and the time interval for which the result applies.

Historical request timestamps are retained; only those within the rolling hour count toward the active quota.

## Search catalogue

Name search uses a bundled **CelesTrak active-satellite catalogue**, initially containing 15,928 entries, supplemented with previously archived satellite names. It is independent of N2YO and consumes no N2YO requests. It is a dated snapshot, rather than a live list of every object in orbit. Display names for the ten starter satellites include familiar aliases such as “ISS” and “Hubble”.

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

Tests cover rolling quotas through restarts, duplicate requests, stale-data fallback, upstream rate limits, credential loading, Alpha-5 IDs, the Vallado SGP4 reference case, orbital coordinates, database migration, historical snapshot boundaries, pause/seek/reverse clocks, and interpolation error through 60× playback. Automated tests use mocked N2YO responses and consume no real API requests.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Watchlist, catalogue search, controls and telemetry |
| `src/Scene.tsx` | Earth shader, atmosphere, orbits, markers and camera |
| `src/engine.worker.ts` | Local orbital calculations |
| `src/Timeline.tsx`, `src/useArchive.ts` | Historical playback controls and database reads |
| `shared/clock.ts` | Simulation clock and orbit interpolation |
| `shared/orbits.ts` | Propagation, units and coordinate conventions |
| `server/n2yo.ts` | Cached N2YO client, validation and request scheduling |
| `server/store.ts` | Persistent SQLite cache, orbital history and rolling quota |

API reference: https://www.n2yo.com/api/

Asset sources and attribution: [ASSETS.md](ASSETS.md).
