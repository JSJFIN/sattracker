# Asset and data credits

## Earth texture

`public/textures/earth-day.jpg`: NASA Earth Observatory, **Blue Marble: Next Generation**, October 2004 global base map (5400 × 2700), produced by Reto Stöckli / NASA Goddard Space Flight Center.

- Source and downloads: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/
- Exact download: https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-base/october/world.200410.3x5400x2700.jpg
- Credit: **NASA Earth Observatory**.
- Usage guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/

The sphere, atmosphere, orbit paths, starfield and enlarged satellite markers are generated in Three.js. No external 3D spacecraft models are used in this version.

## Satellite data

- **N2YO:** live orbital elements, obtained exclusively by the local backend using the user's API key. https://www.n2yo.com/api/
- **CelesTrak:** active satellite name / NORAD ID catalogue and ten bundled orbital-element examples, retrieved on 19 October 2026. https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle
- Demo playback starts at 19 October 2026 00:00 UTC. It is explicitly labelled as a snapshot and is never presented as current N2YO data.
- The name catalogue contains active satellites; direct numeric NORAD ID entry supports other objects available from N2YO.

## Libraries and typography

- Three.js and React Three Fiber: MIT.
- Satellite.js 6.0.2: MIT, pure JavaScript SGP4/SDP4. Version 6 avoids importing the version 7 WebAssembly worker toolchain for this small workload. https://github.com/shashwatak/satellite-js
- Lucide icons: ISC. https://lucide.dev/license
- DM Sans and Space Grotesk: SIL Open Font License, loaded from Google Fonts with system-font fallbacks. No API credentials are shared with the font service.

Retain upstream license notices when redistributing dependencies.
