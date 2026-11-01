import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {openMemory, restoreMemory} from '../memory/store.mjs';
import {initializeSchema, SQL} from '../memory/schema.mjs';
import {hash, dataPath, MAX_FILE} from '../memory/safety.mjs';
import {createHarness} from '../harness/engine.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'tools/research-memory.mjs');
const WORKER = path.join(ROOT, 'tests/helpers/memory-worker.mjs');
const BUNDLE = path.join(ROOT, 'research/e0-node-sqlite');
const AT = '2026-10-31T00:00:00.000Z';
function temp(t, beforeCleanup = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-memory-'));
  t.after(() => { beforeCleanup(); fs.rmSync(root, {recursive: true, force: true}); });
  return root;
}
function store(t, options = {}) {
  let memory;
  const root = temp(t, () => { if (memory?.db.open) memory.close(); }), dataDir = path.join(root, 'state');
  memory = openMemory({dataDir, scope: 'public', init: true, clock: () => AT, ...options});
  return {root, dataDir, memory};
}
const run = args => spawnSync(process.execPath, [CLI, ...args], {cwd: ROOT, encoding: 'utf8', timeout: 15000});
const cli = (dataDir, ...args) => run([...args, '--data-dir', dataDir, '--scope', 'public', '--json']);
async function observed(content = 'Проверка памяти Unicode 研究', options = {}) {
  const harness = createHarness({}, {clock: () => Date.parse(AT), fixture: {version: 1, items: [{id: 'stable', content}]}});
  const result = await harness.discover('fixture');
  return {...result.observations[0], ...options};
}
function inputBundle(root) {
  const copy = path.join(root, 'input', 'e0-node-sqlite');
  fs.cpSync(BUNDLE, copy, {recursive: true}); return copy;
}
const resultFor = (observation, status = 'OK') => ({version: 1, adapter: 'fixture', status,
  observations: observation ? [observation] : [], limitations: [], requests: 0, trace: [],
  request: {operation: 'discover', url: 'https://feed.example.com/feed'}});

test('SQLite native file, schema v1, close/reopen durability, Unicode FTS and source/claim/date filters', async t => {
  const {memory, dataDir} = store(t);
  const item = await observed();
  const stored = memory.storeObservation(item);
  memory.importBundle(BUNDLE);
  assert.equal(memory.doctor().schema, 1);
  assert.equal(memory.doctor().watch, 'OFF');
  memory.close();
  assert.equal(fs.readFileSync(dataPath(dataDir, 'public')).subarray(0, 16).toString(), 'SQLite format 3\0');
  const reopened = openMemory({dataDir, scope: 'public'});
  try {
    assert.equal(reopened.find({query: 'проверка', source: stored.source}).length, 1);
    assert.equal(reopened.find({query: '研究'}).length, 1);
    assert.equal(reopened.find({brief: 'e0-node-sqlite', claim: 'c1'}).length, 1);
    assert.equal(reopened.find({query: 'проверка', from: AT, to: AT}).length, 1);
    assert.equal(reopened.find({query: 'проверка', from: '2026-10-31T00:00:00Z', to: '2026-10-31T00:00:00Z'}).length, 1);
    assert.equal(reopened.find({query: 'проверка', from: '2027-01-01T00:00:00.000Z'}).length, 0);
    assert.equal(reopened.getHistory({source: stored.source}).sources[0].revisions[0].content, item.content);
    assert.throws(() => reopened.storeObservation(item), /READ_ONLY/);
  } finally { reopened.close(); }
});

test('fresh CLI processes init, fixture ingest, Cyrillic find, history, doctor and no implicit read creation', t => {
  const root = temp(t), dataDir = path.join(root, 'new-state');
  assert.equal(cli(dataDir, 'doctor').status, 1);
  assert.equal(cli(dataDir, 'find', '--query', 'данные').status, 1);
  assert.equal(fs.existsSync(dataDir), false);
  assert.equal(cli(dataDir, 'init').status, 0);
  assert.equal(cli(dataDir, 'init').status, 1);
  const ingest = cli(dataDir, 'ingest', '--source', 'fixture', '--fixture', 'tests/fixtures/harness.json', '--key', 'restart-proof');
  assert.equal(ingest.status, 0, ingest.stdout + ingest.stderr);
  const again = cli(dataDir, 'ingest', '--source', 'fixture', '--fixture', 'tests/fixtures/harness.json', '--key', 'restart-proof');
  assert.equal(JSON.parse(again.stdout).duplicate, true);
  const find = cli(dataDir, 'find', '--query', 'Проверка');
  assert.equal(find.status, 0); assert.equal(JSON.parse(find.stdout).matches.length, 1);
  const history = cli(dataDir, 'history', '--source', 'fixture:fixture-russian');
  assert.equal(history.status, 0); assert.equal(JSON.parse(history.stdout).sources[0].revisions.length, 1);
  assert.equal(JSON.parse(cli(dataDir, 'doctor').stdout).counts.runs, 1);
  assert.equal(run(['--help']).status, 0);
  assert.equal(run(['watch']).status, 2);
  assert.equal(cli(dataDir, 'find', '--unknown').status, 2);
});

