import {APPLICATION_ID, CHECKSUM, initializeSchema, fingerprint, checkSchema} from './schema.mjs';
import {hash, fail} from './safety.mjs';

export const LATEST_VERSION = 2;
export const E3_TABLES = ['analysis_anchors', 'analysis_members', 'comparisons', 'query_families', 'coverage_runs', 'coverage_decisions', 'evidence_links', 'evidence_reviews'];
export const SQL_V2 = `
CREATE TABLE analysis_anchors(id TEXT PRIMARY KEY, kind TEXT NOT NULL,
 source_id TEXT REFERENCES sources, revision_id TEXT REFERENCES revisions, check_id TEXT REFERENCES checks,
 run_id TEXT REFERENCES runs, bundle_id TEXT, claim_id TEXT, ref_json TEXT NOT NULL,
 FOREIGN KEY(bundle_id,claim_id) REFERENCES claims(bundle_id,claim_id)) STRICT;
CREATE TABLE analysis_members(anchor_id TEXT NOT NULL REFERENCES analysis_anchors,
 check_id TEXT NOT NULL REFERENCES checks, PRIMARY KEY(anchor_id,check_id)) STRICT;
CREATE TABLE comparisons(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, brief_id TEXT REFERENCES briefs,
 left_id TEXT NOT NULL REFERENCES analysis_anchors, right_id TEXT NOT NULL REFERENCES analysis_anchors,
 verdict TEXT NOT NULL CHECK(verdict IN ('SAME','CHANGED','UNAVAILABLE','INCONCLUSIVE')), payload_json TEXT NOT NULL) STRICT;
CREATE TABLE query_families(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, brief_id TEXT REFERENCES briefs,
 family TEXT NOT NULL, specification_json TEXT NOT NULL) STRICT;
CREATE TABLE coverage_runs(coverage_id TEXT NOT NULL REFERENCES query_families,
 run_id TEXT NOT NULL REFERENCES runs, PRIMARY KEY(coverage_id,run_id)) STRICT;
CREATE TABLE coverage_decisions(coverage_id TEXT NOT NULL REFERENCES query_families,
 source_id TEXT NOT NULL REFERENCES sources, verdict TEXT NOT NULL CHECK(verdict IN ('CUT','SURVIVED','WATCH','OPEN')),
 reason TEXT NOT NULL, PRIMARY KEY(coverage_id,source_id)) STRICT;
CREATE TABLE evidence_links(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, brief_id TEXT REFERENCES briefs,
 left_id TEXT NOT NULL REFERENCES analysis_anchors, right_id TEXT NOT NULL REFERENCES analysis_anchors,
 relation TEXT NOT NULL CHECK(relation IN ('SUPPORTS','DISPUTES','NOT_COMPARABLE','REQUIRES_REVIEW')),
 actor TEXT NOT NULL, payload_json TEXT NOT NULL) STRICT;
CREATE TABLE evidence_reviews(id TEXT PRIMARY KEY, link_id TEXT NOT NULL REFERENCES evidence_links,
 at TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('OPEN','ACCEPTED','DISMISSED','WITHDRAWN')),
 actor TEXT NOT NULL, rationale TEXT NOT NULL) STRICT;
CREATE INDEX comparison_brief ON comparisons(brief_id,created_at);
CREATE INDEX coverage_brief ON query_families(brief_id,created_at);
CREATE INDEX link_brief ON evidence_links(brief_id,created_at);
` + E3_TABLES.map(table => `
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable analysis record'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'immutable analysis record'); END;
`).join('');
export const CHECKSUM_V2 = hash(SQL_V2);
export function applyV2(db, at, sql = SQL_V2) {
  db.exec(sql);
  db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(2, CHECKSUM_V2, at);
  db.pragma('user_version=2');
}
let expected;
export function validateStorage(db, Driver, scope, supportedVersion = 1) {
  const version = db.pragma('user_version', {simple: true});
  if (version > supportedVersion || version > 2) fail('FUTURE_SCHEMA');
  if (version !== 2) return checkSchema(db, Driver, scope);
  if (db.pragma('application_id', {simple: true}) !== APPLICATION_ID) fail('INCOMPLETE_SCHEMA');
  if (!expected) {
    const sample = new Driver(':memory:');
    try {
      initializeSchema(sample, 'private', '2000-01-01T00:00:00.000Z');
      sample.transaction(() => applyV2(sample, '2000-01-01T00:00:00.000Z')).immediate();
      expected = fingerprint(sample);
    } finally { sample.close(); }
  }
  if (fingerprint(db) !== expected) fail('SCHEMA_MISMATCH');
  const migrations = db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all();
  if (JSON.stringify(migrations) !== JSON.stringify([{version: 1, checksum: CHECKSUM}, {version: 2, checksum: CHECKSUM_V2}])) fail('MIGRATION_MISMATCH');
  if (db.prepare("SELECT value FROM metadata WHERE key='scope'").get()?.value !== scope ||
      db.prepare('SELECT 1 FROM sources WHERE classification<>? LIMIT 1').get(scope)) fail('SCOPE_MISMATCH');
  const quota = Number(db.prepare("SELECT value FROM metadata WHERE key='max_bytes'").get()?.value);
  if (!Number.isInteger(quota) || quota < 1048576 || quota > 1073741824) fail('INVALID_QUOTA');
  if (db.pragma('page_count', {simple: true}) * db.pragma('page_size', {simple: true}) > quota) fail('QUOTA');
  if (db.pragma('quick_check', {simple: true}) !== 'ok' || db.pragma('foreign_key_check').length) fail('CORRUPT');
  return 2;
}
