#!/usr/bin/env node
// Real fresh-process proof, synthetic/public inputs only; network denied in every child.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-proof-'));
const state = path.join(temp, 'state'), rollback = path.join(temp, 'rollback'), restored = path.join(temp, 'restored');
const runs = [], startedAt = new Date().toISOString(), preload = new URL('../tests/helpers/offline.mjs', import.meta.url).href;
const redact = text => text.split(temp).join('<temp>');
function run(script, args, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: {...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim()}});
  assert.equal(result.status, expected, result.stdout + result.stderr);
  runs.push({command: redact(`node ${script} ${args.join(' ')}`), exitCode: result.status,
    stdout: redact(result.stdout), stderr: redact(result.stderr)});
  return result.stdout;
}
const memory = (dir, ...args) => JSON.parse(run('tools/research-memory.mjs', [...args, '--data-dir', dir, '--scope', 'public', '--json']));
const analysis = (dir, ...args) => JSON.parse(run('tools/research-analysis.mjs', [...args, '--data-dir', dir, '--scope', 'public', '--json']));
const reference = (kind, id, extra = {}) => ({kind, id, ...extra});
const write = (name, data) => { const file = path.join(temp, name); fs.writeFileSync(file, JSON.stringify(data)); return file; };
try {
  const doctor = memory(state, 'init');
  const imported = memory(state, 'import', 'research/e0-node-sqlite'), brief = imported.brief;
  const baseline = write('baseline.json', {version: 1, items: [{id: 'value', content: 'Publisher says population 10; synthetic.'}, {id: 'other', content: 'Other actor; synthetic.'}]});
  const changed = write('changed.json', {version: 1, items: [{id: 'value', content: 'Publisher says population 12; synthetic.'}, {id: 'other', content: 'Other actor; synthetic.'}]});
  const first = memory(state, 'ingest', '--source', 'fixture', '--fixture', baseline, '--brief', brief, '--key', 'baseline');
  const before = JSON.parse(run('tools/research-analysis.mjs', ['list', '--type', 'links', '--data-dir', state, '--scope', 'public', '--json'], 1));
  assert.equal(before.status, 'MIGRATION_REQUIRED'); assert.equal(memory(state, 'doctor').schema, 1);
  const v1backup = path.join(temp, 'v1.sqlite');
  assert.equal(analysis(state, 'migrate', '--backup', v1backup).changed, true);
  assert.equal(memory(state, 'doctor').schema, 2);
  const second = memory(state, 'ingest', '--source', 'fixture', '--fixture', changed, '--brief', brief, '--key', 'changed');
  const compared = analysis(state, 'compare', '--kind', 'check', '--from', first.observations[0].check, '--to', second.observations[0].check, '--brief', brief, '--save');
  assert.equal(compared.verdict, 'CHANGED'); assert.equal(compared.factualContradiction, false);
  const same = analysis(state, 'compare', '--kind', 'check', '--from', first.observations[1].check, '--to', second.observations[1].check, '--brief', brief, '--save');
  assert.equal(same.verdict, 'SAME');
  assert.equal(analysis(state, 'compare', '--kind', 'check', '--from', first.observations[0].check, '--to', second.observations[0].check, '--brief', brief, '--save').id, compared.id);
  const coverageInput = write('coverage.json', {brief, family: 'population', question: 'What do these captured publisher statements say?',
    variants: ['population', 'население'], language: 'ru', region: 'synthetic', dateWindow: {from: null, to: null},
    plannedRoutes: [{adapter: 'web', query: 'synthetic population', note: 'Not used: no configured provider.'}], runIds: [first.run, second.run],
    decisions: [{source: first.observations[0].source, verdict: 'WATCH', reason: 'Label only, manual follow-up required.'}]});
  const coverage = analysis(state, 'coverage', '--input', coverageInput, '--save');
  assert.equal(coverage.negative.verdict, 'NOT_PROVEN');
  const linkInput = write('link.json', {brief, left: reference('check', first.observations[0].check), right: reference('check', second.observations[0].check),
    leftStatement: {kind: 'author_claim', text: 'Publisher says population 10', value: 10},
    rightStatement: {kind: 'author_claim', text: 'Publisher says population 12', value: 12}, relation: 'DISPUTES',
    subject: {id: 'synthetic-place', label: 'Synthetic place', context: 'Same location, year 2025, people count'},
    actor: 'fixture-author', rationale: 'Explicit competing value link, not an engine truth decision.'});
  const link = analysis(state, 'link', '--input', linkInput);
  assert.equal(analysis(state, 'link', '--input', linkInput).id, link.id);
  const claimInput = write('claims.json', {brief, left: reference('claim', imported.bundle, {claim: 'c1'}), right: reference('claim', imported.bundle, {claim: 'c2'}),
    relation: 'NOT_COMPARABLE', subject: {id: 'node-sqlite-doc', label: 'Node SQLite documentation', context: 'Different documented properties, pinned source'},
    actor: 'fixture-author', rationale: 'Keep both original v0 claims and kinds unchanged.'});
  const claimLink = analysis(state, 'link', '--input', claimInput); assert.equal(claimLink.left.statement.source, 'FROZEN_V0_CLAIM');
  for (const decision of ['OPEN', 'WITHDRAWN']) {
    const input = write(`review-${decision}.json`, {link: link.id, decision, actor: 'fixture-reviewer', rationale: `Manual ${decision} for synthetic proof.`, key: decision});
    analysis(state, 'review', '--input', input);
  }
  assert.equal(analysis(state, 'link', '--id', link.id).reviews.length, 2);
  assert.equal(analysis(state, 'compare', '--id', compared.id).verdict, 'CHANGED');
  assert.equal(analysis(state, 'coverage', '--id', coverage.id).family, 'population');
  assert.equal(analysis(state, 'list', '--type', 'links', '--brief', brief).records.length, 2);
  const reportOut = path.join(temp, 'comparison-report'); analysis(state, 'report', '--brief', brief, '--out', reportOut);
  const report = JSON.parse(fs.readFileSync(path.join(reportOut, 'report.json'), 'utf8'));
  assert.equal(report.links.length, 2); assert.equal(report.links.find(l => l.id === link.id).reviews.length, 2);
  assert.equal(report.savedCoverage[0].negative.verdict, 'NOT_PROVEN');
  assert.match(fs.readFileSync(path.join(reportOut, 'REPORT.md'), 'utf8'), /WITHDRAWN/);
  const v2backup = path.join(temp, 'v2.sqlite'); memory(state, 'backup', '--out', v2backup);
  memory(restored, 'restore', '--from', v2backup);
  assert.equal(analysis(restored, 'link', '--id', link.id).reviews.length, 2);
  assert.equal(analysis(restored, 'compare', '--id', compared.id).verdict, 'CHANGED');
  assert.equal(analysis(restored, 'coverage', '--id', coverage.id).family, 'population');
  memory(rollback, 'restore', '--from', v1backup); assert.equal(memory(rollback, 'doctor').schema, 1);
  assert.equal(memory(rollback, 'doctor').counts.claims, 6);
  const output = path.join(temp, brief); memory(restored, 'export', brief, '--out', output);
  run('tools/research-map.mjs', ['validate', path.join(output, 'map.json')]);
  run('tools/research-map.mjs', ['validate-evidence', path.join(output, 'evidence.jsonl'), '--map', path.join(output, 'map.json')]);
  run('tools/research-bundle.mjs', ['inspect', output, '--json']);
  const hashes = {};
  for (const name of ['brief.md', 'map.json', 'evidence.jsonl', 'sources.json', 'sources/sqlite-api.md', 'sources/sqlite-module.txt', 'sources/NODE-LICENSE.txt']) {
    const bytes = fs.readFileSync(path.join(output, name)); assert.deepEqual(bytes, fs.readFileSync(path.join(ROOT, 'research/e0-node-sqlite', name)));
    hashes[name] = createHash('sha256').update(bytes).digest('hex');
  }
  console.log(JSON.stringify({version: 1, status: 'PASS', startedAt, completedAt: new Date().toISOString(),
    commit: spawnSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim(),
    workingTreeDirty: !!spawnSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).stdout.trim(),
    node: process.version, platform: process.platform, arch: process.arch, driver: doctor.driver, sqlite: doctor.sqlite,
    migratedFrom: 1, migratedTo: 2, v1RollbackSchema: 1, v2Restored: true, separateProcesses: runs.length,
    comparisonIds: [compared.id, same.id], coverageId: coverage.id, linkIds: [link.id, claimLink.id], preservedReviews: 2,
    exactV0Hashes: hashes, source: 'Synthetic fixture + committed public E0 bundle; no network.', watch: 'OFF', runs}, null, 2));
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
