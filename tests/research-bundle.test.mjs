import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {inspectBundle} from '../tools/research-bundle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'research/e0-node-sqlite');
const CLI = path.join(ROOT, 'tools/research-bundle.mjs');
const MAP_CLI = path.join(ROOT, 'tools/research-map.mjs');
const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8', timeout: 10000});
function isolated(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-resume-'));
  t.after(() => fs.rmSync(temp, {recursive: true, force: true}));
  const bundle = path.join(temp, 'e0-node-sqlite');
  fs.mkdirSync(bundle);
  // Deliberately no RESULT, execution logs, working tree, environment context or chat.
  for (const name of ['brief.md', 'map.json', 'evidence.jsonl', 'sources.json', 'sources']) {
    fs.cpSync(path.join(FIXTURE, name), path.join(bundle, name), {recursive: true});
  }
  return bundle;
}
function changeManifest(bundle, mutate) {
  const file = path.join(bundle, 'sources.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest));
}

test('fresh processes resume using only saved artifacts, deterministically without RESULT', t => {
  const bundle = isolated(t);
  assert.equal(fs.existsSync(path.join(bundle, 'RESULT.md')), false);
  const first = run(CLI, ['inspect', bundle, '--json'], path.dirname(bundle));
  const second = run(CLI, ['inspect', bundle, '--json'], os.tmpdir());
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  const out = JSON.parse(first.stdout);
  assert.deepEqual(out.survivors, ['CA-api', 'CA-code']);
  assert.deepEqual(out.resume, [{id: 'CA-platform', reason: ''}]);
  assert.match(out.cuts[0].reason, /does not establish storage durability/);
  assert.match(out.navigation, /prior-knowledge@2026-10-31.*web-fetch@2026-10-31/);
  assert.equal(out.snapshotsVerified, 3);
  assert.deepEqual(out.claims.map(c => c.claim_id), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  assert.match(out.question, /STOP CONDITION/);
});

test('public probe passes every existing CLI operation and two saves preserve exact bytes', t => {
  const bundle = isolated(t);
  const map = path.join(bundle, 'map.json');
  for (const args of [
    ['validate', map], ['validate-evidence', path.join(bundle, 'evidence.jsonl'), '--map', map],
    ['render', map], ['render', map, '--node', 'CA-license']
  ]) {
    const result = run(MAP_CLI, args, bundle);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const saved = path.join(bundle, 'saved.json');
  const reopened = path.join(bundle, 'reopened.json');
  assert.equal(run(MAP_CLI, ['save', map, '--out', saved], bundle).status, 0);
  assert.equal(run(MAP_CLI, ['save', saved, '--out', reopened], bundle).status, 0);
  assert.deepEqual(fs.readFileSync(saved), fs.readFileSync(reopened));
  assert.equal(fs.readFileSync(saved, 'utf8'), fs.readFileSync(map, 'utf8').replace(/\r\n/g, '\n'));
});

test('tampered snapshot is rejected in a fresh CLI process', t => {
  const bundle = isolated(t);
  fs.appendFileSync(path.join(bundle, 'sources/sqlite-api.md'), 'tampered');
  const result = run(CLI, ['inspect', bundle], bundle);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /snapshot hash mismatch/);
});

test('unresolved evidence and missing source snapshot reject handoff', t => {
  const bundle = isolated(t);
  const file = path.join(bundle, 'evidence.jsonl');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('"map_node":"CA-api"', '"map_node":"absent"'));
  assert.throws(() => inspectBundle(bundle), /MAP-NODE/);
  fs.writeFileSync(file, original.replace('"version":"48726ac59b20fe3a64eb68e9e15134a65f10e120"', '"version":"unknown"'));
  assert.throws(() => inspectBundle(bundle), /source snapshot missing/);
});

test('manifest cannot read outside bundle; duplicate sources and oversized files are rejected', t => {
  const bundle = isolated(t);
  changeManifest(bundle, m => { m.sources[0].snapshot = '../outside.txt'; });
  fs.writeFileSync(path.join(bundle, '../outside.txt'), 'outside');
  assert.throws(() => inspectBundle(bundle), /escapes bundle/);
  fs.copyFileSync(path.join(FIXTURE, 'sources.json'), path.join(bundle, 'sources.json'));
  changeManifest(bundle, m => m.sources.push(m.sources[0]));
  assert.throws(() => inspectBundle(bundle), /duplicate source/);
  fs.copyFileSync(path.join(FIXTURE, 'sources.json'), path.join(bundle, 'sources.json'));
  fs.writeFileSync(path.join(bundle, 'sources/sqlite-api.md'), Buffer.alloc(4 * 1024 * 1024 + 1));
  assert.throws(() => inspectBundle(bundle), /exceeds 4 MiB/);
});

test('missing brief, broken JSON and mismatched slug fail without executing source text', t => {
  const bundle = isolated(t);
  fs.writeFileSync(path.join(bundle, 'RESULT.md'), 'throw new Error("must never be read");');
  assert.equal(inspectBundle(bundle).brief, 'e0-node-sqlite');
  fs.writeFileSync(path.join(bundle, 'brief.md'), '');
  assert.throws(() => inspectBundle(bundle), /empty brief/);
  fs.copyFileSync(path.join(FIXTURE, 'brief.md'), path.join(bundle, 'brief.md'));
  fs.writeFileSync(path.join(bundle, 'map.json'), '{');
  assert.throws(() => inspectBundle(bundle), SyntaxError);
  const map = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'map.json'), 'utf8'));
  map.brief = 'wrong';
  fs.writeFileSync(path.join(bundle, 'map.json'), JSON.stringify(map));
  assert.throws(() => inspectBundle(bundle), /slug/);
});

test('inspect usage has explicit statuses', () => {
  assert.equal(run(CLI, ['--help'], ROOT).status, 0);
  assert.equal(run(CLI, [], ROOT).status, 2);
  assert.equal(run(CLI, ['inspect', FIXTURE, '--unknown'], ROOT).status, 2);
});

test('offline preload denies network APIs and inherits into fresh processes', () => {
  const preload = new URL('./helpers/offline.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {get} from 'node:https';
    import {connect} from 'node:net';
    import {lookup} from 'node:dns/promises';
    for (const call of [() => fetch('https://example.com'), () => get('https://example.com'),
      () => connect(443, 'example.com'), () => lookup('example.com')]) {
      assert.throws(call, /OFFLINE_TEST/);
    }
    console.log('network blocked');
  `], {encoding: 'utf8', timeout: 10000, env: {...process.env, NODE_OPTIONS: `--import=${preload}`}});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /network blocked/);
});
