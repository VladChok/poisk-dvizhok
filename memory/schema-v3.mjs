import {APPLICATION_ID, CHECKSUM, initializeSchema, fingerprint} from './schema.mjs';
import {CHECKSUM_V2, applyV2, validateStorage as previous} from './schema-v2.mjs';
import {hash, fail} from './safety.mjs';
export const E4_TABLES = ['watch_definitions','watch_state','watch_events','watch_attempts','watch_baselines','watch_members','watch_deltas','watch_deliveries','watch_receipts','watch_cooldowns'];
export const SQL_V3 = `
CREATE TABLE watch_definitions(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,definition_json TEXT NOT NULL,config_hash TEXT NOT NULL,brief_id TEXT REFERENCES briefs) STRICT;
CREATE TABLE watch_state(watch_id TEXT PRIMARY KEY REFERENCES watch_definitions,status TEXT NOT NULL CHECK(status IN ('DISABLED','ENABLED','REMOVED')),next_due_at TEXT,last_clock_at TEXT NOT NULL,failure_count INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TEXT,active_attempt TEXT,last_good_run TEXT REFERENCES runs,validators_json TEXT NOT NULL DEFAULT '{}',membership_json TEXT NOT NULL DEFAULT '[]',generation INTEGER NOT NULL DEFAULT 0,outcome_signature TEXT,updated_at TEXT NOT NULL) STRICT;
CREATE TABLE watch_events(id TEXT PRIMARY KEY,watch_id TEXT NOT NULL REFERENCES watch_definitions,at TEXT NOT NULL,action TEXT NOT NULL,payload_json TEXT NOT NULL) STRICT;
CREATE TABLE watch_attempts(id TEXT PRIMARY KEY,watch_id TEXT NOT NULL REFERENCES watch_definitions,request_key TEXT,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,lease_token TEXT NOT NULL,run_id TEXT REFERENCES runs,result_json TEXT) STRICT;
CREATE TABLE watch_baselines(watch_id TEXT NOT NULL REFERENCES watch_definitions,identity TEXT NOT NULL,check_id TEXT NOT NULL REFERENCES checks,last_seen_at TEXT NOT NULL,PRIMARY KEY(watch_id,identity)) STRICT;
CREATE TABLE watch_members(attempt_id TEXT NOT NULL REFERENCES watch_attempts,check_id TEXT NOT NULL REFERENCES checks,PRIMARY KEY(attempt_id,check_id)) STRICT;
CREATE TABLE watch_deltas(id TEXT PRIMARY KEY,watch_id TEXT NOT NULL REFERENCES watch_definitions,attempt_id TEXT NOT NULL REFERENCES watch_attempts,at TEXT NOT NULL,kind TEXT NOT NULL,comparison_id TEXT REFERENCES comparisons,payload_json TEXT NOT NULL) STRICT;
CREATE TABLE watch_deliveries(id TEXT PRIMARY KEY,watch_id TEXT NOT NULL REFERENCES watch_definitions,attempt_id TEXT NOT NULL REFERENCES watch_attempts,created_at TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('PENDING','DELIVERED')),delivered_at TEXT) STRICT;
CREATE TABLE watch_receipts(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES watch_deliveries,at TEXT NOT NULL,state TEXT NOT NULL,payload_json TEXT NOT NULL) STRICT;
CREATE TABLE watch_cooldowns(origin TEXT PRIMARY KEY,retry_at TEXT NOT NULL) STRICT;
CREATE INDEX watch_due ON watch_state(status,next_due_at);
CREATE INDEX watch_attempt_history ON watch_attempts(watch_id,started_at);
CREATE INDEX watch_attempt_key ON watch_attempts(watch_id,request_key);
CREATE INDEX watch_delivery_history ON watch_deliveries(watch_id,created_at);
` + ['watch_definitions','watch_events','watch_members','watch_deltas','watch_receipts'].map(table => `
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable watch record'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable watch record'); END;
`).join('') + `
CREATE TRIGGER watch_delivery_payload BEFORE UPDATE OF id,watch_id,attempt_id,created_at,payload_json ON watch_deliveries BEGIN SELECT RAISE(ABORT,'immutable delivery payload'); END;
CREATE TRIGGER watch_delivery_delete BEFORE DELETE ON watch_deliveries BEGIN SELECT RAISE(ABORT,'immutable delivery'); END;
`;
export const CHECKSUM_V3 = hash(SQL_V3);
export function applyV3(db, at, sql = SQL_V3) {
  db.exec(sql); db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(3,CHECKSUM_V3,at); db.pragma('user_version=3');
}
let expected;
export function validateStorage(db, Driver, scope, supportedVersion = 1) {
  const version = db.pragma('user_version',{simple:true});
  if (version > supportedVersion || version > 3) fail('FUTURE_SCHEMA');
  if (version !== 3) return previous(db,Driver,scope,Math.min(supportedVersion,2));
  if (db.pragma('application_id',{simple:true}) !== APPLICATION_ID) fail('INCOMPLETE_SCHEMA');
  if (!expected) { const sample = new Driver(':memory:'); try {
    initializeSchema(sample,'private','2000-01-01T00:00:00.000Z'); applyV2(sample,'2000-01-01T00:00:00.000Z'); applyV3(sample,'2000-01-01T00:00:00.000Z'); expected=fingerprint(sample);
  } finally {sample.close();} }
  if (fingerprint(db)!==expected) fail('SCHEMA_MISMATCH');
  if (JSON.stringify(db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all())!==JSON.stringify([{version:1,checksum:CHECKSUM},{version:2,checksum:CHECKSUM_V2},{version:3,checksum:CHECKSUM_V3}])) fail('MIGRATION_MISMATCH');
  if (db.prepare("SELECT value FROM metadata WHERE key='scope'").get()?.value!==scope || db.prepare('SELECT 1 FROM sources WHERE classification<>? LIMIT 1').get(scope)) fail('SCOPE_MISMATCH');
  const quota=Number(db.prepare("SELECT value FROM metadata WHERE key='max_bytes'").get()?.value);
  if (!Number.isInteger(quota)||quota<1048576||quota>1073741824) fail('INVALID_QUOTA');
  if(db.pragma('page_count',{simple:true})*db.pragma('page_size',{simple:true})>quota) fail('QUOTA');
  if(db.pragma('quick_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length) fail('CORRUPT'); return 3;
}
