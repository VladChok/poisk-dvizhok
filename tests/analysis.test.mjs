import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {openMemory, restoreMemory} from '../memory/store.mjs';
import {dataPath, hash} from '../memory/safety.mjs';
import {migrateToV2} from '../memory/migrate.mjs';
import {fingerprint, CHECKSUM} from '../memory/schema.mjs';
import {openAnalysis, renderReport} from '../analysis/store.mjs';
import {comparePair, contentIdentity} from '../analysis/records.mjs';
import {createHarness} from '../harness/engine.mjs';
import {parseFeed} from '../harness/feed.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url)), BUNDLE = path.join(ROOT, 'research/e0-node-sqlite');
const AT = '2026-10-31T00:00:00.000Z', NEXT = '2026-10-31T01:00:00.000Z', BRIEF = 'e0-node-sqlite';
const clock = () => AT, ref = (kind, id, extra = {}) => ({kind, id, ...extra});
async function setup(t, {migrate = true, scope = 'public'} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-analysis-')), dataDir = path.join(root, 'state');
  let memory = openMemory({dataDir, scope, init: true, clock}), analysis;
  t.after(() => { if (memory.db.open) memory.close(); fs.rmSync(root, {recursive: true, force: true}); });
  const imported = memory.importBundle(BUNDLE), backup = path.join(root, 'v1.sqlite');
  if (migrate) {
    memory.close(); await migrateToV2({dataDir, scope, backup, clock});
    analysis = openAnalysis({dataDir, scope, write: true, clock}); memory = analysis.memory;
  }
  return {root, dataDir, backup, imported, scope, memory, analysis};
}
async function observation(content = 'Кириллица 研究 A', extra = {}) {
  const result = await createHarness({}, {clock: () => Date.parse(AT), fixture: {version: 1, items: [{id: 'same', content}]}}).discover('fixture');
  return {...result.observations[0], ...extra};
}
const acquisition = (items = [], extra = {}) => ({version: 1, adapter: 'fixture', status: 'OK', observations: items,
  limitations: [], requests: 0, trace: [], request: {operation: 'discover', url: 'https://feeds.example.com/news'}, ...extra});
const cli = (dir, ...args) => spawnSync(process.execPath, ['tools/research-analysis.mjs', ...args, '--data-dir', dir, '--scope', 'public', '--json'],
  {cwd: ROOT, encoding: 'utf8', timeout: 20000});
const statement = (text, kind = 'author_claim', value = null) => ({text, kind, value});
function linkInput(a, b, extra = {}) {
  return {left: a, right: b, leftStatement: statement('Population is 10', 'author_claim', 10),
    rightStatement: statement('Population is 12', 'interpretation', 12), brief: BRIEF, relation: 'DISPUTES',
    subject: {id: 'place:example', label: 'Example', context: 'Synthetic location, census year 2025, same unit'},
    actor: 'fixture-reviewer', rationale: 'Two explicitly selected statements about the same bounded subject.', ...extra};
}

test('explicit v1→v2 migration retains v0 and checksum, takes real backup, is idempotent; old API refuses v2', async t => {
  const {memory, dataDir, backup} = await setup(t);
  assert.equal(memory.doctor().schema, 2); assert.equal(memory.doctor().counts.claims, 6);
  assert.equal(memory.db.prepare('SELECT checksum FROM schema_migrations WHERE version=1').get().checksum, CHECKSUM);
  assert.equal(memory.db.prepare('SELECT count(*) n FROM schema_migrations').get().n, 2);
  const old = new Database(backup, {readonly: true}); assert.equal(old.pragma('user_version', {simple: true}), 1); old.close();
  assert.throws(() => openMemory({dataDir, scope: 'public'}), /FUTURE_SCHEMA/);
  assert.equal((await migrateToV2({dataDir, scope: 'public'})).changed, false);
});

test('migration requires backup, refuses overwrite and busy writer; invalid SQL rolls back with usable v1 backup', async t => {
  const {memory, dataDir, root} = await setup(t, {migrate: false});
  const before = fingerprint(memory.db), backup = path.join(root, 'failed.sqlite');
  await assert.rejects(migrateToV2({dataDir, scope: 'public'}), /MIGRATION_BACKUP_REQUIRED/);
  memory.db.exec('BEGIN IMMEDIATE');
  await assert.rejects(migrateToV2({dataDir, scope: 'public', backup, timeout: 25}), /BUSY/);
  memory.db.exec('ROLLBACK'); assert.equal(fs.existsSync(backup), false);
  await assert.rejects(migrateToV2({dataDir, scope: 'public', backup, migrationSQL: 'CREATE TABLE interrupted(x); SELECT * FROM missing_table;'}), /STORAGE_ERROR/);
  assert.equal(fingerprint(memory.db), before); assert.equal(memory.doctor().schema, 1);
  assert.equal(memory.doctor().counts.claims, 6);
  await assert.rejects(migrateToV2({dataDir, scope: 'public', backup}), /TARGET_EXISTS/);
  const saved = new Database(backup, {readonly: true}); assert.equal(saved.pragma('quick_check', {simple: true}), 'ok'); saved.close();
});

