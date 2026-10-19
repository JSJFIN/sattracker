import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import type { OrbitalElements } from '../shared/types';
import fixtures from '../src/data/demo.json';
import { epochFromRecord, parseElements } from '../shared/orbits';

const snapshot = (
  id: number,
  fetchedAt: number,
  name: string,
): OrbitalElements => {
  const source = fixtures.find((item) => item.id === id)!;
  return {
    ...source,
    name,
    epoch: epochFromRecord(parseElements(source)),
    fetchedAt,
    nextRefreshAt: fetchedAt + 21600000,
    source: 'n2yo',
    stale: false,
  };
};

test('migration preserves existing cache, backfills history, and is safe through restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'orbit-history-'));
  const path = join(directory, 'history.sqlite');
  const original = snapshot(25544, 1000, 'Original');
  const legacy = new DatabaseSync(path);
  legacy.exec(
    'CREATE TABLE elements (id INTEGER PRIMARY KEY, json TEXT NOT NULL)',
  );
  legacy
    .prepare('INSERT INTO elements VALUES (?, ?)')
    .run(original.id, JSON.stringify(original));
  legacy.close();
  let store = new Store(path);
  try {
    assert.deepEqual(store.get(25544), original);
    assert.equal(store.history([25544], 5000).satellites[0].snapshots, 1);
    store.put(snapshot(25544, 2000, 'Refreshed'), {
      tle: 'saved source response',
      info: { transactionscount: 2 },
    });
    store.close();
    store = new Store(path);
    assert.equal(store.get(25544)?.name, 'Refreshed');
    assert.equal(store.history([25544], 5000).satellites[0].snapshots, 2);
    assert.equal(store.historyAt([25544], 1500).elements[0].name, 'Original');
    const payload = store.db
      .prepare('SELECT payload FROM element_history WHERE fetched_at = 2000')
      .get() as { payload: string };
    assert.equal(JSON.parse(payload.payload).tle, 'saved source response');
  } finally {
    store.close();
    rmSync(directory, { recursive: true });
  }
});

test('rewind selects the last fetched snapshot at or before the requested instant, never a future one', () => {
  const store = new Store(':memory:');
  try {
    store.put(snapshot(25544, 1000, 'Version A'));
    store.put(snapshot(25544, 3000, 'Version B'));
    store.put(snapshot(20580, 2000, 'Hubble'));
    const before = store.historyAt([25544, 20580], 500);
    assert.deepEqual(before.elements, []);
    assert.deepEqual(before.missingIds, [25544, 20580]);
    assert.equal(before.validUntil, 1000);
    const early = store.historyAt([25544, 20580], 1500);
    assert.equal(early.elements[0].name, 'Version A');
    assert.deepEqual(early.missingIds, [20580]);
    assert.equal(early.validFrom, 1000);
    assert.equal(early.validUntil, 2000);
    const middle = store.historyAt([25544, 20580], 2500);
    assert.equal(middle.elements.length, 2);
    assert.equal(middle.validFrom, 2000);
    assert.equal(middle.validUntil, 3000);
    const boundary = store.historyAt([25544, 20580], 3000);
    assert.equal(boundary.elements[0].name, 'Version B');
    assert.equal(boundary.validFrom, 3000);
    assert.equal(boundary.validUntil, null);
    const summary = store.history([25544], 5000);
    assert.equal(summary.start, 1000);
    assert.equal(summary.end, 5000);
    assert.equal(summary.satellites[0].name, 'Version B');
    assert.equal(summary.satellites[0].snapshots, 2);
  } finally {
    store.close();
  }
});

test('same elements fetched again are retained, while cached reads create no snapshots or requests', () => {
  const store = new Store(':memory:');
  try {
    store.put(snapshot(25544, 1000, 'ISS'));
    store.put(snapshot(25544, 2000, 'ISS'));
    store.get(25544);
    store.historyAt([25544], 1500);
    assert.equal(store.history([25544], 5000).satellites[0].snapshots, 2);
    assert.equal(store.used(5000), 0);
    assert.equal(store.historyAt([25544], 3000).elements[0].stale, false);
    assert.equal(store.historyAt([25544], 21602001).elements[0].stale, true);
    store.put({ ...snapshot(20580, 3000, 'Demo Hubble'), source: 'demo' });
    assert.deepEqual(store.historyAt([20580], 4000).missingIds, [20580]);
  } finally {
    store.close();
  }
});

test('expired request timestamps remain stored without spending the current-hour budget', () => {
  const store = new Store(':memory:');
  try {
    store.reserve(1000, 1);
    assert.equal(store.reserve(2000, 1), false);
    assert.equal(store.reserve(3601000, 1), true);
    assert.equal(store.used(3601000), 1);
    assert.equal(
      (
        store.db.prepare('SELECT COUNT(*) AS count FROM requests').get() as {
          count: number;
        }
      ).count,
      2,
    );
  } finally {
    store.close();
  }
});
