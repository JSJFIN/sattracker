import { DatabaseSync } from 'node:sqlite';
import {
  normalizePreferences,
  parsePreferences,
  type Preferences,
} from '../shared/preferences';
import type {
  HistoryFrame,
  HistorySummary,
  OrbitalElements,
  SatelliteHistory,
} from '../shared/types';

const HOUR = 3600000;

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS elements (id INTEGER PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (timestamp INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS request_time ON requests(timestamp);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS element_history (
        satellite_id INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL,
        epoch REAL NOT NULL,
        json TEXT NOT NULL,
        payload TEXT,
        PRIMARY KEY (satellite_id, fetched_at)
      );
      INSERT OR IGNORE INTO element_history (satellite_id, fetched_at, epoch, json)
        SELECT id, json_extract(json, '$.fetchedAt'), json_extract(json, '$.epoch'), json
        FROM elements WHERE json_extract(json, '$.source') = 'n2yo';
    `);
  }
  preferences(): Preferences | null {
    const row = this.db
      .prepare('SELECT json FROM preferences WHERE id = 1')
      .get() as { json: string } | undefined;
    return row ? parsePreferences(JSON.parse(row.json)) : null;
  }
  initializePreferences(value: Preferences): Preferences {
    this.db
      .prepare('INSERT OR IGNORE INTO preferences (id, json) VALUES (1, ?)')
      .run(JSON.stringify(value));
    return this.preferences()!;
  }
  patchPreferences(patch: Partial<Preferences>): Preferences | null {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.preferences();
      const next = previous
        ? normalizePreferences({ ...previous, ...patch })
        : null;
      if (next)
        this.db
          .prepare('UPDATE preferences SET json = ? WHERE id = 1')
          .run(JSON.stringify(next));
      this.db.exec('COMMIT');
      return next;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  get(id: number): OrbitalElements | undefined {
    const row = this.db
      .prepare('SELECT json FROM elements WHERE id = ?')
      .get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  put(elements: OrbitalElements, payload?: unknown) {
    const json = JSON.stringify(elements);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO elements VALUES (?, ?)')
        .run(elements.id, json);
      if (elements.source === 'n2yo') {
        this.db
          .prepare(
            `INSERT INTO element_history VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(satellite_id, fetched_at) DO UPDATE SET payload = COALESCE(element_history.payload, excluded.payload)`,
          )
          .run(
            elements.id,
            elements.fetchedAt,
            elements.epoch,
            json,
            payload === undefined ? null : JSON.stringify(payload),
          );
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  history(ids: number[] | undefined, now: number): HistorySummary {
    const filter = ids
      ? ids.length
        ? `WHERE satellite_id IN (${ids.map(() => '?').join(',')})`
        : 'WHERE 0'
      : '';
    const satellites = this.db
      .prepare(
        `SELECT satellite_id AS id,
      (SELECT json_extract(latest.json, '$.name') FROM element_history AS latest
       WHERE latest.satellite_id = element_history.satellite_id ORDER BY latest.fetched_at DESC LIMIT 1) AS name,
      MIN(fetched_at) AS firstFetchedAt, MAX(fetched_at) AS lastFetchedAt, COUNT(*) AS snapshots
      FROM element_history ${filter} GROUP BY satellite_id ORDER BY satellite_id`,
      )
      .all(...(ids ?? [])) as unknown as SatelliteHistory[];
    return {
      start: satellites.length
        ? Math.min(...satellites.map((item) => item.firstFetchedAt))
        : null,
      end: now,
      satellites,
    };
  }
  historyAt(ids: number[], at: number): HistoryFrame {
    const elements: OrbitalElements[] = [];
    const missingIds: number[] = [];
    let validFrom = 0;
    let validUntil: number | null = null;
    const previous = this.db.prepare(
      'SELECT json, fetched_at FROM element_history WHERE satellite_id = ? AND fetched_at <= ? ORDER BY fetched_at DESC LIMIT 1',
    );
    const next = this.db.prepare(
      'SELECT fetched_at FROM element_history WHERE satellite_id = ? AND fetched_at > ? ORDER BY fetched_at LIMIT 1',
    );
    for (const id of ids) {
      const row = previous.get(id, at) as
        { json: string; fetched_at: number } | undefined;
      if (row) {
        const element = JSON.parse(row.json) as OrbitalElements;
        elements.push({ ...element, stale: at >= element.nextRefreshAt });
        validFrom = Math.max(validFrom, row.fetched_at);
      } else missingIds.push(id);
      const upcoming = next.get(id, at) as { fetched_at: number } | undefined;
      if (upcoming)
        validUntil = Math.min(validUntil ?? Infinity, upcoming.fetched_at);
    }
    return { at, validFrom, validUntil, elements, missingIds };
  }
  readNumber(key: string): number {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  }
  setNumber(key: string, value: number) {
    this.db
      .prepare('INSERT OR REPLACE INTO metadata VALUES (?, ?)')
      .run(key, String(value));
  }
  used(now: number): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS count FROM requests WHERE timestamp > ?')
        .get(now - HOUR) as { count: number }
    ).count;
  }
  reserve(now: number, budget: number): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.used(now) >= budget || this.readNumber('pausedUntil') > now) {
        this.db.exec('ROLLBACK');
        return false;
      }
      this.db.prepare('INSERT INTO requests VALUES (?)').run(now);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