test('reads never initialize/migrate; future or drifted v2 schema is refused', async t => {
  const {memory, dataDir, root} = await setup(t, {migrate: false});
  assert.throws(() => openAnalysis({dataDir, scope: 'public'}), /MIGRATION_REQUIRED/);
  assert.equal(memory.doctor().schema, 1);
  const absent = path.join(root, 'absent'); assert.equal(cli(absent, 'list', '--type', 'links').status, 1);
  assert.equal(fs.existsSync(absent), false);
  memory.db.pragma('user_version=3');
  await assert.rejects(migrateToV2({dataDir, scope: 'public', backup: path.join(root, 'future.sqlite')}), /FUTURE_SCHEMA/);
  memory.db.pragma('user_version=1'); memory.close();
  await migrateToV2({dataDir, scope: 'public', backup: path.join(root, 'valid.sqlite')});
  const tampered = new Database(dataPath(dataDir, 'public')); tampered.exec('DROP TRIGGER evidence_links_immutable_update'); tampered.close();
  assert.throws(() => openAnalysis({dataDir, scope: 'public'}), /SCHEMA_MISMATCH/);
});

test('same bytes on new retrieval date are SAME; changed/whitespace/translation bytes never become factual contradiction', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const first = await observation(), x = m.storeObservation(first);
  const again = m.storeObservation({...first, observedAt: NEXT}), y = m.storeObservation(await observation('Кириллица 研究 A '));
  const same = a.compare(ref('check', x.check), ref('check', again.check), {brief: BRIEF, save: true});
  assert.equal(same.verdict, 'SAME'); assert.equal(same.pairs[0].right.retrievedAt, NEXT);
  assert.equal(same.pairs[0].right.publishedAt, null); assert.equal(same.pairs[0].right.eventAt, null);
  const changed = a.compare(ref('revision', x.revision), ref('revision', y.revision));
  assert.equal(changed.verdict, 'CHANGED'); assert.equal(changed.factualContradiction, false);
  const translated = m.storeObservation(await observation('Cyrillic research A'));
  assert.equal(a.compare(ref('check', x.check), ref('check', translated.check)).factualContradiction, false);
  assert.equal(a.compare(ref('check', x.check), ref('check', again.check), {brief: BRIEF, save: true}).id, same.id);
  assert.equal(a.list('comparisons').length, 1); assert.equal(m.find({query: 'SAME'}).some(r => r.kind === 'comparison'), true);
});

test('304 only reuses an historical matching validator; unknown/future baseline, empty body or missing hash is inconclusive', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const first = await observation('baseline', {etag: '"v1"'}), x = m.storeObservation(first);
  const conditional = {...first, content: null, hash: null, status: 'NOT_MODIFIED', observedAt: NEXT};
  const reused = m.storeObservation(conditional);
  assert.equal(a.compare(ref('check', x.check), ref('check', reused.check)).verdict, 'SAME');
  const mismatch = m.storeObservation({...conditional, etag: '"different"'});
  assert.equal(a.compare(ref('check', x.check), ref('check', mismatch.check)).verdict, 'INCONCLUSIVE');
  const noValidator = m.storeObservation({...conditional, etag: null, lastModified: null});
  assert.equal(a.compare(ref('check', x.check), ref('check', noValidator.check)).verdict, 'INCONCLUSIVE');
  const future = m.storeObservation({...conditional, observedAt: '2020-01-01T00:00:00.000Z'});
  assert.equal(a.compare(ref('check', x.check), ref('check', future.check)).verdict, 'INCONCLUSIVE');
  const unknown = m.storeObservation(await observation('', {hash: null, revision: null, content: null, identity: 'fixture:unknown'}));
  assert.equal(a.compare(ref('revision', unknown.revision), ref('revision', unknown.revision)).verdict, 'INCONCLUSIVE');
});

