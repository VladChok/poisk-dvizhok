import {hash, fail} from './safety.mjs';

export const VERSION = 1;
export const APPLICATION_ID = 0x52454d32;
export const SQL = `
CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE briefs(id TEXT PRIMARY KEY, created_at TEXT NOT NULL) STRICT;
CREATE TABLE sources(id TEXT PRIMARY KEY, identity TEXT NOT NULL, locator TEXT NOT NULL, adapter TEXT NOT NULL,
 source_type TEXT NOT NULL, classification TEXT NOT NULL CHECK(classification IN ('public','private')),
 UNIQUE(adapter,identity)) STRICT;
CREATE TABLE bundles(id TEXT PRIMARY KEY, brief_id TEXT NOT NULL REFERENCES briefs ON DELETE CASCADE, imported_at TEXT NOT NULL) STRICT;
CREATE TABLE artifacts(bundle_id TEXT NOT NULL REFERENCES bundles ON DELETE CASCADE, path TEXT NOT NULL, bytes BLOB NOT NULL,
 sha256 TEXT NOT NULL, PRIMARY KEY(bundle_id,path)) STRICT;
CREATE TABLE map_nodes(bundle_id TEXT NOT NULL REFERENCES bundles ON DELETE CASCADE, id TEXT NOT NULL,
 parent TEXT, status TEXT NOT NULL, reason TEXT, original_json TEXT NOT NULL, PRIMARY KEY(bundle_id,id)) STRICT;
CREATE TABLE claims(bundle_id TEXT NOT NULL REFERENCES bundles ON DELETE CASCADE, claim_id TEXT NOT NULL, map_node TEXT NOT NULL,
 source_id TEXT NOT NULL REFERENCES sources, locator TEXT NOT NULL, version TEXT NOT NULL, pointer_json TEXT NOT NULL,
 original_json TEXT NOT NULL, PRIMARY KEY(bundle_id,claim_id),
 FOREIGN KEY(bundle_id,map_node) REFERENCES map_nodes(bundle_id,id)) STRICT;
CREATE TABLE revisions(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources ON DELETE CASCADE,
 revision TEXT, sha256 TEXT, content TEXT, observation_json TEXT NOT NULL, first_observed_at TEXT NOT NULL) STRICT;
CREATE TABLE runs(id TEXT PRIMARY KEY, brief_id TEXT REFERENCES briefs ON DELETE SET NULL,
 adapter TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL, request_json TEXT NOT NULL, metadata_json TEXT NOT NULL) STRICT;
CREATE TABLE checks(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources ON DELETE CASCADE,
 revision_id TEXT REFERENCES revisions, run_id TEXT REFERENCES runs ON DELETE SET NULL,
 observed_at TEXT NOT NULL, status TEXT NOT NULL, access_route TEXT NOT NULL, observation_json TEXT NOT NULL,
 baseline_status TEXT NOT NULL) STRICT;
CREATE TABLE run_sources(run_id TEXT NOT NULL REFERENCES runs ON DELETE CASCADE,
 source_id TEXT NOT NULL REFERENCES sources ON DELETE CASCADE, PRIMARY KEY(run_id,source_id)) STRICT;
CREATE TABLE route_events(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs ON DELETE CASCADE,
 at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('OPEN','CUT','REVISIT')), reason TEXT NOT NULL) STRICT;
CREATE TABLE documents(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, entity_id TEXT NOT NULL,
 brief_id TEXT REFERENCES briefs ON DELETE CASCADE, source_id TEXT REFERENCES sources ON DELETE CASCADE,
 claim_id TEXT, at TEXT NOT NULL, text TEXT NOT NULL, UNIQUE(kind,entity_id)) STRICT;
CREATE VIRTUAL TABLE documents_fts USING fts5(text, content=documents, content_rowid=id, tokenize='unicode61');
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
 INSERT INTO documents_fts(rowid,text) VALUES(new.id,new.text); END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
 INSERT INTO documents_fts(documents_fts,rowid,text) VALUES('delete',old.id,old.text); END;
CREATE INDEX checks_source_date ON checks(source_id,observed_at);
CREATE INDEX revisions_source ON revisions(source_id);
CREATE INDEX bundles_brief ON bundles(brief_id);
CREATE INDEX runs_date ON runs(at);
`;
export const CHECKSUM = hash(SQL);
export function initializeSchema(db, scope, at, migration = SQL) {
  // Test seam permits malformed SQL only in trusted code; never exposed in CLI/config.
  db.transaction(() => {
    db.exec(migration);
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('scope', scope);
    db.prepare('INSERT INTO metadata VALUES (?,?)').run('max_bytes', String(256 * 1024 * 1024));
    db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(VERSION, CHECKSUM, at);
    db.pragma(`application_id=${APPLICATION_ID}`); db.pragma(`user_version=${VERSION}`);
  }).immediate();
}
export function fingerprint(db) {
  return hash(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all()));
}
let expected;
export function checkSchema(db, Driver, scope) {
  const version = db.pragma('user_version', {simple: true});
  if (version > VERSION) fail('FUTURE_SCHEMA');
  if (version !== VERSION || db.pragma('application_id', {simple: true}) !== APPLICATION_ID) fail('INCOMPLETE_SCHEMA');
  if (!expected) {
    const sample = new Driver(':memory:');
    try { initializeSchema(sample, 'private', '2000-01-01T00:00:00.000Z'); expected = fingerprint(sample); }
    finally { sample.close(); }
  }
  if (fingerprint(db) !== expected) fail('SCHEMA_MISMATCH');
  if (db.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(VERSION)?.checksum !== CHECKSUM) fail('MIGRATION_MISMATCH');
  if (db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n !== 1) fail('MIGRATION_MISMATCH');
  if (db.prepare('SELECT value FROM metadata WHERE key=?').get('scope')?.value !== scope) fail('SCOPE_MISMATCH');
  if (db.prepare('SELECT 1 FROM sources WHERE classification<>? LIMIT 1').get(scope)) fail('SCOPE_MISMATCH');
  const quota = Number(db.prepare("SELECT value FROM metadata WHERE key='max_bytes'").get()?.value);
  if (!Number.isInteger(quota) || quota < 1048576 || quota > 1073741824) fail('INVALID_QUOTA');
  if (db.pragma('page_count', {simple: true}) * db.pragma('page_size', {simple: true}) > quota) fail('QUOTA');
  if (db.pragma('quick_check', {simple: true}) !== 'ok' || db.pragma('foreign_key_check').length) fail('CORRUPT');
  return version;
}
