import express from 'express';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { Store } from './store';
import { ApiError, N2yoService } from './n2yo';
import { preferencesRouter } from './preferences';

const root = resolve(import.meta.dirname, '..');
const env = () => {
  try {
    return parse(readFileSync(resolve(root, '.env')));
  } catch {
    return {};
  }
};
const startup = env();
const setting = (name: string, fallback: number, min: number, max: number) => {
  const number = Number(process.env[name] || startup[name] || fallback);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new Error(`Invalid ${name}: expected ${min}–${max}.`);
  return number;
};
mkdirSync(resolve(root, '.data'), { recursive: true, mode: 0o700 });
const store = new Store(resolve(root, '.data/tracker.sqlite'));
const service = new N2yoService(store, {
  key: () => (process.env.N2YO_API_KEY || env().N2YO_API_KEY || '').trim(),
  budget: setting('N2YO_HOURLY_BUDGET', 800, 1, 900),
  refreshHours: setting('TLE_REFRESH_HOURS', 6, 1, 24),
});
const app = express();
const catalog = JSON.parse(
  readFileSync(resolve(root, 'server/data/catalog.json'), 'utf8'),
) as {
  updatedAt: string;
  source: string;
  satellites: { id: number; name: string }[];
};
app.disable('x-powered-by');
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});
app.get('/api/status', (_request, response) => response.json(service.status()));
app.use('/api/preferences', preferencesRouter(store));
app.get('/api/catalog', (_request, response) => {
  const satellites = new Map(catalog.satellites.map((item) => [item.id, item]));
  for (const item of store.history(undefined, Date.now()).satellites) {
    if (!satellites.has(item.id))
      satellites.set(item.id, { id: item.id, name: item.name });
  }
  response.json({ ...catalog, satellites: [...satellites.values()] });
});
const parseIds = (raw: unknown): number[] | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !/^\d{1,9}(,\d{1,9})*$/.test(raw))
    throw new Error();
  const ids = [...new Set(raw.split(',').map(Number))];
  if (ids.length > 50 || ids.some((id) => id < 1)) throw new Error();
  return ids;
};
app.get('/api/history', (request, response) => {
  try {
    response.json(store.history(parseIds(request.query.ids), Date.now()));
  } catch {
    response
      .status(400)
      .json({
        error: 'Supply up to 50 numeric NORAD IDs separated by commas.',
      });
  }
});
app.get('/api/history/elements', (request, response) => {
  try {
    const ids = parseIds(request.query.ids);
    const at = Number(request.query.at);
    if (
      !ids ||
      typeof request.query.at !== 'string' ||
      !/^\d{1,16}$/.test(request.query.at) ||
      !Number.isSafeInteger(at) ||
      at < 0 ||
      at > Date.now()
    )
      throw new Error();
    response.json(store.historyAt(ids, at));
  } catch {
    response
      .status(400)
      .json({
        error:
          'Supply up to 50 NORAD IDs and a past UTC Unix timestamp in milliseconds.',
      });
  }
});
app.get('/api/satellites/:id', async (request, response) => {
  const raw = request.params.id;
  const id = Number(raw);
  if (!/^\d{1,9}$/.test(raw) || !Number.isSafeInteger(id) || id < 1) {
    response
      .status(400)
      .json({ error: 'Enter a numeric NORAD ID between 1 and 999999999.' });
    return;
  }
  try {
    response.json(await service.get(id));
  } catch (error) {
    const safeError =
      error instanceof ApiError
        ? error
        : new ApiError(
            'The local data service could not complete this request.',
          );
    response.status(safeError.status).json({ error: safeError.message });
  }
});
app.use('/api', (_request, response) =>
  response.status(404).json({ error: 'API route not found.' }),
);
const dist = resolve(root, 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('/{*path}', (_request, response) =>
    response.sendFile(resolve(dist, 'index.html')),
  );
}
const port = setting('PORT', 3001, 1024, 65535);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Satellite data service: http://127.0.0.1:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
}