test('different identities/names/types never auto-merge or corroborate identical syndicated content', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const base = await observation('same syndicated text'), x = m.storeObservation(base);
  const y = m.storeObservation({...base, identity: 'fixture:same-name-other-actor', canonicalUrl: 'fixture:other'});
  const compared = a.compare(ref('revision', x.revision), ref('revision', y.revision));
  assert.equal(compared.verdict, 'INCONCLUSIVE'); assert.deepEqual(compared.pairs[0].hints, ['IDENTICAL_TEXT_POSSIBLE_SYNDICATION']);
  const linked = a.link(linkInput(ref('revision', x.revision), ref('revision', y.revision), {relation: 'SUPPORTS', commonOrigin: {locator: 'fixture:publisher', basis: 'Operator found a shared origin.'}}));
  assert.equal(linked.independence, 'SHARED_ORIGIN_MANUAL_HINT'); assert.equal(linked.engineVerifiedTruth, false);
  assert.equal(comparePair({...compared.pairs[0].left, sourceType: 'file'}, compared.pairs[0].right).verdict, 'INCONCLUSIVE');
  const mismatched = m.storeObservation({...base, sourceType: 'file', content: 'different type with a new stored revision'});
  assert.equal(a.compare(ref('revision', mismatched.revision), ref('revision', mismatched.revision)).verdict, 'INCONCLUSIVE');
  const conflictingCheck = m.storeObservation({...base, sourceType: 'file'});
  assert.equal(a.compare(ref('check', x.check), ref('check', conflictingCheck.check)).verdict, 'INCONCLUSIVE');
});

test('GitHub pinned files compare across commits only for exact repository/path, never unrelated commits', async t => {
  const {analysis: a, memory: m} = await setup(t), base = await observation('pinned');
  function github(commit, file = 'doc.md') {
    return {...base, adapter: 'github', sourceType: 'file', identity: `github:owner/project:${commit}:${file}`,
      revision: commit, canonicalUrl: `https://github.com/owner/project/blob/${commit}/${file}`};
  }
  const x = m.storeObservation(github('a'.repeat(40))), y = m.storeObservation(github('b'.repeat(40)));
  const pinned = a.compare(ref('revision', x.revision), ref('revision', y.revision));
  assert.equal(pinned.verdict, 'CHANGED'); assert.deepEqual(pinned.pairs[0].changedFields, ['revision']);
  const z = m.storeObservation(github('b'.repeat(40), 'other.md'));
  assert.equal(a.compare(ref('revision', x.revision), ref('revision', z.revision)).verdict, 'INCONCLUSIVE');
  assert.doesNotThrow(() => contentIdentity({adapter: 'github', source_type: 'file', identity: 'malformed'}, {...base, canonicalUrl: `https://github.com/o/r/blob/${'a'.repeat(40)}/%xy`}));
});

test('failed/empty/partial runs and missing candidates do not imply deletion or prove absence', async t => {
  const {analysis: a, memory: m} = await setup(t), base = await observation();
  const x = m.storeRun(acquisition([base]), {key: 'first', brief: BRIEF});
  const failed = m.storeRun(acquisition([], {status: 'NOT_FOUND'}), {key: 'failed', brief: BRIEF, at: NEXT, source: x.observations[0].source});
  const failure = a.compare(ref('run', x.run), ref('run', failed.run), {save: true});
  assert.equal(failure.verdict, 'UNAVAILABLE'); assert.equal(failure.absence, 'NOT_PROVEN');
  assert.ok(failure.pairs.some(p => p.right?.lastKnownPointer?.version === base.revision));
  const empty = m.storeRun(acquisition([]), {key: 'empty'});
  assert.equal(a.compare(ref('run', x.run), ref('run', empty.run)).verdict, 'INCONCLUSIVE');
  const partial = m.storeRun(acquisition([base], {status: 'PARTIAL', limitations: ['PAGINATION_LIMIT']}), {key: 'partial'});
  assert.equal(a.compare(ref('run', x.run), ref('run', partial.run)).verdict, 'INCONCLUSIVE');
  assert.equal(a.compare(ref('run', empty.run), ref('run', empty.run)).verdict, 'INCONCLUSIVE');
});

