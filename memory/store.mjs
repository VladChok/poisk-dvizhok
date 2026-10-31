import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {checkSchema as checkJSON} from '../tools/research-map.mjs';
import {readBundle} from './bundle.mjs';
import {VERSION, checkSchema, initializeSchema} from './schema.mjs';
import {MemoryError, fail, hash, clean, safePath, relativeFile, readFile, dataPath,
  MAX_INPUT, MAX_FILE, temporary, publishFile, code} from './safety.mjs';

const require = createRequire(import.meta.url);
const observationSchema = JSON.parse(fs.readFileSync(new URL('../harness/observation.schema.json', import.meta.url), 'utf8'));
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const json = value => JSON.stringify(clean(value));
function driver() { try { return require('better-sqlite3'); } catch { fail('DRIVER_UNAVAILABLE'); } }
function connect(file, readonly, timeout = 5000) {
  const Driver = driver();
  try { return new Driver(file, {readonly, fileMustExist: true, timeout}); }
  catch (error) {
    if (!error.code) fail('DRIVER_UNAVAILABLE');
    throw new MemoryError(code(error));
  }
}
function configure(db, write = false) {
  db.pragma('foreign_keys=ON'); db.pragma('trusted_schema=OFF');
  if (write) {
    db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL');
    db.pragma('wal_autocheckpoint=100'); db.pragma('journal_size_limit=16777216');
  } else db.pragma('query_only=ON');
}
function existingFile(file) {
  safePath(file);
  if (!fs.existsSync(file)) fail('NOT_INITIALIZED');
  if (!fs.lstatSync(file).isFile()) fail('INVALID_PATH');
  if (fs.statSync(file).size > 1073741824) fail('INPUT_LIMIT');
}
function validateObservation(value) {
  clean(value);
  const violations = checkJSON(value, observationSchema, 'observation.schema.json').filter(v => v.rule !== 'KEY-ORDER');
  if (violations.length || value.version !== 1 || !iso(value.observedAt) ||
      ['publishedAt', 'updatedAt'].some(k => value[k] !== null && !iso(value[k])) ||
      (value.hash !== null && !/^[a-f0-9]{64}$/.test(value.hash)) || Buffer.byteLength(json(value)) > MAX_FILE) fail('INVALID_OBSERVATION');
  if (value.status === 'NOT_MODIFIED' && (value.content !== null || value.hash !== null)) fail('INVALID_304');
}
function safeResult(result) {
  clean(result);
  const known = ['version', 'adapter', 'status', 'observations', 'limitations', 'requests', 'trace', 'request', 'feed', 'attempts'];
  if (!result || Object.keys(result).some(k => !known.includes(k)) || result.version !== 1 ||
      !['github', 'rss', 'fixture'].includes(result.adapter) || !/^[A-Z_]{1,60}$/.test(result.status) ||
      !Array.isArray(result.observations) || result.observations.length > 100 || Buffer.byteLength(json(result)) > MAX_INPUT) fail('INVALID_RUN');
  const allowedRequest = ['operation', 'query', 'repo', 'ref', 'file', 'url', 'id'];
  const request = value => { if (value && (typeof value !== 'object' || Object.entries(value).some(([k, v]) => !allowedRequest.includes(k) || typeof v !== 'string'))) fail('INVALID_RUN'); };
  const limitations = value => { if (value !== undefined && (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 4000))) fail('INVALID_RUN'); };
  const trace = value => {
    if (value === undefined) return;
    if (!Array.isArray(value) || value.length > 50 || value.some(v => !v || Object.keys(v).some(k => !['host', 'status', 'bytes'].includes(k)) ||
      typeof v.host !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(v.host) || !Number.isInteger(v.status) || v.status < 100 || v.status > 599 ||
      !Number.isInteger(v.bytes) || v.bytes < 0 || v.bytes > MAX_FILE)) fail('INVALID_RUN');
  };
  request(result.request); limitations(result.limitations); trace(result.trace);
  if (!Number.isInteger(result.requests) || result.requests < 0 || result.requests > 50) fail('INVALID_RUN');
  if (result.attempts !== undefined) {
    if (!Array.isArray(result.attempts) || result.attempts.length > 5) fail('INVALID_RUN');
    for (const attempt of result.attempts) {
      if (!attempt || Object.keys(attempt).some(k => !['adapter', 'status', 'count', 'request', 'trace', 'limitations', 'requests'].includes(k))) fail('INVALID_RUN');
      request(attempt.request); trace(attempt.trace); limitations(attempt.limitations);
    }
  }
  if (result.feed !== undefined && (result.adapter !== 'rss' || !result.feed || Object.keys(result.feed).some(k =>
    !['identity', 'updatedAt', 'etag', 'lastModified', 'hash', 'totalItems'].includes(k)) || typeof result.feed.identity !== 'string' ||
    !/^[a-f0-9]{64}$/.test(result.feed.hash) || (result.feed.updatedAt !== null && !iso(result.feed.updatedAt)))) fail('INVALID_RUN');
  for (const observation of result.observations) validateObservation(observation);
}