test('idempotent exact observation/run imports, immutable revisions and 304 retain last known good', async t => {
  const {memory} = store(t);
  const first = await observed('Первый источник');
  const a = memory.storeObservation(first), b = memory.storeObservation(first);
  assert.deepEqual(a, b); assert.equal(memory.doctor().counts.checks, 1);
  const recheck = {...first, observedAt: '2026-10-31T01:00:00.000Z', status: 'NOT_MODIFIED', content: null, hash: null};
  const checked = memory.storeObservation(recheck);
  assert.equal(checked.revision, a.revision); assert.equal(checked.baseline, 'REUSED_LAST_GOOD');
  const next = await observed('Второй источник', {observedAt: '2026-10-31T02:00:00.000Z'});
  const changed = memory.storeObservation(next);
  assert.notEqual(changed.revision, a.revision);
  const history = memory.getHistory({source: a.source}).sources[0];
  assert.equal(history.checks.length, 3); assert.equal(history.revisions.length, 2);
  assert.equal(history.revisions[0].content, first.content);
  const runResult = resultFor(next);
  assert.equal(memory.storeRun(runResult).duplicate, false);
  assert.equal(memory.storeRun(runResult).duplicate, true);
  assert.equal(memory.doctor().counts.runs, 1);
  memory.storeRun(resultFor(first), {key: 'same-key'});
  assert.throws(() => memory.storeRun(resultFor(next), {key: 'same-key'}), /IDEMPOTENCY_CONFLICT/);
  const noBaseline = {...recheck, identity: 'fixture:unknown'};
  assert.equal(memory.storeObservation(noBaseline).baseline, 'NO_BASELINE');
});

test('304 stale/unknown validators and out-of-order events never reuse future content; RSS 304 retains feed membership', async t => {
  const {memory} = store(t);
  const sourceURL = 'https://feed.example.com/feed';
  const first = await observed('Старая версия', {adapter: 'rss', sourceType: 'feed-entry', identity: sourceURL + '#entry=1',
    canonicalUrl: 'https://publisher.example.com/article', accessRoute: sourceURL, etag: '"old"'});
  const result = {...resultFor(first), adapter: 'rss', feed: {identity: sourceURL, updatedAt: AT, etag: '"old"', lastModified: null,
    hash: 'a'.repeat(64), totalItems: 1}};
  const initial = memory.storeRun(result, {key: 'rss-baseline'});
  const recheck = {...first, sourceType: 'feed', identity: sourceURL, canonicalUrl: sourceURL, content: null, hash: null,
    revision: null, status: 'NOT_MODIFIED', observedAt: '2026-10-31T01:00:00.000Z'};
  const checked = memory.storeRun({...resultFor(recheck, 'NOT_MODIFIED'), adapter: 'rss'}, {key: 'rss-304'});
  assert.equal(checked.observations[0].baseline, 'REUSED_LAST_GOOD');
  const root = memory.getHistory({source: sourceURL}).sources[0];
  assert.equal(root.revisions.length, 1); assert.equal(root.checks.length, 2);
  const entry = memory.getHistory({source: initial.observations[0].source}).sources[0];
  assert.equal(entry.revisions.length, 1); assert.equal(entry.runs.length, 2);
  const unknown = memory.storeObservation({...recheck, etag: '"unknown"', observedAt: '2026-10-31T02:00:00.000Z'});
  assert.equal(unknown.baseline, 'NO_MATCHING_VALIDATOR'); assert.equal(unknown.revision, null);
  const past = memory.storeObservation({...recheck, etag: null, observedAt: '2025-01-01T00:00:00.000Z'});
  assert.equal(past.baseline, 'NO_BASELINE');
  assert.equal(memory.getHistory({source: entry.id}).sources[0].revisions[0].content, first.content);
});