test('RSS run 304 inherits captured entry membership through validated root, not invented feed bytes', async t => {
  const {analysis: a, memory: m} = await setup(t), base = await observation('feed text');
  const url = 'https://feeds.example.com/news';
  const entry = {...base, adapter: 'rss', sourceType: 'feed-entry', identity: url + '#entry=one', canonicalUrl: 'https://publisher.example.com/post', accessRoute: url};
  const first = m.storeRun(acquisition([entry], {adapter: 'rss', feed: {identity: url, updatedAt: null, etag: '"root1"', lastModified: null, hash: hash('root'), totalItems: 1}}), {key: 'feed'});
  const root = {...entry, sourceType: 'feed', identity: url, canonicalUrl: url, content: null, hash: null, revision: null, status: 'NOT_MODIFIED', etag: '"root1"', observedAt: NEXT};
  const second = m.storeRun(acquisition([root], {adapter: 'rss', status: 'NOT_MODIFIED'}), {key: '304'});
  const compared = a.compare(ref('run', first.run), ref('run', second.run), {save: true});
  assert.equal(compared.verdict, 'SAME'); assert.equal(compared.pairs[0].right.retrievedAt, NEXT);
  assert.equal(compared.pairs[0].right.inheritedFromRun, first.run);
  const unknown = m.storeRun(acquisition([{...root, etag: '"unknown"'}], {adapter: 'rss', status: 'NOT_MODIFIED'}), {key: 'no-validator'});
  assert.equal(a.compare(ref('run', first.run), ref('run', unknown.run)).verdict, 'INCONCLUSIVE');
  assert.ok(a.coverage({family: '304', question: 'Unvalidated check', runIds: [unknown.run]}).gaps.includes('UNVALIDATED_304_BASELINE'));
});

test('adapter coverage records real pages, raw/inspected/duplicate/invalid/filter counts and caps; configured fixture doctor stays available', async () => {
  const fixture = createHarness({adapters: {github: false}}, {fixture: {version: 1, items: [{id: 'one', content: 'one'}, {id: 'one', content: 'dupe'}, {id: 'broken'}, {id: 'two', content: 'two'}]}});
  const report = await fixture.discover('fixture', {id: 'one'});
  assert.equal(report.coverage.itemsSeen, 4); assert.equal(report.coverage.duplicateItems, 1);
  assert.equal(report.coverage.invalidItems, 1); assert.equal(report.coverage.filteredItems, 1);
  assert.equal((await fixture.doctor({live: true})).adapters.find(r => r.adapter === 'fixture').status, 'AVAILABLE');
  const feed = parseFeed('<rss><channel><item><guid>a</guid></item><item><guid>a</guid></item><item/><item><guid>b</guid></item></channel></rss>', 'https://feeds.example.com/news', 10);
  assert.deepEqual(feed.counters, {itemsSeen: 4, itemsInspected: 4, duplicateItems: 1, invalidItems: 1, filteredItems: 0});
  const responses = [{items: [{id: 1, full_name: 'o/a', private: false}, {id: 1, full_name: 'o/a', private: false}, {id: 2, full_name: 'o/b', private: true}, {id: 3, full_name: '..', private: false}]}];
  const github = createHarness({limits: {minIntervalMs: 0}}, {token: '', lookup: async () => [{address: '8.8.8.8', family: 4}],
    wire: async () => ({status: 200, headers: {'content-type': 'application/json'}, body: JSON.stringify(responses.shift())})});
  const actual = (await github.discover('github', {query: 'plain'})).coverage;
  assert.equal(actual.pagesFetched, 1); assert.equal(actual.itemsSeen, 4); assert.equal(actual.itemsInspected, 4);
  assert.equal(actual.duplicateItems, 1); assert.equal(actual.invalidItems, 1); assert.equal(actual.filteredItems, 1);
});