export class ResearchMemory {
  constructor(db, file, {scope, write, clock, maxRecords}) {
    this.db = db; this.file = file; this.scope = scope; this.write = write;
    this.clock = clock || (() => new Date().toISOString()); this.maxRecords = maxRecords ?? 100000;
  }
  now() { const at = this.clock(); if (!iso(at)) fail('INVALID_DATE'); return new Date(at).toISOString(); }
  close() { this.db.close(); }
  migrate() { return {schema: checkSchema(this.db, driver(), this.scope), changed: false}; }
  doctor() {
    this.migrate();
    return {status: 'OK', schema: VERSION, scope: this.scope,
      sqlite: this.db.prepare('SELECT sqlite_version() AS v').get().v,
      driver: require('better-sqlite3/package.json').version, integrity: 'ok', watch: 'OFF',
      quotas: {logicalBytes: this.db.pragma('page_count', {simple: true}) * this.db.pragma('page_size', {simple: true}),
        maxBytes: Number(this.db.prepare("SELECT value FROM metadata WHERE key='max_bytes'").get().value), maxRecords: this.maxRecords},
      counts: Object.fromEntries(['briefs', 'bundles', 'sources', 'revisions', 'checks', 'runs', 'claims'].map(table => [table, this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]))};
  }
  transaction(fn) {
    if (!this.write) fail('READ_ONLY');
    try { return this.db.transaction(() => {
      const result = fn();
      for (const table of ['artifacts', 'documents', 'checks', 'runs', 'sources', 'revisions', 'claims', 'bundles', 'map_nodes', 'route_events']) {
        if (this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n > this.maxRecords) fail('QUOTA');
      }
      return result;
    }).immediate(); } catch (error) { throw new MemoryError(code(error)); }
  }
  source(adapter, identity, locator, sourceType) {
    const id = hash(json([this.scope, adapter, identity]));
    this.db.prepare('INSERT OR IGNORE INTO sources VALUES (?,?,?,?,?,?)').run(id, identity, locator, adapter, sourceType, this.scope);
    return id;
  }
  document(kind, entity, text, {brief = null, source = null, claim = null, at = this.now()} = {}) {
    this.db.prepare('INSERT OR IGNORE INTO documents(kind,entity_id,brief_id,source_id,claim_id,at,text) VALUES (?,?,?,?,?,?,?)')
      .run(kind, entity, brief, source, claim, at, text);
  }
  importBundle(directory) {
    const bundle = readBundle(directory), at = this.now();
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM bundles WHERE id=?').get(bundle.id)) return {brief: bundle.brief, bundle: bundle.id, duplicate: true};
      this.db.prepare('INSERT OR IGNORE INTO briefs VALUES (?,?)').run(bundle.brief, at);
      this.db.prepare('INSERT INTO bundles VALUES (?,?,?)').run(bundle.id, bundle.brief, at);
      for (const [name, bytes] of bundle.files) this.db.prepare('INSERT INTO artifacts VALUES (?,?,?,?)').run(bundle.id, name, bytes, hash(bytes));
      this.document('brief', bundle.id, bundle.files.get('brief.md').toString('utf8'), {brief: bundle.brief, at});
      for (const node of bundle.map.nodes) {
        this.db.prepare('INSERT INTO map_nodes VALUES (?,?,?,?,?,?)').run(bundle.id, node.id, node.parent, node.status, node.reason, json(node));
      }
      for (const claim of bundle.evidence) {
        const source = this.source('bundle', claim.pointer.locator, claim.pointer.locator, 'evidence-pointer');
        this.db.prepare('INSERT INTO claims VALUES (?,?,?,?,?,?,?,?)').run(bundle.id, claim.claim_id, claim.map_node,
          source, claim.pointer.locator, claim.pointer.version, json(claim.pointer), json(claim));
        this.document('claim', `${bundle.id}:${claim.claim_id}`, `${claim.claim}\n${claim.limitation || ''}\n${json(claim.pointer)}`,
          {brief: bundle.brief, source, claim: claim.claim_id, at});
      }
      return {brief: bundle.brief, bundle: bundle.id, duplicate: false, files: bundle.files.size};
    });
  }
  observation(value, run = null, brief = null) {
    validateObservation(value);
    const observedAt = new Date(value.observedAt).toISOString();
    const source = this.source(value.adapter, value.identity, value.canonicalUrl, value.sourceType);
    let revision = null, baseline = 'OBSERVED';
    if (value.status === 'NOT_MODIFIED') {
      const filter = value.etag ? " AND json_extract(observation_json,'$.etag')=?" : value.lastModified ? " AND json_extract(observation_json,'$.lastModified')=?" : '';
      const prior = this.db.prepare('SELECT revision_id,run_id FROM checks WHERE source_id=? AND revision_id IS NOT NULL AND observed_at<=?' + filter + ' ORDER BY observed_at DESC,rowid DESC LIMIT 1')
        .get(source, observedAt, ...(filter ? [value.etag || value.lastModified] : []));
      revision = prior?.revision_id ?? null;
      baseline = revision ? 'REUSED_LAST_GOOD' : value.etag || value.lastModified ? 'NO_MATCHING_VALIDATOR' : 'NO_BASELINE';
      if (run && prior?.run_id && value.sourceType === 'feed') {
        // A 304 feed check reuses membership of its last good acquisition.
        this.db.prepare('INSERT OR IGNORE INTO run_sources SELECT ?,source_id FROM run_sources WHERE run_id=?').run(run, prior.run_id);
      }
    } else {
      // Exclude retrieval-only metadata from revision identity; retain each check separately.
      revision = hash(json([source, value.revision, value.hash, value.content, value.title, value.publishedAt, value.updatedAt]));
      this.db.prepare('INSERT OR IGNORE INTO revisions VALUES (?,?,?,?,?,?,?)').run(revision, source, value.revision,
        value.hash, value.content, json(value), observedAt);
      this.document('observation', revision, `${value.title}\n${value.content || ''}\n${value.identity}\n${value.canonicalUrl}`,
        {brief, source, at: observedAt});
    }
    const check = hash(json([source, value, run]));
    this.db.prepare('INSERT OR IGNORE INTO checks VALUES (?,?,?,?,?,?,?,?,?)').run(check, source, revision, run,
      observedAt, value.status, value.accessRoute, json(value), baseline);
    if (run) this.db.prepare('INSERT OR IGNORE INTO run_sources VALUES (?,?)').run(run, source);
    return {source, revision, check, baseline};
  }
  storeObservation(value) { return this.transaction(() => this.observation(value)); }
  storeRun(result, {brief = null, source = null, key, at = this.now()} = {}) {
    safeResult(result); if (!iso(at)) fail('INVALID_DATE');
    const id = hash(json([this.scope, brief, key || result]));
    const inputHash = hash(json([result.adapter, result.status, result.request || {}, source, result.observations.map(o =>
      [o.identity, o.revision, o.hash, o.content, o.title, o.publishedAt, o.updatedAt, o.status])]));
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT metadata_json FROM runs WHERE id=?').get(id);
      if (prior) {
        if (JSON.parse(prior.metadata_json).storageInputHash !== inputHash) fail('IDEMPOTENCY_CONFLICT');
        return {run: id, duplicate: true};
      }
      const {observations, ...metadata} = result;
      this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?)').run(id, brief, result.adapter, result.status, new Date(at).toISOString(),
        json(result.request || {}), json({...metadata, storageInputHash: inputHash}));
      if (source) {
        const linked = this.db.prepare('SELECT id FROM sources WHERE id=? OR identity=?').get(source, source);
        if (!linked) fail('NOT_FOUND');
        this.db.prepare('INSERT OR IGNORE INTO run_sources VALUES (?,?)').run(id, linked.id);
      }
      if (result.feed) {
        const feed = result.feed;
        this.observation({version: 1, adapter: 'rss', sourceType: 'feed', identity: feed.identity, canonicalUrl: feed.identity,
          accessRoute: result.request?.url || feed.identity, observedAt: observations[0]?.observedAt || at,
          publishedAt: null, updatedAt: feed.updatedAt, revision: feed.hash, etag: feed.etag, lastModified: feed.lastModified,
          hash: feed.hash, status: 'OBSERVED', title: feed.identity, content: null,
          limitations: ['Feed response metadata retained; full feed body was not supplied by E1. Entries are separate observations.']}, id, brief);
      }
      const refs = observations.map(value => this.observation(value, id, brief));
      // Failure events still associate with prior sources reached through the same route.
      const route = result.request?.url;
      if (route) this.db.prepare('INSERT OR IGNORE INTO run_sources SELECT ?,source_id FROM checks WHERE access_route=?').run(id, route);
      if (result.request?.repo && result.request?.ref) {
        const identity = `github:${result.request.repo.toLowerCase()}:${result.request.ref}:${result.request.file || ''}`;
        this.db.prepare('INSERT OR IGNORE INTO run_sources SELECT ?,id FROM sources WHERE identity=?').run(id, identity);
      }
      return {run: id, duplicate: false, status: result.status, observations: refs};
    });
  }
  route(run, state, reason) {
    clean(reason);
    if (!['OPEN', 'CUT', 'REVISIT'].includes(state) || typeof reason !== 'string' || !reason.trim() || reason.length > 4000) fail('INVALID_ROUTE_EVENT');
    return this.transaction(() => {
      const at = this.now(), id = hash(json([run, state, reason, at]));
      this.db.prepare('INSERT OR IGNORE INTO route_events VALUES (?,?,?,?,?)').run(id, run, at, state, reason);
      return {id, run, state};
    });
  }
  find({query, source, brief, claim, from, to, limit = 50} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (from && !iso(from)) || (to && !iso(to))) fail('INVALID_QUERY');
    const conditions = [], args = [];
    if (query !== undefined) {
      if (typeof query !== 'string' || query.length > 2000) fail('INVALID_QUERY');
      const terms = query.match(/[\p{L}\p{N}_]+/gu) || [];
      if (!terms.length || terms.length > 20) fail('INVALID_QUERY');
      conditions.push('d.id IN (SELECT rowid FROM documents_fts WHERE documents_fts MATCH ?)');
      args.push(terms.map(term => `"${term}"`).join(' AND '));
    }
    if (brief) { conditions.push("(d.brief_id=? OR (d.kind='observation' AND d.entity_id IN (SELECT c.revision_id FROM checks c JOIN runs r ON r.id=c.run_id WHERE r.brief_id=?)))"); args.push(brief, brief); }
    if (claim) { conditions.push('d.claim_id=?'); args.push(claim); }
    if (source) { conditions.push('d.source_id IN (SELECT id FROM sources WHERE id=? OR identity=? OR locator=?)'); args.push(source, source, source); }
    if (from) { conditions.push('d.at>=?'); args.push(new Date(from).toISOString()); }
    if (to) { conditions.push('d.at<=?'); args.push(new Date(to).toISOString()); }
    return this.db.prepare(`SELECT d.* FROM documents d ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY d.id LIMIT ?`).all(...args, limit);
  }
  getHistory({source, brief, limit = 100} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) fail('INVALID_QUERY');
    if (brief) return {
      brief, bundles: this.db.prepare('SELECT id,imported_at FROM bundles WHERE brief_id=? ORDER BY rowid LIMIT ?').all(brief, limit),
      claims: this.db.prepare('SELECT c.* FROM claims c JOIN bundles b ON b.id=c.bundle_id WHERE b.brief_id=? ORDER BY c.rowid LIMIT ?').all(brief, limit),
      runs: this.db.prepare('SELECT * FROM runs WHERE brief_id=? ORDER BY rowid LIMIT ?').all(brief, limit)
    };
    const rows = source ? this.db.prepare('SELECT * FROM sources WHERE id=? OR identity=? OR locator=? LIMIT ?').all(source, source, source, limit) :
      this.db.prepare('SELECT * FROM sources ORDER BY rowid LIMIT ?').all(limit);
    return {sources: rows.map(item => ({...item,
      revisions: this.db.prepare('SELECT * FROM revisions WHERE source_id=? ORDER BY rowid LIMIT ?').all(item.id, limit),
      checks: this.db.prepare('SELECT * FROM checks WHERE source_id=? ORDER BY observed_at,rowid LIMIT ?').all(item.id, limit),
      runs: this.db.prepare('SELECT r.* FROM runs r JOIN run_sources s ON s.run_id=r.id WHERE s.source_id=? ORDER BY r.rowid LIMIT ?').all(item.id, limit)})),
      routeEvents: this.db.prepare('SELECT * FROM route_events ORDER BY rowid LIMIT ?').all(limit)};
  }
  exportBundle(brief, output, {bundle: version, allowPrivate = false} = {}) {
    if (this.scope === 'private' && !allowPrivate) fail('PRIVATE_EXPORT_REQUIRED');
    const row = version ? this.db.prepare('SELECT id FROM bundles WHERE id=? AND brief_id=?').get(version, brief) :
      this.db.prepare('SELECT id FROM bundles WHERE brief_id=? ORDER BY rowid DESC LIMIT 1').get(brief);
    if (!row) fail('NOT_FOUND');
    const out = safePath(output);
    if (path.basename(out) !== brief) fail('EXPORT_SLUG_MISMATCH');
    if (fs.existsSync(out)) fail('TARGET_EXISTS');
    const parent = path.dirname(out); if (!fs.statSync(parent).isDirectory()) fail('INVALID_PATH');
    const staged = temporary(out); fs.mkdirSync(staged, {mode: 0o700});
    try {
      // Install the ignore guard before any private artifact bytes are written,
      // including the case where the process crashes during export.
      fs.writeFileSync(path.join(staged, '.gitignore'), '*\n', {flag: 'wx', mode: 0o600});
      const artifacts = this.db.prepare('SELECT path,bytes,sha256 FROM artifacts WHERE bundle_id=? ORDER BY path').all(row.id);
      for (const artifact of artifacts) {
        relativeFile(artifact.path); clean(artifact.bytes);
        if (hash(artifact.bytes) !== artifact.sha256) fail('CORRUPT_ARTIFACT');
        const file = path.join(staged, artifact.path);
        fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
        fs.writeFileSync(file, artifact.bytes, {flag: 'wx', mode: 0o600});
      }
      // Validate the complete export using its required slug before publication.
      const validation = path.join(staged, brief); fs.mkdirSync(validation);
      for (const a of artifacts) { const f = path.join(validation, a.path); fs.mkdirSync(path.dirname(f), {recursive: true}); fs.linkSync(path.join(staged, a.path), f); }
      readBundle(validation); fs.rmSync(validation, {recursive: true});
      if (fs.existsSync(out)) fail('TARGET_EXISTS');
      fs.renameSync(staged, out);
      return {brief, bundle: row.id, files: artifacts.length, scope: this.scope};
    } catch (error) { fs.rmSync(staged, {recursive: true, force: true}); throw error; }
  }
  async backup(destination) {
    const out = safePath(destination);
    if (!/\.(sqlite|db)$/.test(out)) fail('BACKUP_EXTENSION');
    if (fs.existsSync(out)) fail('TARGET_EXISTS');
    const staged = temporary(out);
    try {
      // SQLite online backup includes committed WAL while the main connection
      // remains readonly. A write-only-to-destination operation needs no main DB write.
      const deadline = Date.now() + 30000;
      await this.db.backup(staged, {progress: () => { if (Date.now() > deadline) fail('BACKUP_TIMEOUT'); return 100; }});
      fs.chmodSync(staged, 0o600);
      const copy = connect(staged, false);
      try { checkSchema(copy, driver(), this.scope); copy.pragma('journal_mode=DELETE'); if (copy.pragma('integrity_check', {simple: true}) !== 'ok') fail('CORRUPT'); }
      finally { copy.close(); }
      publishFile(staged, out); return {status: 'OK', schema: VERSION, scope: this.scope};
    } finally { if (fs.existsSync(staged)) fs.unlinkSync(staged); }
  }
  purge({brief, source, before, confirm = false} = {}) {
    if (!confirm || [brief, source, before].filter(Boolean).length !== 1 || (before && !iso(before))) fail('PURGE_CONFIRM_REQUIRED');
    if (before) before = new Date(before).toISOString();
    return this.transaction(() => {
      if (brief) this.db.prepare('DELETE FROM briefs WHERE id=?').run(brief);
      else if (source) {
        const row = this.db.prepare('SELECT id FROM sources WHERE id=? OR identity=?').get(source, source);
        if (!row) fail('NOT_FOUND');
        if (this.db.prepare('SELECT 1 FROM claims WHERE source_id=?').get(row.id)) fail('EVIDENCE_REFERENCED');
        this.db.prepare('DELETE FROM checks WHERE source_id=?').run(row.id);
        this.db.prepare('DELETE FROM sources WHERE id=?').run(row.id);
      } else {
        // Keep latest check and last-known-good check for every source.
        for (const {id} of this.db.prepare('SELECT id FROM sources').all()) {
          const latest = this.db.prepare('SELECT id FROM checks WHERE source_id=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(id)?.id || '';
          const good = this.db.prepare('SELECT id FROM checks WHERE source_id=? AND revision_id IS NOT NULL ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(id)?.id || '';
          this.db.prepare('DELETE FROM checks WHERE source_id=? AND observed_at<? AND id NOT IN (?,?)').run(id, before, latest, good);
        }
        this.db.prepare('DELETE FROM runs WHERE at<?').run(before);
      }
      return {status: 'OK', retention: 'explicit purge; source revisions retained unless source explicitly purged'};
    });
  }
}

export function openMemory({dataDir, scope = 'private', write = false, init = false, clock, maxBytes = 256 * 1024 * 1024,
  maxRecords, timeout = 5000} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1048576 || maxBytes > 1073741824 || !Number.isInteger(timeout) || timeout < 0 || timeout > 30000 ||
      (maxRecords !== undefined && (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 100000))) fail('INVALID_QUOTA');
  const file = dataPath(dataDir, scope); let db, created = false;
  try {
    if (init) {
      if (fs.existsSync(file)) fail('TARGET_EXISTS');
      fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
      const fd = fs.openSync(file, 'wx', 0o600); fs.closeSync(fd); created = true;
      db = connect(file, false, timeout);
      configure(db, true); initializeSchema(db, scope, clock?.() || new Date().toISOString());
      db.prepare("UPDATE metadata SET value=? WHERE key='max_bytes'").run(String(maxBytes));
    } else {
      existingFile(file); db = connect(file, !write, timeout);
      // Validate BEFORE any writes/pragmas that change persistent state.
      checkSchema(db, driver(), scope); configure(db, write);
    }
    checkSchema(db, driver(), scope);
    const quota = Number(db.prepare("SELECT value FROM metadata WHERE key='max_bytes'").get().value);
    if (write || init) db.pragma(`max_page_count=${Math.floor(quota / db.pragma('page_size', {simple: true}))}`);
    return new ResearchMemory(db, file, {scope, write: write || init, clock, maxRecords});
  } catch (error) {
    db?.close();
    if (created) for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(file + suffix); } catch {} }
    if (error instanceof MemoryError) throw error;
    throw new MemoryError(code(error));
  }
}
export function restoreMemory(backup, {dataDir, scope = 'private'} = {}) {
  const source = safePath(backup), destination = dataPath(dataDir, scope);
  existingFile(source);
  if (fs.statSync(source).size > 1073741824) fail('INPUT_LIMIT');
  if (fs.existsSync(source + '-wal') || fs.existsSync(source + '-shm')) fail('STANDALONE_BACKUP_REQUIRED');
  if (fs.existsSync(destination)) fail('TARGET_EXISTS');
  // Validate a copied snapshot so concurrent changes to the input cannot swap in
  // different content between validation and publication.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'research-restore-'));
  const staged = path.join(scratch, 'snapshot.sqlite');
  try {
    fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL); fs.chmodSync(staged, 0o600);
    const db = connect(staged, true);
    try {
      checkSchema(db, driver(), scope);
      if (db.pragma('journal_mode', {simple: true}) !== 'delete' || db.pragma('integrity_check', {simple: true}) !== 'ok') fail('CORRUPT');
    } finally { db.close(); }
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    const local = temporary(destination);
    try { fs.copyFileSync(staged, local, fs.constants.COPYFILE_EXCL); fs.chmodSync(local, 0o600); publishFile(local, destination); }
    finally { if (fs.existsSync(local)) fs.unlinkSync(local); }
    return {status: 'OK', schema: VERSION, scope};
  } catch (error) { throw new MemoryError(code(error)); }
  finally { fs.rmSync(scratch, {recursive: true, force: true}); }
}