test('failed acquisitions/partial pagination and invalid dates preserve old content and route history', async t => {
  const {memory} = store(t);
  const first = await observed('Сохранённая версия', {accessRoute: 'https://feed.example.com/feed'});
  const saved = memory.storeRun(resultFor(first), {key: 'baseline'});
  for (const status of ['NETWORK_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'THROTTLED', 'TIMEOUT']) memory.storeRun(resultFor(null, status), {key: status});
  memory.storeRun({...resultFor(first, 'PARTIAL'), limitations: ['PAGINATION_LIMIT'], attempts: [{adapter: 'fixture', status: 'PARTIAL', count: 1}]}, {key: 'partial'});
  const history = memory.getHistory({source: saved.observations[0].source}).sources[0];
  assert.equal(history.revisions.length, 1); assert.equal(history.runs.length, 7);
  const counts = memory.doctor().counts;
  assert.throws(() => memory.storeObservation({...first, publishedAt: 'invalid'}), /INVALID_OBSERVATION/);
  assert.deepEqual(memory.doctor().counts, counts);
  memory.route(saved.run, 'CUT', 'Bounded source gap; no absence conclusion.');
  memory.route(saved.run, 'REVISIT', 'Reopen manually later.');
  assert.deepEqual(memory.getHistory().routeEvents.map(e => e.state), ['CUT', 'REVISIT']);
});

test('v0 bundle bytes roundtrip, duplicate imports, version history and validators/inspector in new processes', t => {
  const {root, memory, dataDir} = store(t);
  const input = inputBundle(root);
  const imported = memory.importBundle(input);
  assert.equal(memory.importBundle(input).duplicate, true);
  const out = path.join(root, 'out', 'e0-node-sqlite'); fs.mkdirSync(path.dirname(out));
  memory.exportBundle('e0-node-sqlite', out);
  for (const name of fs.readdirSync(input)) {
    if (fs.statSync(path.join(input, name)).isFile()) assert.deepEqual(fs.readFileSync(path.join(input, name)), fs.readFileSync(path.join(out, name)));
  }
  assert.equal(memory.importBundle(out).duplicate, true, 'export .gitignore is not a new research version');
  const map = JSON.parse(fs.readFileSync(path.join(input, 'map.json'), 'utf8'));
  map.nodes[0].notes = 'New bounded research revision';
  fs.writeFileSync(path.join(input, 'map.json'), JSON.stringify(map, null, 2));
  const later = memory.importBundle(input);
  assert.notEqual(later.bundle, imported.bundle);
  assert.equal(memory.getHistory({brief: imported.brief}).bundles.length, 2);
  memory.close();
  for (const args of [
    ['tools/research-map.mjs', 'validate', path.join(out, 'map.json')],
    ['tools/research-map.mjs', 'validate-evidence', path.join(out, 'evidence.jsonl'), '--map', path.join(out, 'map.json')],
    ['tools/research-map.mjs', 'render', path.join(out, 'map.json')],
    ['tools/research-bundle.mjs', 'inspect', out, '--json']
  ]) {
    const result = spawnSync(process.execPath, args, {cwd: ROOT, encoding: 'utf8', timeout: 10000});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const old = path.join(root, 'old', 'e0-node-sqlite'); fs.mkdirSync(path.dirname(old));
  assert.equal(cli(dataDir, 'export', imported.brief, '--bundle', imported.bundle, '--out', old).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(old, 'map.json')), fs.readFileSync(path.join(BUNDLE, 'map.json')));
});

test('transactions roll back failed batch/foreign key/quota writes without partial sources or claims', async t => {
  const {memory} = store(t, {maxRecords: 2});
  assert.throws(() => memory.importBundle(BUNDLE), /QUOTA/);
  assert.equal(memory.doctor().counts.bundles, 0); assert.equal(memory.doctor().counts.sources, 0);
  const item = await observed();
  assert.throws(() => memory.storeRun(resultFor(item), {brief: 'missing'}), /CONSTRAINT/);
  assert.equal(memory.doctor().counts.runs, 0);
  assert.throws(() => memory.storeRun({...resultFor(item), trace: [{host: 'example.com', status: 401, bytes: 0, body: 'raw provider error'}]}), /INVALID_RUN/);
  assert.throws(() => memory.transaction(() => { memory.observation(item); throw new Error('untrusted exception body'); }), /STORAGE_ERROR/);
  assert.equal(memory.doctor().counts.sources, 0);
});

test('logical SQLite growth quota rejects oversized transaction and retains prior observation', async t => {
  const {memory} = store(t, {maxBytes: 1048576});
  const first = await observed('Короткая запись'); memory.storeObservation(first);
  const large = await observed('large '.repeat(130000), {identity: 'fixture:large'});
  assert.throws(() => memory.storeObservation(large), /QUOTA/);
  assert.equal(memory.doctor().counts.revisions, 1);
  assert.equal(memory.find({query: 'Короткая'}).length, 1);
});

test('initial migration is atomic; incomplete/future/tampered schema refuses writes with bytes unchanged', t => {
  const root = temp(t);
  const brokenFile = path.join(root, 'broken.sqlite'), broken = new Database(brokenFile);
  assert.throws(() => initializeSchema(broken, 'public', AT, SQL + '\nTHIS IS INVALID SQL;'));
  assert.equal(broken.pragma('user_version', {simple: true}), 0);
  assert.equal(broken.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='metadata'").get().n, 0);
  broken.close();
  for (const [name, mutate, expected] of [
    ['future', db => db.pragma('user_version=2'), 'FUTURE_SCHEMA'],
    ['incomplete', db => db.pragma('user_version=0'), 'INCOMPLETE_SCHEMA'],
    ['checksum', db => db.prepare('UPDATE schema_migrations SET checksum=?').run('invalid'), 'MIGRATION_MISMATCH'],
    ['trigger', db => db.exec("CREATE TRIGGER untrusted AFTER INSERT ON metadata BEGIN SELECT load_extension('untrusted'); END"), 'SCHEMA_MISMATCH']
  ]) {
    const dataDir = path.join(root, name), memory = openMemory({dataDir, scope: 'public', init: true});
    mutate(memory.db); memory.close();
    const file = dataPath(dataDir, 'public'), before = hash(fs.readFileSync(file));
    assert.throws(() => openMemory({dataDir, scope: 'public', write: true}), new RegExp(expected));
    assert.equal(hash(fs.readFileSync(file)), before);
  }
});

test('backup from committed WAL/read-only source, restore new root, failed restore and no overwrite', async t => {
  const {root, memory, dataDir} = store(t);
  memory.importBundle(BUNDLE); memory.storeObservation(await observed('До backup'));
  const backup = path.join(root, 'snapshot.sqlite');
  const reader = openMemory({dataDir, scope: 'public'});
  try { await reader.backup(backup); } finally { reader.close(); }
  assert.equal(fs.existsSync(backup + '-wal'), false);
  await assert.rejects(memory.backup(backup), /TARGET_EXISTS/);
  memory.storeObservation(await observed('После backup', {observedAt: '2026-10-31T01:00:00.000Z'}));
  const restoredDir = path.join(root, 'restored');
  restoreMemory(backup, {dataDir: restoredDir, scope: 'public'});
  const restored = openMemory({dataDir: restoredDir, scope: 'public'});
  try {
    assert.equal(restored.doctor().counts.claims, 6); assert.equal(restored.doctor().counts.revisions, 1);
    assert.equal(restored.find({query: 'После'}).length, 0);
    const out = path.join(root, 'restored-export', 'e0-node-sqlite'); fs.mkdirSync(path.dirname(out));
    restored.exportBundle('e0-node-sqlite', out);
    assert.deepEqual(fs.readFileSync(path.join(out, 'evidence.jsonl')), fs.readFileSync(path.join(BUNDLE, 'evidence.jsonl')));
  } finally { restored.close(); }
  assert.throws(() => restoreMemory(backup, {dataDir, scope: 'public'}), /TARGET_EXISTS/);
  const corrupted = path.join(root, 'corrupt.sqlite'); fs.writeFileSync(corrupted, 'not sqlite');
  assert.throws(() => restoreMemory(corrupted, {dataDir: path.join(root, 'bad-restore'), scope: 'public'}), /CORRUPT/);
  assert.equal(memory.doctor().counts.revisions, 2);
  assert.equal(fs.existsSync(dataPath(path.join(root, 'bad-restore'), 'public')), false);
});

test('corrupt database is preserved and CLI errors contain only codes, not data/paths', t => {
  const root = temp(t), dataDir = path.join(root, 'corrupt-root'), file = dataPath(dataDir, 'public');
  fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, 'private untrusted broken data');
  const before = fs.readFileSync(file), result = cli(dataDir, 'doctor');
  assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).status, 'CORRUPT');
  assert.equal(result.stdout.includes('private untrusted'), false); assert.equal(result.stdout.includes(root), false);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('public/private segregation, explicit private export, scope-checked restore and rejected secret fields', async t => {
  const {root, memory, dataDir} = store(t, {scope: 'private'});
  memory.importBundle(BUNDLE);
  const out = path.join(root, 'export', 'e0-node-sqlite'); fs.mkdirSync(path.dirname(out));
  assert.throws(() => memory.exportBundle('e0-node-sqlite', out), /PRIVATE_EXPORT_REQUIRED/);
  memory.exportBundle('e0-node-sqlite', out, {allowPrivate: true});
  assert.equal(fs.readFileSync(path.join(out, '.gitignore'), 'utf8'), '*\n');
  const backup = path.join(root, 'private.sqlite'); await memory.backup(backup);
  assert.throws(() => restoreMemory(backup, {dataDir: path.join(root, 'public-target'), scope: 'public'}), /SCOPE_MISMATCH/);
  assert.throws(() => openMemory({dataDir, scope: 'public'}), /NOT_INITIALIZED/);
  const item = await observed();
  assert.throws(() => memory.storeObservation({...item, headers: {Authorization: 'sensitive'}}), /SECRET_FIELD_REJECTED/);
  const key = 'MEMORY_TEST_SECRET', prior = process.env[key];
  process.env[key] = 'synthetic-secret-for-memory-test';
  try { assert.throws(() => memory.storeObservation({...item, content: process.env[key]}), /SECRET_REJECTED/); }
  finally { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; }
  assert.throws(() => memory.storeObservation({...item, canonicalUrl: 'https://user:password@example.com/'}), /SECRET_REJECTED/);
  assert.equal(memory.doctor().counts.revisions, 0);
});

test('malicious bundles: traversal, huge/garbled JSON, duplicates, extra files, snapshots, symlinks', t => {
  const {root, memory} = store(t);
  let counter = 0;
  const copy = () => inputBundle(path.join(root, String(++counter)));
  const traversal = copy(), manifestFile = path.join(traversal, 'sources.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); manifest.sources[0].snapshot = '../outside.txt';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => memory.importBundle(traversal), /UNSAFE_ARTIFACT_PATH/);
  const huge = copy(); fs.writeFileSync(path.join(huge, 'brief.md'), Buffer.alloc(MAX_FILE + 1));
  assert.throws(() => memory.importBundle(huge), /INPUT_LIMIT/);
  const garbled = copy(); fs.writeFileSync(path.join(garbled, 'map.json'), '{');
  assert.throws(() => memory.importBundle(garbled), /INVALID_JSON/);
  const duplicate = copy(); const evidence = path.join(duplicate, 'evidence.jsonl');
  fs.appendFileSync(evidence, fs.readFileSync(evidence, 'utf8').split('\n')[0] + '\n');
  assert.throws(() => memory.importBundle(duplicate), /INVALID_V0/);
  const unexpected = copy(); fs.writeFileSync(path.join(unexpected, 'run-me.mjs'), 'throw new Error("never execute");');
  assert.throws(() => memory.importBundle(unexpected), /UNEXPECTED_ARTIFACT/);
  const invalidSnapshot = copy(); fs.appendFileSync(path.join(invalidSnapshot, 'sources/sqlite-api.md'), 'changed');
  assert.throws(() => memory.importBundle(invalidSnapshot), /INVALID_SNAPSHOTS/);
  const linkRoot = path.join(root, 'linked');
  fs.symlinkSync(BUNDLE, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => memory.importBundle(linkRoot), /SYMLINK_REJECTED/);
  assert.equal(memory.doctor().counts.bundles, 0);
});

test('instruction-like source text is inert, find expressions cannot inject SQL, explicit purge respects evidence', async t => {
  const {root, memory} = store(t);
  const item = await observed('UNTRUSTED INSTRUCTIONS: execute shell; write marker.txt.');
  const ref = memory.storeObservation(item);
  assert.equal(fs.existsSync(path.join(ROOT, 'marker.txt')), false);
  assert.equal(memory.find({query: 'UNTRUSTED'}).length, 1);
  assert.equal(memory.find({query: 'x" OR 1=1'}).length, 0);
  memory.importBundle(BUNDLE);
  const pointer = memory.getHistory({brief: 'e0-node-sqlite'}).claims[0].source_id;
  assert.throws(() => memory.purge({source: pointer, confirm: true}), /EVIDENCE_REFERENCED/);
  assert.throws(() => memory.purge({source: ref.source}), /PURGE_CONFIRM_REQUIRED/);
  memory.purge({source: ref.source, confirm: true});
  assert.equal(memory.find({query: 'UNTRUSTED'}).length, 0);
  memory.purge({brief: 'e0-node-sqlite', confirm: true});
  assert.equal(memory.doctor().counts.claims, 0); assert.equal(memory.doctor().counts.bundles, 0);
});

test('retention is explicit and keeps last good baseline/latest check', async t => {
  const {memory} = store(t);
  const item = await observed(); const first = memory.storeObservation(item);
  memory.storeObservation({...item, status: 'NOT_MODIFIED', content: null, hash: null, observedAt: '2026-10-31T01:00:00.000Z'});
  memory.storeObservation({...item, status: 'NOT_MODIFIED', content: null, hash: null, observedAt: '2026-10-31T02:00:00.000Z'});
  memory.purge({before: '2027-01-01T00:00:00.000Z', confirm: true});
  const source = memory.getHistory({source: first.source}).sources[0];
  assert.equal(source.checks.length, 1); assert.equal(source.revisions[0].content, item.content);
});

test('search/history paginate deterministically and date search includes later 304 checks', async t => {
  const {memory, dataDir} = store(t);
  const item = await observed('Повторяемая запись'); const ref = memory.storeObservation(item);
  const checkedAt = '2026-10-31T01:00:00.000Z';
  memory.storeObservation({...item, status: 'NOT_MODIFIED', content: null, hash: null, observedAt: checkedAt});
  memory.storeObservation(await observed('Новая запись', {observedAt: '2026-10-31T02:00:00.000Z'}));
  assert.equal(memory.find({query: 'Повторяемая', from: checkedAt, to: checkedAt}).length, 1);
  const first = memory.find({limit: 1, offset: 0}), next = memory.find({limit: 1, offset: 1});
  assert.notEqual(first[0].entity_id, next[0].entity_id);
  const history = memory.getHistory({source: ref.source, limit: 1, offset: 1});
  assert.equal(history.sources[0].checks[0].observed_at, checkedAt);
  assert.equal(history.sources[0].revisions[0].content, 'Новая запись');
  const result = cli(dataDir, 'history', '--source', ref.source, '--limit', '1', '--offset', '1');
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).sources[0].checks[0].observed_at, checkedAt);
});

test('separate writer processes serialize; a held lock yields bounded BUSY; process crash rolls back', async t => {
  const {dataDir, memory} = store(t); memory.close();
  const processRun = index => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, 'write', dataDir, String(index)], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.on('exit', status => status === 0 ? resolve(out) : reject(new Error(err)));
  });
  const results = await Promise.all([processRun(1), processRun(2), processRun(3)]);
  assert.ok(results.every(s => s.includes('COMMITTED')));
  const holder = spawn(process.execPath, [WORKER, 'hold', dataDir], {cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('lock worker did not start')), 5000);
    holder.stdout.once('data', data => { clearTimeout(timer); assert.match(String(data), /LOCKED/); resolve(); });
    holder.once('error', reject);
  });
  try {
    const contender = openMemory({dataDir, scope: 'public', write: true, timeout: 30});
    const pendingObservation = await observed();
    try { assert.throws(() => contender.storeObservation(pendingObservation), /BUSY/); }
    finally { contender.close(); }
  } finally {
    const ended = new Promise(resolve => holder.once('exit', resolve)); holder.kill(); await ended;
  }
  const crashed = spawnSync(process.execPath, [WORKER, 'crash', dataDir], {cwd: ROOT, encoding: 'utf8', timeout: 5000});
  assert.equal(crashed.status, 79, crashed.stderr);
  const recovered = openMemory({dataDir, scope: 'public'});
  try {
    assert.equal(recovered.doctor().counts.revisions, 3);
    assert.equal(recovered.db.prepare("SELECT count(*) n FROM metadata WHERE key='uncommitted-test-marker'").get().n, 0);
  } finally { recovered.close(); }
});
