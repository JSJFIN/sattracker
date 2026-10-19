import { writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run manually, at most once per day. No N2YO key or N2YO transactions are used.
const response = await fetch(
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
  { signal: AbortSignal.timeout(30000) },
);
if (!response.ok)
  throw new Error(
    `CelesTrak catalogue request failed (${response.status}). Existing catalogue retained.`,
  );
const lines = (await response.text()).trim().split(/\r?\n/);
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const entries = new Map<number, { id: number; name: string }>();
for (let i = 0; i < lines.length - 2; i += 3) {
  if (!lines[i + 1].startsWith('1 ') || !lines[i + 2].startsWith('2 '))
    continue;
  const raw = lines[i + 1].slice(2, 7);
  const id = /^\d/.test(raw)
    ? Number(raw)
    : (alphabet.indexOf(raw[0]) + 10) * 10000 + Number(raw.slice(1));
  if (Number.isSafeInteger(id) && id > 0)
    entries.set(id, { id, name: lines[i].replace(/^0 /, '').trim() });
}
if (entries.size < 1000)
  throw new Error(
    'Unexpected catalogue response. Existing catalogue retained.',
  );
const satellites = [...entries.values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);
const output = resolve(import.meta.dirname, '../server/data/catalog.json');
await writeFile(
  `${output}.tmp`,
  JSON.stringify({
    updatedAt: new Date().toISOString().slice(0, 10),
    source: 'CelesTrak active satellite catalogue',
    satellites,
  }) + '\n',
);
await rename(`${output}.tmp`, output);
console.log(
  `Updated local name catalogue: ${satellites.length} satellites. Restart the data server to load it.`,
);
