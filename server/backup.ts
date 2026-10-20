import { backup, DatabaseSync } from 'node:sqlite';
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

/** SQLite's online backup includes committed WAL data in one standalone file. */
export async function backupDatabase(source: string, destination: string) {
  const db = new DatabaseSync(source, { readOnly: true });
  let reserved = false;
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    closeSync(openSync(destination, 'wx', 0o600));
    reserved = true;
    await backup(db, destination);
  } catch (error) {
    if (reserved) rmSync(destination, { force: true });
    throw error;
  } finally {
    db.close();
  }
}
