import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { parsePreferencePatch, parsePreferences } from '../shared/preferences';
import type { Store } from './store';

export function preferencesRouter(store: Store) {
  const router = express.Router();
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', (_request, response) => response.json(store.preferences()));
  // A custom header prevents cross-origin forms from changing this local profile.
  // Cross-origin fetches require a CORS preflight, which this server does not allow.
  router.use((request, response, next) => {
    if (
      !request.is('application/json') ||
      request.get('X-Orbit-Settings') !== '1'
    ) {
      response
        .status(415)
        .json({ error: 'Settings require a JSON request from Orbit.' });
      return;
    }
    next();
  });
  router.use(express.json({ limit: '16kb' }));
  router.post('/initialize', (request, response) => {
    let value;
    try {
      value = parsePreferences(request.body);
    } catch {
      response.status(400).json({ error: 'Invalid settings.' });
      return;
    }
    response.json(store.initializePreferences(value));
  });
  router.patch('/', (request, response) => {
    let patch;
    try {
      patch = parsePreferencePatch(request.body);
    } catch {
      response.status(400).json({ error: 'Invalid settings.' });
      return;
    }
    const next = store.patchPreferences(patch);
    if (!next)
      response
        .status(409)
        .json({ error: 'Load settings before saving changes.' });
    else response.json(next);
  });
  router.use(((error, _request, response, _next) => {
    const status =
      error?.type === 'entity.too.large'
        ? 413
        : error?.type === 'entity.parse.failed'
          ? 400
          : 500;
    response
      .status(status)
      .json({
        error:
          status === 500
            ? 'Could not save settings to SQLite.'
            : 'Invalid settings request.',
      });
  }) as ErrorRequestHandler);
  return router;
}