test('query history separates planned routes and labels from actual runs/counters; legacy counters stay unknown', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const actual = await createHarness({}, {fixture: {version: 1, items: [{id: 'query', content: 'coverage'}]}, clock: () => Date.parse(AT)}).discover('fixture');
  const used = m.storeRun(actual, {key: 'query', brief: BRIEF});
  const legacy = m.storeRun(acquisition([]), {key: 'legacy', brief: BRIEF});
  m.route(legacy.run, 'CUT', 'No captured credible source; leave gap open.');
  const source = m.db.prepare('SELECT source_id FROM run_sources WHERE run_id=?').get(used.run).source_id;
  const spec = {brief: BRIEF, family: 'population', question: 'What value for the same place/year?', variants: ['население', 'population'],
    runIds: [used.run, legacy.run], plannedRoutes: [{adapter: 'web', query: 'future query', note: 'Provider unavailable; not executed.'}],
    language: 'ru', region: 'synthetic', dateWindow: {from: AT, to: NEXT},
    decisions: [{source, verdict: 'WATCH', reason: 'Manual candidate label, no scheduled execution.'}], negative: {statement: 'No source in the bounded result.'}};
  const saved = a.coverage(spec, {save: true});
  assert.equal(a.coverage(spec, {save: true}).id, saved.id); assert.equal(a.list('coverage').length, 1);
  assert.equal(saved.negative.verdict, 'NOT_PROVEN'); assert.equal(saved.plannedRoutes[0].access, 'PLANNED_ONLY');
  const actualRun = saved.usedRoutes.find(r => r.id === used.run), unknown = saved.usedRoutes.find(r => r.id === legacy.run);
  assert.equal(actualRun.counters.itemsSeen, 1); assert.equal(actualRun.backendAppliedLanguage, null);
  assert.equal(unknown.counters, null); assert.ok(unknown.gaps.includes('LEGACY_COUNTERS_UNKNOWN')); assert.equal(unknown.routeEvents[0].state, 'CUT');
  assert.equal(saved.watch, 'OFF'); assert.equal(a.coverageForBrief(BRIEF).totalRuns, 2);
  assert.throws(() => a.coverage({...spec, negative: {statement: 'Nothing exists', verdict: 'PROVEN'}}, {save: true}), /UNSUPPORTED_NEGATIVE/);
  assert.throws(() => a.coverage({...spec, decisions: [{source, verdict: 'CUT', reason: ''}]}), /INVALID_ANALYSIS_INPUT/);
  assert.throws(() => a.coverage({...spec, runIds: [], decisions: spec.decisions}), /DECISION_NOT_IN_SCOPE/);
  assert.throws(() => a.coverage({...spec, dateWindow: {from: NEXT, to: AT}}), /INVALID_DATE/);
});

test('manual competing values/dates/positions require attributed real anchors; kinds stay separate and review withdrawal appends', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const x = m.storeObservation(await observation()), y = m.storeObservation(await observation('different', {identity: 'fixture:other'}));
  const input = linkInput(ref('revision', x.revision), ref('check', y.check), {rightStatement: {...statement('Event happened later', 'interpretation', 'later'), eventAt: NEXT}});
  const linked = a.link(input); assert.equal(a.link(input).id, linked.id);
  assert.equal(linked.left.statement.kind, 'author_claim'); assert.equal(linked.right.statement.kind, 'interpretation');
  assert.equal(linked.right.statement.textVerifiedAgainstSource, false); assert.equal(linked.right.snapshot.eventAt, null);
  const reviewed = a.review(linked.id, {decision: 'ACCEPTED', actor: 'manual-reviewer', rationale: 'Accept for further investigation.', key: 'review-1'});
  assert.equal(a.review(linked.id, {decision: 'ACCEPTED', actor: 'manual-reviewer', rationale: 'Accept for further investigation.', key: 'review-1'}).id, reviewed.id);
  assert.throws(() => a.review(linked.id, {decision: 'DISMISSED', actor: 'other', rationale: 'Conflict', key: 'review-1'}), /IDEMPOTENCY_CONFLICT/);
  a.review(linked.id, {decision: 'WITHDRAWN', actor: 'manual-reviewer', rationale: 'Recheck the event time.', key: 'review-2'});
  const ledger = a.getLink(linked.id); assert.equal(ledger.reviews.length, 2); assert.equal(ledger.reviews[1].decision, 'WITHDRAWN');
  assert.equal(ledger.relation, 'DISPUTES'); assert.equal(ledger.engineVerifiedTruth, false);
  assert.throws(() => a.link({...input, actor: ''}), /INVALID_ANALYSIS_INPUT/);
  assert.throws(() => a.link({...input, left: ref('revision', '0'.repeat(64))}), /NOT_FOUND/);
  assert.throws(() => a.link({...input, leftStatement: statement('Automatically PROVEN', 'PROVEN')}), /INVALID_STATEMENT_KIND/);
  assert.throws(() => a.link({...input, subject: {id: 'ambiguous', label: 'Example'}}), /INVALID_ANALYSIS_INPUT/);
});

test('v0 actual claims keep original kind/text/pointer and cannot be rewritten as interpretations or promoted facts', async t => {
  const {analysis: a, memory: m, imported} = await setup(t);
  const claims = m.db.prepare('SELECT claim_id,original_json FROM claims WHERE bundle_id=? ORDER BY claim_id').all(imported.bundle);
  const input = linkInput(ref('claim', imported.bundle, {claim: claims[0].claim_id}), ref('claim', imported.bundle, {claim: claims[1].claim_id}));
  delete input.leftStatement; delete input.rightStatement;
  const linked = a.link(input), original = JSON.parse(claims[0].original_json);
  assert.deepEqual(linked.left.statement.original, original); assert.deepEqual(linked.left.snapshot.pointer, original.pointer);
  assert.equal(linked.left.statement.kind, original.kind); assert.equal(linked.left.statement.text, original.claim);
  assert.throws(() => a.link({...input, leftStatement: statement('Override', 'fact')}), /CANNOT_OVERRIDE_V0_CLAIM/);
  assert.equal(a.compare(input.left, input.right).verdict, 'INCONCLUSIVE');
});

