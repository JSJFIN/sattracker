import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { backupDatabase } from '../server/backup';
import { preferencesRouter } from '../server/preferences';
import {
  defaultPreferences,
  parsePreferencePatch,
  parsePreferences,
  type Preferences,
} from '../shared/preferences';
import { legacyPreferences, PreferencesClient } from '../src/preferencesClient';
import demo from '../src/data/demo.json';

function storage(values: Record<string, string> = {}) {
  const map = new Map(Object.entries(values));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
const legacy = () =>
  storage({
    'orbit-satellites': JSON.stringify([
      { id: 59103, color: '#f08e9c', visible: false },
      { id: 68762, color: '#7fc7f0', visible: true },
    ]),
    'orbit-earth-appearance': JSON.stringify({
      style: 'natural',
      borders: true,
      names: true,
    }),
    'orbit-view-controls-minimized': 'true',
    unrelated: 'retain me',
  });
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
function mockApi(store: Store, calls: string[] = []): typeof fetch {
  return async (input, options) => {
    const method = options?.method ?? 'GET';
    calls.push(method);
    const body = options?.body ? JSON.parse(String(options.body)) : null;
    if (method === 'GET') return response(store.preferences());
    if (method === 'POST')
      return response(store.initializePreferences(parsePreferences(body)));
    return response(store.patchPreferences(parsePreferencePatch(body)));
  };
}

test('preference schema rejects credentials, malformed fields, duplicate IDs and oversized watchlists', () => {
  const defaults = defaultPreferences();
  assert.deepEqual(parsePreferences(defaults), defaults);
  for (const invalid of [
    { apiKey: 'not-a-real-key' },
    { mode: 'other' },
    { selected: -1 },
    { selected: '25544' },
    { cameraMode: ['orbit'] },
    { appearance: { style: ['natural'], borders: false, names: false } },
    { layers: { ...defaults.layers, injected: true } },
    { controlsMinimized: 'true' },
    { distancePair: [1] },
    { selections: [defaults.selections[0], defaults.selections[0]] },
    { selections: [{ id: 1, color: 'red', visible: true }] },
    {
      selections: Array.from({ length: 51 }, (_, index) => ({
        id: index + 1,
        color: '#abcdef',
        visible: true,
      })),
    },
  ])
    assert.throws(() => parsePreferencePatch(invalid));
  assert.throws(() => parsePreferences({ mode: 'demo' }));
});

test('legacy import preserves watchlist order, colors, visibility and valid empty watchlists', () => {
  const saved = legacyPreferences(legacy());
  assert.deepEqual(
    saved.selections.map((v) => v.id),
    [59103, 68762],
  );
  assert.equal(saved.selections[0].visible, false);
  assert.equal(saved.selections[0].color, '#f08e9c');
  assert.deepEqual(saved.appearance, {
    style: 'natural',
    borders: true,
    names: true,
  });
  assert.equal(saved.controlsMinimized, true);
  assert.deepEqual(
    legacyPreferences(storage({ 'orbit-satellites': '[]' })).selections,
    [],
  );
  assert.deepEqual(
    legacyPreferences(storage({ 'orbit-satellites': 'broken JSON' })),
    defaultPreferences(),
  );
  assert.deepEqual(
    legacyPreferences({
      getItem: () => {
        throw new Error();
      },
      removeItem: () => {},
    }),
    defaultPreferences(),
  );
});

test('SQLite initialization is first-writer-wins; patches preserve unrelated settings and remove stale references', () => {
  const store = new Store(':memory:');
  try {
    assert.equal(store.preferences(), null);
    assert.equal(store.patchPreferences({ mode: 'demo' }), null);
    const initial = store.initializePreferences(legacyPreferences(legacy()));
    assert.deepEqual(
      store.initializePreferences(defaultPreferences()),
      initial,
    );
    store.patchPreferences({ mode: 'demo' });
    store.patchPreferences({
      layers: { ...initial.layers, grid: true },
      cameraMode: 'follow',
      distancePair: [59103, 68762],
    });
    const saved = store.patchPreferences({
      selections: initial.selections.slice(1),
    })!;
    assert.equal(saved.mode, 'demo');
    assert.equal(saved.layers.grid, true);
    assert.equal(saved.appearance.style, 'natural');
    assert.equal(saved.selected, null);
    assert.equal(saved.cameraMode, 'orbit');
    assert.deepEqual(saved.distancePair, [null, 68762]);
  } finally {
    store.close();
  }
});

test('client imports once, survives concurrent initialization, and another browser uses the SQLite profile', async () => {
  const store = new Store(':memory:');
  try {
    const saved = legacy();
    const calls: string[] = [];
    const client = new PreferencesClient(mockApi(store, calls), () => saved);
    await Promise.all([client.load(), client.load()]);
    assert.deepEqual(calls, ['GET', 'POST']);
    assert.equal(client.getSnapshot().settings?.appearance.style, 'natural');
    assert.deepEqual([...saved.map.keys()], ['unrelated']);
    const staleBrowser = storage({ 'orbit-satellites': '[]' });
    const otherCalls: string[] = [];
    const other = new PreferencesClient(
      mockApi(store, otherCalls),
      () => staleBrowser,
    );
    await other.load();
    assert.deepEqual(otherCalls, ['GET']);
    assert.deepEqual(
      other.getSnapshot().settings,
      client.getSnapshot().settings,
    );

    // A second initialization arriving after the first cannot overwrite it.
    const racing = new PreferencesClient(
      async (_input, options) =>
        options?.method === 'GET'
          ? response(null)
          : response(store.initializePreferences(defaultPreferences())),
      () => storage(),
    );
    await racing.load();
    assert.deepEqual(
      racing.getSnapshot().settings,
      client.getSnapshot().settings,
    );
  } finally {
    store.close();
  }
});

test('failed startup never writes defaults or discards legacy values; retry imports successfully', async () => {
  const store = new Store(':memory:');
  try {
    const saved = legacy();
    let offline = true;
    const calls: string[] = [];
    const api = mockApi(store, calls);
    const client = new PreferencesClient(
      async (...args) => {
        if (offline) throw new Error('Offline');
        return api(...args);
      },
      () => saved,
    );
    client.set('mode', 'demo');
    await client.load();
    assert.equal(client.getSnapshot().status, 'error');
    assert.equal(store.preferences(), null);
    assert.equal(saved.map.size, 4);
    offline = false;
    await client.retry();
    assert.deepEqual(calls, ['GET', 'POST']);
    assert.equal(store.preferences()?.selections[0].id, 59103);
  } finally {
    store.close();
  }
});

test('a lost initialization response keeps legacy data until retry confirms the committed SQLite profile', async () => {
  const store = new Store(':memory:');
  try {
    const saved = legacy();
    const api = mockApi(store);
    const client = new PreferencesClient(
      async (input, options) => {
        const result = await api(input, options);
        if (options?.method === 'POST')
          throw new Error('Response lost after commit');
        return result;
      },
      () => saved,
    );
    await client.load();
    assert.equal(client.getSnapshot().status, 'error');
    assert.equal(saved.map.size, 4);
    assert.equal(store.preferences()?.selections[0].id, 59103);
    await client.retry();
    assert.equal(client.getSnapshot().status, 'ready');
    assert.equal(saved.map.size, 1);
    assert.deepEqual(client.getSnapshot().settings, store.preferences());
  } finally {
    store.close();
  }
});

test('in-flight saves retain newer changes and retry a failed save without losing the patch', async () => {
  const store = new Store(':memory:');
  try {
    store.initializePreferences(defaultPreferences());
    const api = mockApi(store);
    let release: (() => void) | undefined;
    let hold = true;
    let fail = false;
    const patches: unknown[] = [];
    const client = new PreferencesClient(
      async (input, options) => {
        if (options?.method === 'PATCH') {
          patches.push(JSON.parse(String(options.body)));
          if (hold)
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          if (fail) throw new Error('Offline');
        }
        return api(input, options);
      },
      () => storage(),
    );
    await client.load();
    client.set('mode', 'demo');
    const firstSave = client.flush();
    client.set('mode', 'live');
    client.set('controlsMinimized', true);
    release!();
    await firstSave;
    assert.equal(client.getSnapshot().settings?.mode, 'live');
    assert.equal(client.getSnapshot().settings?.controlsMinimized, true);
    hold = false;
    fail = true;
    await client.flush();
    assert.equal(client.getSnapshot().status, 'error');
    assert.equal(store.preferences()?.mode, 'demo');
    client.set('historyOpen', true);
    fail = false;
    await client.retry();
    assert.equal(client.getSnapshot().status, 'ready');
    assert.equal(store.preferences()?.mode, 'live');
    assert.equal(store.preferences()?.controlsMinimized, true);
    assert.equal(store.preferences()?.historyOpen, true);
    assert.deepEqual(patches.at(-1), {
      mode: 'live',
      controlsMinimized: true,
      historyOpen: true,
    });
  } finally {
    store.close();
  }
});

test('stale browsers send only changed fields, preserving settings saved by another browser', async () => {
  const store = new Store(':memory:');
  try {
    store.initializePreferences(defaultPreferences());
    const a = new PreferencesClient(mockApi(store), () => storage());
    const b = new PreferencesClient(mockApi(store), () => storage());
    await Promise.all([a.load(), b.load()]);
    a.set('appearance', { style: 'gray', borders: true, names: false });
    await a.flush();
    b.set('controlsMinimized', true);
    await b.flush();
    assert.equal(store.preferences()?.appearance.style, 'gray');
    assert.equal(b.getSnapshot().settings?.appearance.style, 'gray');
  } finally {
    store.close();
  }
});

test('settings HTTP API validates writes and blocks cross-origin forms without mutating the profile', async () => {
  const store = new Store(':memory:');
  const app = express();
  app.use('/api/preferences', preferencesRouter(store));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/preferences`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Orbit-Settings': '1',
  };
  try {
    assert.equal(await (await fetch(url)).json(), null);
    assert.equal(
      (await fetch(url, { method: 'PATCH', headers, body: '{}' })).status,
      409,
    );
    assert.equal(
      (
        await fetch(`${url}/initialize`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
      400,
    );
    const initial = await fetch(`${url}/initialize`, {
      method: 'POST',
      headers,
      body: JSON.stringify(defaultPreferences()),
    });
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('Cache-Control'), 'no-store');
    assert.equal(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'text/plain' },
          body: '{}',
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      415,
    );
    assert.equal(
      (await fetch(url, { method: 'PATCH', headers, body: '{' })).status,
      400,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ unknown: 'x'.repeat(17000) }),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await fetch(url, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ N2YO_API_KEY: 'not-a-real-key' }),
        })
      ).status,
      400,
    );
    assert.deepEqual(store.preferences(), defaultPreferences());
    const next = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ mode: 'demo' }),
    });
    assert.equal(((await next.json()) as Preferences).mode, 'demo');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  }
});

test('online backup restores preferences and existing data, including committed WAL, without browser storage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-preferences-'));
  const original = join(directory, 'tracker.sqlite');
  const copy = join(directory, 'backups', 'saved.sqlite');
  let store: Store | undefined = new Store(original);
  let restored: Store | undefined;
  try {
    const settings = legacyPreferences(legacy());
    store.initializePreferences(settings);
    store.patchPreferences({
      mode: 'demo',
      measuring: true,
      distancePair: [59103, 68762],
    });
    store.setNumber('pausedUntil', 123456);
    const elements = {
      ...demo[0],
      epoch: 12345,
      fetchedAt: 1000,
      nextRefreshAt: 2000,
      source: 'n2yo' as const,
      stale: false,
    };
    store.put(elements, { tle: 'source orbital elements' });
    store.db.prepare('INSERT INTO requests VALUES (?)').run(12345);
    assert.ok(statSync(`${original}-wal`).size > 0);
    const expected = store.preferences();
    await backupDatabase(original, copy);
    assert.equal(statSync(copy).mode & 0o777, 0o600);
    restored = new Store(copy);
    assert.deepEqual(restored.preferences(), expected);
    assert.equal(restored.readNumber('pausedUntil'), 123456);
    assert.deepEqual(restored.get(elements.id), elements);
    assert.deepEqual(
      restored.historyAt([elements.id], 1500).elements[0],
      elements,
    );
    assert.equal(
      restored.history([elements.id], 1500).satellites[0].snapshots,
      1,
    );
    assert.equal(restored.used(12346), 1);
    const client = new PreferencesClient(mockApi(restored), () =>
      storage({ 'orbit-satellites': '[]' }),
    );
    await client.load();
    assert.deepEqual(client.getSnapshot().settings, expected);
    await assert.rejects(backupDatabase(original, copy));
    assert.deepEqual(restored.preferences(), expected);
    store.close();
    store = new Store(original);
    assert.deepEqual(store.preferences(), expected);
  } finally {
    store?.close();
    restored?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
