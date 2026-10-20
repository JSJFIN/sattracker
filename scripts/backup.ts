import { resolve } from 'node:path';
import { backupDatabase } from '../server/backup';

const root = resolve(import.meta.dirname, '..');
const destination = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(
      root,
      '.data/backups',
      `tracker-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
try {
  await backupDatabase(resolve(root, '.data/tracker.sqlite'), destination);
  console.log(`Saved SQLite backup: ${destination}`);
} catch {
  console.error(
    'Backup failed. Check the source database and destination permissions; the destination must not already exist.',
  );
  process.exitCode = 1;
}