test('SQLite triggers prohibit audit edits/deletes; E2 purge cannot remove referenced source/check/bundle', async t => {
  const {analysis: a, memory: m, imported} = await setup(t);
  const x = m.storeObservation(await observation()), y = m.storeObservation(await observation('later'));
  const linked = a.link(linkInput(ref('check', x.check), ref('revision', y.revision)));
  a.review(linked.id, {decision: 'OPEN', actor: 'reviewer', rationale: 'Open issue.'});
  a.compare(ref('check', x.check), ref('check', y.check), {brief: BRIEF, save: true});
  assert.throws(() => m.db.prepare('UPDATE evidence_links SET actor=? WHERE id=?').run('rewrite', linked.id), /immutable/);
  assert.throws(() => m.db.prepare('DELETE FROM evidence_reviews').run(), /immutable/);
  assert.throws(() => m.purge({source: x.source, confirm: true}), /CONSTRAINT/);
  assert.equal(a.getLink(linked.id).reviews.length, 1);
  const claim = ref('claim', imported.bundle, {claim: 'c1'}), claim2 = ref('claim', imported.bundle, {claim: 'c2'});
  const input = linkInput(claim, claim2); delete input.leftStatement; delete input.rightStatement; a.link(input);
  assert.throws(() => m.purge({brief: BRIEF, confirm: true}), /CONSTRAINT/);
  assert.equal(m.doctor().counts.claims, 6);
});

