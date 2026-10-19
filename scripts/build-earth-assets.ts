import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { geoArea, geoEquirectangular, geoPath } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';
import sharp from 'sharp';

// Run from the repository root. Source downloads stay out of Git; the app uses
// only the generated, local 2:1 equirectangular images in public/textures.
const cache = '.cache/earth-assets';
const output = 'public/textures';
mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
async function download(url: string, file: string) {
  if (existsSync(file)) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}
const width = 4096;
const height = width / 2;
for (const [source, target] of [
  ['NE2_50M_SR_W', 'earth-natural.jpg'],
  ['GRAY_50M_SR_W', 'earth-gray.jpg'],
] as const) {
  const zip = `${cache}/${source}.zip`;
  await download(
    `https://naciscdn.org/naturalearth/50m/raster/${source}.zip`,
    zip,
  );
  const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' });
  const tif = listing.split('\n').find((name) => name.endsWith('.tif'));
  if (!tif) throw new Error(`No TIFF in ${source}`);
  execFileSync('unzip', ['-o', '-q', zip, tif, '-d', cache]);
  await sharp(`${cache}/${tif}`)
    .resize(width, height)
    .jpeg({ quality: 90 })
    .toFile(`${output}/${target}`);
  console.log(`Built ${target}`);
}

await download(
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson',
  `${cache}/countries.geojson`,
);
interface Country {
  NAME_EN: string;
  LABELRANK: number;
  LABEL_X: number;
  LABEL_Y: number;
  MAPCOLOR7: number;
}
const countries = JSON.parse(
  readFileSync(`${cache}/countries.geojson`, 'utf8'),
) as FeatureCollection<Geometry, Country>;
const projection = geoEquirectangular()
  .scale(width / (2 * Math.PI))
  .translate([width / 2, height / 2])
  .precision(0.15);
const path = geoPath(projection);
const svg = (content: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${content}</svg>`,
  );
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[char]!,
  );
const palette = [
  '#234350',
  '#2d4c51',
  '#374b5b',
  '#304557',
  '#3b5354',
  '#294959',
  '#3d4b59',
];
const land = countries.features
  .map(
    (country) =>
      `<path d="${path(country)}" fill="${palette[(country.properties.MAPCOLOR7 - 1) % palette.length] || palette[0]}"/>`,
  )
  .join('');
await sharp(
  svg(`<rect width="${width}" height="${height}" fill="#091827"/>${land}`),
)
  .jpeg({ quality: 93 })
  .toFile(`${output}/earth-countries.jpg`);

// Reuse the same projection for coastline/border and name overlays, so they
// align with both raster maps and the original NASA imagery.
const boundaries = countries.features
  .map((country) => `<path d="${path(country)}"/>`)
  .join('');
await sharp(
  svg(
    `<g fill="none" stroke="#b8d9df" stroke-opacity=".7" stroke-width="1" stroke-linejoin="round">${boundaries}</g>`,
  ),
)
  .png()
  .toFile(`${output}/earth-borders.png`);

// Prioritize larger, more prominent labels and avoid overlaps at base scale.
const occupied: { x: number; y: number; w: number; h: number }[] = [];
const names: string[] = [];
for (const country of [...countries.features].sort(
  (a, b) =>
    a.properties.LABELRANK - b.properties.LABELRANK || geoArea(b) - geoArea(a),
)) {
  const props = country.properties;
  if (props.LABELRANK > 5 || geoArea(country) < 0.0002) continue;
  const point = projection([props.LABEL_X, props.LABEL_Y]);
  if (!point) continue;
  const [x, y] = point;
  const font = props.LABELRANK <= 2 ? 19 : 16;
  const lines =
    props.NAME_EN.length > 17
      ? props.NAME_EN.replace(/ (?!.* )/, '\n').split('\n')
      : [props.NAME_EN];
  const box = {
    x,
    y,
    w: Math.max(...lines.map((line) => line.length)) * font * 0.57 + 12,
    h: lines.length * (font + 3) + 8,
  };
  if (
    occupied.some(
      (other) =>
        Math.abs(other.x - x) < (other.w + box.w) / 2 &&
        Math.abs(other.y - y) < (other.h + box.h) / 2,
    )
  )
    continue;
  occupied.push(box);
  names.push(
    `<text x="${x}" y="${y}" font-size="${font}">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? font + 3 : 0}">${escape(line)}</tspan>`).join('')}</text>`,
  );
}
await sharp(
  svg(
    `<g fill="#e0edf0" stroke="#07121b" stroke-width="3" paint-order="stroke" stroke-linejoin="round" text-anchor="middle" dominant-baseline="middle" font-family="DejaVu Sans,sans-serif" font-weight="500">${names.join('')}</g>`,
  ),
)
  .png()
  .toFile(`${output}/earth-names.png`);
console.log(`Built country map, borders and ${names.length} country labels`);
