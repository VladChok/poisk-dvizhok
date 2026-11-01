import {createRequire} from 'node:module';
import {openMemory} from './store.mjs';
import {applyV2, SQL_V2, validateStorage} from './schema-v2.mjs';
import {MemoryError, code, fail} from './safety.mjs';
const require = createRequire(import.meta.url);

export async function migrateToV2({dataDir, scope = 'private', backup, clock, migrationSQL = SQL_V2, timeout = 5000} = {}) {
  const memory = openMemory({dataDir, scope, write: true, supportedVersion: 2, clock, timeout});
  let locked = false;
  try {
    if (memory.db.pragma('user_version', {simple: true}) === 2) return {from: 2, to: 2, changed: false, backup: false};
    if (!backup) fail('MIGRATION_BACKUP_REQUIRED');
    memory.db.exec('BEGIN IMMEDIATE'); locked = true;
    const reader = openMemory({dataDir, scope, supportedVersion: 2});
    try { await reader.backup(backup); } finally { reader.close(); }
    applyV2(memory.db, memory.now(), migrationSQL);
    validateStorage(memory.db, require('better-sqlite3'), scope, 2);
    memory.db.exec('COMMIT'); locked = false;
    return {from: 1, to: 2, changed: true, backup: true};
  } catch (error) {
    if (locked && memory.db.inTransaction) memory.db.exec('ROLLBACK');
    throw new MemoryError(code(error));
  } finally { memory.close(); }
}
