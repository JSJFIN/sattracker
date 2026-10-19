import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { ApiError, N2yoService, validateTle } from '../server/n2yo';

const line1 =
  '1 25544U 98067A   26291.78980200  .00007771  00000-0  14938-3 0  9994';
const line2 =
  '2 25544  51.6325  48.4339 0006764 280.4294  79.5932 15.48929442590914';
const body = {
  info: { satid: 25544, satname: 'SPACE STATION', transactionscount: 1 },
  tle: `${line1}\r\n${line2}`,
};
const response = () => Response.json(body);
const baseOptions = {
  key: () => 'test-key',
  budget: 3,
  refreshHours: 6,
  spacingMs: 0,
};

test('validates checksums, NORAD IDs, and Alpha-5 catalogue IDs', () => {
  assert.equal(validateTle(25544, body.tle).line2, line2);
  assert.throws(() => validateTle(1, body.tle), ApiError);
  assert.throws(
    () => validateTle(25544, `${line1.slice(0, -1)}0\n${line2}`),
    ApiError,
  );
  const rewrite = (line: string) => {
    const core = `${line.slice(0, 2)}A0057${line.slice(7, 68)}`;
    const sum =
      [...core].reduce(
        (sum, character) =>
          sum +
          (/\d/.test(character)
            ? Number(character)
            : character === '-'
              ? 1
              : 0),
        0,
      ) % 10;
    return core + sum;
  };
  assert.equal(
    validateTle(100057, `${rewrite(line1)}\n${rewrite(line2)}`).line1.slice(
      2,
      7,
    ),
    'A0057',
  );
});

test('rolling budget survives restart, counts failed attempts, and expires precisely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-budget-'));
  const file = join(dir, 'test.sqlite');
  let store = new Store(file);
  try {
    assert.equal(store.reserve(1000, 2), true);
    assert.equal(store.reserve(2000, 2), true);
    store.close();
    store = new Store(file);
    assert.equal(store.reserve(3000, 2), false);
    assert.equal(store.reserve(3601000, 2), true);
    assert.equal(store.used(3601000), 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true });
  }
});

test('concurrent requests are deduplicated and cached without additional upstream requests', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const service = new N2yoService(store, {
    ...baseOptions,
    fetch: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response();
    },
  });
  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => service.get(25544)),
    );
    assert.equal(calls, 1);
    assert.ok(results.every((item) => item.source === 'n2yo'));
    assert.equal((await service.get(25544)).id, 25544);
    assert.equal(calls, 1);
    assert.equal(service.status().used, 1);
  } finally {
    store.close();
  }
});

test('stale data remains available during an outage and failed refreshes back off', async () => {
  const store = new Store(':memory:');
  let now = 1792388745000;
  let calls = 0;
  const service = new N2yoService(store, {
    ...baseOptions,
    now: () => now,
    fetch: async () => {
      calls++;
      if (calls > 1) throw new Error('secret upstream URL');
      return response();
    },
  });
  try {
    const fresh = await service.get(25544);
    now = fresh.nextRefreshAt + 1;
    const stale = await service.get(25544);
    assert.equal(stale.stale, true);
    assert.equal(stale.line1, fresh.line1);
    assert.ok(!stale.warning?.includes('secret'));
    await service.get(25544);
    assert.equal(calls, 2);
    assert.equal(service.status().used, 1);
  } finally {
    store.close();
  }
});

test('HTTP 429 pauses all satellites and persists the pause', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const service = new N2yoService(store, {
    ...baseOptions,
    fetch: async () => {
      calls++;
      return new Response(null, { status: 429 });
    },
  });
  try {
    await assert.rejects(service.get(25544), /rate limit/);
    await assert.rejects(service.get(20580), /budget/);
    assert.equal(calls, 1);
    assert.ok(service.status().pausedUntil > Date.now());
    assert.equal(service.status().used, 1);
  } finally {
    store.close();
  }
});

test('reported upstream usage trips the conservative shared budget', async () => {
  const store = new Store(':memory:');
  let calls = 0;
  const service = new N2yoService(store, {
    ...baseOptions,
    fetch: async () => {
      calls++;
      return Response.json({
        ...body,
        info: { ...body.info, transactionscount: 800 },
      });
    },
  });
  try {
    await service.get(25544);
    await assert.rejects(service.get(20580), /budget/);
    assert.equal(calls, 1);
    assert.equal(service.status().reportedUsage, 800);
  } finally {
    store.close();
  }
});

test('missing key does not spend budget; adding it enables requests immediately', async () => {
  const store = new Store(':memory:');
  let key = '';
  const service = new N2yoService(store, {
    ...baseOptions,
    key: () => key,
    fetch: async () => response(),
  });
  try {
    await assert.rejects(service.get(25544), /N2YO_API_KEY/);
    assert.equal(service.status().used, 0);
    key = 'new-local-key';
    assert.equal((await service.get(25544)).id, 25544);
    assert.equal(service.status().used, 1);
  } finally {
    store.close();
  }
});
