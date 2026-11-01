import {createRequire} from 'node:module';
import {openMemory} from './store.mjs';
import {applyV3, SQL_V3, validateStorage} from './schema-v3.mjs';
import {MemoryError, code, fail} from './safety.mjs';
const require=createRequire(import.meta.url);
export async function migrateToV3({dataDir,scope='private',backup,clock,migrationSQL=SQL_V3,timeout=5000}={}) {
  const memory=openMemory({dataDir,scope,write:true,supportedVersion:3,clock,timeout}); let locked=false;
  try {
    const from=memory.doctor().schema;
    if(from===3)return {from:3,to:3,changed:false,backup:false,watch:'OFF'};
    if(from!==2)fail('MIGRATION_V2_REQUIRED'); if(!backup)fail('MIGRATION_BACKUP_REQUIRED');
    memory.db.exec('BEGIN IMMEDIATE');locked=true;
    const reader=openMemory({dataDir,scope,supportedVersion:3});try{await reader.backup(backup);}finally{reader.close();}
    applyV3(memory.db,memory.now(),migrationSQL);validateStorage(memory.db,require('better-sqlite3'),scope,3);
    memory.db.exec('COMMIT');locked=false;return {from:2,to:3,changed:true,backup:true,watch:'OFF'};
  }catch(error){if(locked&&memory.db.inTransaction)memory.db.exec('ROLLBACK');throw new MemoryError(code(error));}
  finally{memory.close();}
}
