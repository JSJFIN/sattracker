import { DatabaseSync } from 'node:sqlite';
import type { OrbitalElements } from '../shared/types';

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
    `);
  }
  get(id: number): OrbitalElements | undefined {
    const row = this.db
      .prepare('SELECT json FROM elements WHERE id = ?')
      .get(id) as { json: string } | undefined;
    return row ? JSON.parse(row.json) : undefined;
  }
  put(elements: OrbitalElements) {
    this.db
      .prepare('INSERT OR REPLACE INTO elements VALUES (?, ?)')
      .run(elements.id, JSON.stringify(elements));
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
      this.db
        .prepare('DELETE FROM requests WHERE timestamp <= ?')
        .run(now - HOUR);
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