test('private scope/export guard, secret rejection, malformed references, caps and report markup are safe', async t => {
  const {analysis: a, memory: m, root, dataDir} = await setup(t, {scope: 'private'});
  const x = m.storeObservation(await observation()), y = m.storeObservation(await observation('different'));
  const input = linkInput(ref('revision', x.revision), ref('revision', y.revision), {rationale: '<script>alert(1)</script>\n` code [link](javascript:alert(1))'});
  a.link(input);
  assert.throws(() => a.exportReport(BRIEF, path.join(root, 'no')), /PRIVATE_EXPORT_REQUIRED/);
  const destination = path.join(root, 'report'); a.exportReport(BRIEF, destination, {allowPrivate: true});
  assert.equal(fs.readFileSync(path.join(destination, '.gitignore'), 'utf8'), '*\n');
  const md = fs.readFileSync(path.join(destination, 'REPORT.md'), 'utf8');
  assert.match(md, /`` <script>alert\(1\)<\/script> ` code/); assert.equal(md.includes('\n<script>'), false);
  assert.throws(() => a.exportReport(BRIEF, destination, {allowPrivate: true}), /TARGET_EXISTS/);
  assert.throws(() => a.link({...input, rationale: 'Bearer syntheticSensitiveToken12345'}), /SECRET_REJECTED/);
  assert.throws(() => a.compare(ref('revision', "' OR 1=1 --"), ref('revision', x.revision)), /INVALID_REFERENCE/);
  assert.throws(() => a.coverage({family: 'x', question: 'x', runIds: Array(101).fill('0'.repeat(64))}), /INVALID_ANALYSIS_INPUT/);
  assert.throws(() => a.link({...input, actor: 'x'.repeat(129)}), /INVALID_ANALYSIS_INPUT/);
  assert.throws(() => a.list('links', {limit: 101}), /INVALID_QUERY/);
  assert.throws(() => a.list('links; DROP TABLE sources'), /INVALID_QUERY/);
  assert.throws(() => openAnalysis({dataDir, scope: 'public'}), /NOT_INITIALIZED/);
  assert.equal(renderReport(a.report(BRIEF)), md);
});

test('comparison/link/coverage survive reopen and online v2 backup/restore; pre-migration backup remains E2-readable rollback', async t => {
  const {analysis: a, memory: m, dataDir, root, backup} = await setup(t);
  const x = m.storeObservation(await observation()), y = m.storeObservation(await observation('new'));
  const c = a.compare(ref('check', x.check), ref('check', y.check), {brief: BRIEF, save: true});
  const l = a.link(linkInput(ref('revision', x.revision), ref('revision', y.revision)));
  const coverage = a.coverage({brief: BRIEF, family: 'plans', question: 'What remains?', runIds: []}, {save: true});
  const v2 = path.join(root, 'v2.sqlite'); await m.backup(v2); m.close();
  const reopened = openAnalysis({dataDir, scope: 'public'});
  try { assert.equal(reopened.getComparison(c.id).verdict, 'CHANGED'); assert.equal(reopened.getLink(l.id).relation, 'DISPUTES'); assert.equal(reopened.getCoverage(coverage.id).assessment, 'PLANNED_ONLY'); } finally { reopened.close(); }
  const restored = path.join(root, 'restored'); assert.equal(restoreMemory(v2, {dataDir: restored, scope: 'public', supportedVersion: 2}).schema, 2);
  const restoredAnalysis = openAnalysis({dataDir: restored, scope: 'public'}); try { assert.equal(restoredAnalysis.getLink(l.id).id, l.id); } finally { restoredAnalysis.close(); }
  const rollback = path.join(root, 'rollback'); assert.equal(restoreMemory(backup, {dataDir: rollback, scope: 'public'}).schema, 1);
  const old = openMemory({dataDir: rollback, scope: 'public'}); try { assert.equal(old.doctor().counts.claims, 6); } finally { old.close(); }
});

test('all v0 bundle bytes survive v2 export and existing validators/inspector', async t => {
  const {memory: m, root} = await setup(t), output = path.join(root, BRIEF);
  m.exportBundle(BRIEF, output);
  for (const row of m.db.prepare('SELECT path,bytes FROM artifacts').all()) assert.deepEqual(fs.readFileSync(path.join(output, row.path)), row.bytes);
  const result = spawnSync(process.execPath, ['tools/research-bundle.mjs', 'inspect', output, '--json'], {cwd: ROOT, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('offline CLI persists/reads comparisons, coverage, ledger and report; validates mutually exclusive and unused flags', async t => {
  const {memory: m, dataDir, root} = await setup(t);
  const x = m.storeObservation(await observation()), y = m.storeObservation(await observation('new'));
  let result = cli(dataDir, 'compare', '--kind', 'check', '--from', x.check, '--to', y.check, '--brief', BRIEF, '--save');
  assert.equal(result.status, 0, result.stdout + result.stderr); const id = JSON.parse(result.stdout).id;
  assert.equal(JSON.parse(cli(dataDir, 'compare', '--id', id).stdout).verdict, 'CHANGED');
  const input = path.join(root, 'link.json'); fs.writeFileSync(input, JSON.stringify(linkInput(ref('revision', x.revision), ref('revision', y.revision))));
  result = cli(dataDir, 'link', '--input', input); assert.equal(result.status, 0, result.stdout + result.stderr);
  const link = JSON.parse(result.stdout).id, review = path.join(root, 'review.json');
  fs.writeFileSync(review, JSON.stringify({link, decision: 'OPEN', actor: 'cli-reviewer', rationale: 'Fresh process.', key: 'cli-key'}));
  assert.equal(cli(dataDir, 'review', '--input', review).status, 0);
  assert.equal(JSON.parse(cli(dataDir, 'link', '--id', link).stdout).reviews.length, 1);
  assert.equal(cli(dataDir, 'coverage', '--brief', BRIEF).status, 0);
  assert.equal(cli(dataDir, 'report', '--brief', BRIEF, '--out', path.join(root, 'cli-report')).status, 0);
  assert.equal(cli(dataDir, 'compare', '--id', id, '--save').status, 2);
  assert.equal(cli(dataDir, 'list', '--type', 'links', '--save').status, 2);
  assert.equal(cli(dataDir, 'watch').status, 2); assert.equal(cli(dataDir, 'migrate').status, 0);
  assert.equal(spawnSync(process.execPath, ['tools/research-analysis.mjs', '--help'], {cwd: ROOT}).status, 0);
});

test('403/404/429/timeout and unavailable provider remain actual coverage gaps with last-known pointers', async t => {
  const {analysis: a, memory: m} = await setup(t), base = await observation();
  const first = m.storeRun(acquisition([base]), {brief: BRIEF, key: 'available'});
  for (const status of ['FORBIDDEN', 'NOT_FOUND', 'THROTTLED', 'TIMEOUT']) {
    const next = m.storeRun(acquisition([], {status}), {brief: BRIEF, key: status, source: first.observations[0].source});
    const comparison = a.compare(ref('run', first.run), ref('run', next.run));
    assert.equal(comparison.verdict, 'UNAVAILABLE'); assert.equal(comparison.absence, 'NOT_PROVEN');
    const c = a.coverage({family: status, question: 'Recorded failure', runIds: [next.run]});
    assert.ok(c.gaps.includes(status)); assert.equal(c.negative.verdict, 'NOT_PROVEN');
  }
  const unavailable = await createHarness().discover('web', {query: 'no provider'});
  const stored = m.storeRun(unavailable, {brief: BRIEF, key: 'missing-provider'});
  assert.ok(a.coverage({family: 'web', question: 'No configured provider', runIds: [stored.run]}).gaps.includes('NO_CREDENTIALS'));
});

test('late-page result cap counts uninspected items; fallback retains per-attempt counters including empty failure', async t => {
  const {analysis: a, memory: m} = await setup(t);
  const url = 'https://api.github.com/search/repositories?q=plain%20is%3Apublic&per_page=2&page=2';
  const response = (items, link) => ({status: 200, headers: {'content-type': 'application/json', ...(link ? {link: `<${link}>; rel="next"`} : {})}, body: JSON.stringify({items})});
  const item = id => ({id, private: false, full_name: `owner/p${id}`});
  const sequence = [response([item(1)], url), response([item(2), item(3)])];
  const harness = createHarness({limits: {maxResults: 2, minIntervalMs: 0}}, {token: '', lookup: async () => [{address: '8.8.8.8', family: 4}], wire: async () => sequence.shift()});
  const result = await harness.discover('github', {query: 'plain'});
  assert.equal(result.coverage.pagesFetched, 2); assert.equal(result.coverage.itemsSeen, 3); assert.equal(result.coverage.itemsInspected, 2);
  assert.equal(result.coverage.complete, false); assert.ok(result.limitations.includes('RESULT_LIMIT'));
  const fallback = createHarness({adapters: {github: false}}, {fixture: {version: 1, items: [{id: 'fallback', content: 'retained'}]}});
  const successful = await fallback.fallback([{source: 'github', query: 'plain'}, {source: 'fixture'}]);
  assert.equal(successful.attempts[0].coverage.complete, false); assert.equal(successful.attempts[1].coverage.itemsSeen, 1);
  const saved = m.storeRun(successful, {brief: BRIEF, key: 'fallback'});
  const coverage = a.coverage({family: 'fallback', question: 'Actual attempts', runIds: [saved.run]});
  assert.equal(coverage.usedRoutes[0].attempts.length, 2); assert.equal(coverage.assessment, 'PARTIAL_OR_UNKNOWN');
  const failed = await fallback.fallback([{source: 'github', query: 'plain'}]);
  assert.equal(failed.status, 'UNAVAILABLE'); assert.ok(m.storeRun(failed, {key: 'all-failed'}).run);
});

test('bounded union and quota failures never publish a partial saved comparison; distinct publisher dates remain source metadata', async t => {
  const {analysis: a, memory: m} = await setup(t), base = await observation();
  const first = m.storeRun(acquisition(Array.from({length: 51}, (_, i) => ({...base, identity: `fixture:left-${i}`, canonicalUrl: `fixture:left-${i}`}))), {key: 'left'});
  const second = m.storeRun(acquisition(Array.from({length: 51}, (_, i) => ({...base, identity: `fixture:right-${i}`, canonicalUrl: `fixture:right-${i}`}))), {key: 'right'});
  const result = a.compare(ref('run', first.run), ref('run', second.run));
  assert.equal(result.pairs.length, 100); assert.ok(result.limitations.includes('COMPARISON_LIMIT')); assert.equal(result.verdict, 'INCONCLUSIVE');
  m.maxRecords = 1;
  assert.throws(() => a.compare(ref('run', first.run), ref('run', second.run), {save: true}), /QUOTA/);
  assert.equal(a.list('comparisons').length, 0); assert.equal(m.db.prepare('SELECT count(*) n FROM analysis_anchors').get().n, 0);
  m.maxRecords = 100000;
  const x = m.storeObservation({...base, publishedAt: AT}), y = m.storeObservation({...base, publishedAt: NEXT});
  const dates = a.compare(ref('check', x.check), ref('check', y.check));
  assert.equal(dates.pairs[0].left.publishedAt, AT); assert.equal(dates.pairs[0].right.publishedAt, NEXT);
  assert.equal(dates.pairs[0].right.eventAt, null); assert.equal(dates.factualContradiction, false);
  const linked = a.link(linkInput(ref('check', x.check), ref('check', y.check), {
    leftStatement: {...statement('Publisher states event on first date'), eventAt: AT},
    rightStatement: {...statement('Publisher states event on second date'), eventAt: NEXT}}));
  assert.equal(linked.left.statement.eventAt, AT); assert.equal(linked.right.statement.eventAt, NEXT); assert.equal(linked.engineVerifiedTruth, false);
});
