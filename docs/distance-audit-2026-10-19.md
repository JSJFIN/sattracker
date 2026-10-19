# ICEYE-X36 / COSMOS 2612 distance audit

The supplied orbital elements predict approximately **338.5 km** between ICEYE-X36 (NORAD **59103**) and COSMOS 2612 (NORAD **68762**) at **2026-10-19 10:45:35.226 UTC**. There is no kilometer/meter conversion error explaining the discrepancy with the quoted 135-meter claim.

## Independent computation

Both satellites were propagated to the **same UTC instant**. Their different TLE epochs are initial-condition dates, not the times at which their positions were compared.

| Orbital elements | App / satellite.js distance | Independent Python SGP4 distance | Difference |
| --- | ---: | ---: | ---: |
| Cached N2YO TLEs | 338.502359 km | 338.502366 km | 0.0067 m |
| Fresh CelesTrak TLEs | 338.691329 km | 338.691489 km | 0.1603 m |

The reference implementation was `python-sgp4` **2.27**, using `Satrec.twoline2rv` with its default WGS72 gravity model and `sgp4(jd, fractional_day)`. It was installed in an ignored, isolated audit environment. Production code and normal tests require no Python dependency.

The calculation was also checked directly against satellite.js's raw TEME coordinates in kilometers, before any rendering transforms. The scene transformation is an axis permutation/sign change divided by 6378.137 km. It preserves Euclidean distance when that scale is multiplied back. The raw-coordinate and transformed-coordinate calculations agreed to floating-point roundoff.

The public TLE inputs and independent reference outputs are retained in [the regression fixture](../tests/fixtures/distance-reference.json). `npm test` checks agreement within one meter. This tolerance checks the implementations against each other; it does not describe the physical accuracy of the orbital elements.

## Source data

| Source | ICEYE-X36 orbit epoch (UTC) | COSMOS 2612 orbit epoch (UTC) |
| --- | --- | --- |
| Cached N2YO | 2026-10-18 21:58:51.092 | 2026-10-18 23:34:47.631 |
| Fresh CelesTrak | 2026-10-19 07:32:13.168 | 2026-10-19 07:32:51.605 |

The N2YO data had been fetched on 19 October at 06:46:35 / 06:46:47 UTC. The CelesTrak data was downloaded for this audit at 10:45:54 / 10:45:55 UTC from the [ICEYE-X36 GP endpoint](https://celestrak.org/NORAD/elements/gp.php?CATNR=59103&FORMAT=TLE) and [COSMOS 2612 GP endpoint](https://celestrak.org/NORAD/elements/gp.php?CATNR=68762&FORMAT=TLE). These comparisons did not overwrite the app's N2YO cache or archive and spent no N2YO requests.

N2YO and CelesTrak may distribute elements derived from the same tracking catalogue. Agreement between them is not independent sensor confirmation of the actual physical separation.

## Comparison with close-approach reports

I could not verify the quoted **135 meters** as a current separation at the audited instant. A comparison requires the exact event time, the input orbit solutions, and whether the reported number is an instantaneous range or a minimum distance at closest approach.

- [Marco Langbroek's tracking analysis](https://sattrackcam.blogspot.com/2026/10/kosmos-2612-and-iceye-x36-worrisome-cat.html), updated 18 October at 14:30 UTC, discusses a possible close approach early on **18 October**, approximately 01:35 UTC, and explicitly identifies uncertainty from orbital elements and possible maneuvers.
- [Orbital Radar's encounter page](https://orbitalradar.com/conjunction/59103-68762), inspected on 19 October, lists **closest-approach** estimates, including a 26 m prediction for 19 October at 16:07 UTC. Its current-separation field was blank. Its methodology explicitly notes kilometer-scale element uncertainty. These figures do not establish a current range of 135 m.
- [CelesTrak's explanation of orbital-data limitations](https://www.celestrak.org/publications/SDA-TAP-Lab/2025/) describes the effect of missing maneuvers on predicted orbits. Public TLE propagation cannot establish meter-scale physical separation for a maneuvering pair without better tracking information.

Later elements should not be propagated backward across unknown maneuvers and presented as proof of a historical miss distance. The tracker retains its existing replay rule: only use orbital snapshots fetched at or before the selected historical time.

## Measurement correction

The numerical readout previously used visually eased marker positions while visible, and orbital positions while hidden. Following a TLE update, that could briefly bias a quantitative measurement and make it depend on marker visibility. This was a separate issue; it does not explain the stable 338 km result above.

Distance, altitude difference, and the connecting line now use the same interpolated orbital states, without visual easing. Measurements wait for a worker frame that brackets the selected time. The panel shows the calculation's UTC time and exposes available orbit epochs/fetch times under **Orbit data**.
