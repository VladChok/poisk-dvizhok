#!/usr/bin/env node
// Offline durability proof: each operation is a new process, all data synthetic/public.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-durability-'));
const state = path.join(temp, 'state'), restored = path.join(temp, 'restored');
const output = path.join(temp, 'export', 'e0-node-sqlite'), backup = path.join(temp, 'snapshot.sqlite');
const runs = [], startedAt = new Date().toISOString();
const preload = new URL('../tests/helpers/offline.mjs', import.meta.url).href;
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {cwd: ROOT, encoding: 'utf8', timeout: 30000,
    env: {...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim()}});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  runs.push({command: `node ${script} ${args.join(' ')}`.split(temp).join('<temp>'), exitCode: result.status,
    stdout: result.stdout.split(temp).join('<temp>'), stderr: result.stderr.split(temp).join('<temp>')});
  return result.stdout;
}
const memory = (directory, ...args) => JSON.parse(run('tools/research-memory.mjs', [...args, '--data-dir', directory, '--scope', 'public', '--json']));
try {
  fs.mkdirSync(path.dirname(output));
  const init = memory(state, 'init');
  const imported = memory(state, 'import', 'research/e0-node-sqlite');
  assert.equal(memory(state, 'import', 'research/e0-node-sqlite').duplicate, true);
  memory(state, 'ingest', '--source', 'fixture', '--fixture', 'tests/fixtures/harness.json', '--key', 'proof-baseline');
  assert.equal(memory(state, 'find', '--query', 'Проверка').matches.length, 1);
  assert.equal(memory(state, 'history', '--source', 'fixture:fixture-russian').sources[0].revisions.length, 1);
  assert.equal(memory(state, 'history', '--brief', imported.brief).claims.length, 6);
  memory(state, 'export', imported.brief, '--out', output);
  run('tools/research-map.mjs', ['validate', path.join(output, 'map.json')]);
  run('tools/research-map.mjs', ['validate-evidence', path.join(output, 'evidence.jsonl'), '--map', path.join(output, 'map.json')]);
  run('tools/research-map.mjs', ['render', path.join(output, 'map.json')]);
  run('tools/research-bundle.mjs', ['inspect', output, '--json']);
  const hashes = {};
  for (const name of ['brief.md', 'map.json', 'evidence.jsonl', 'sources.json', 'sources/sqlite-api.md', 'sources/sqlite-module.txt', 'sources/NODE-LICENSE.txt']) {
    const before = fs.readFileSync(path.join(ROOT, 'research/e0-node-sqlite', name)), after = fs.readFileSync(path.join(output, name));
    assert.deepEqual(before, after); hashes[name] = createHash('sha256').update(after).digest('hex');
  }
  memory(state, 'backup', '--out', backup);
  const changed = path.join(temp, 'changed.json');
  fs.writeFileSync(changed, JSON.stringify({version: 1, items: [{id: 'fixture-russian', content: 'Новая версия после резервной копии.'}]}));
  memory(state, 'ingest', '--source', 'fixture', '--fixture', changed, '--key', 'proof-change');
  assert.equal(memory(state, 'history', '--source', 'fixture:fixture-russian').sources[0].revisions.length, 2);
  memory(restored, 'restore', '--from', backup);
  const restoredDoctor = memory(restored, 'doctor');
  assert.equal(restoredDoctor.counts.claims, 6); assert.equal(restoredDoctor.counts.revisions, 2);
  assert.equal(memory(restored, 'history', '--source', 'fixture:fixture-russian').sources[0].revisions.length, 1);
  assert.equal(memory(restored, 'find', '--query', 'Проверка').matches.length, 1);
  console.log(JSON.stringify({version: 1, status: 'PROVEN', startedAt, completedAt: new Date().toISOString(),
    commit: spawnSync('git', ['rev-parse', 'HEAD'], {cwd: ROOT, encoding: 'utf8'}).stdout?.trim() || null,
    workingTreeDirty: Boolean(spawnSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'}).stdout?.trim()),
    node: process.version, platform: process.platform, arch: process.arch, driver: init.driver, sqlite: init.sqlite,
    schema: init.schema, source: 'Synthetic fixture + committed public E0 bundle only; no network.',
    separateProcesses: runs.length, exactRoundtripHashes: hashes, restoredCounts: restoredDoctor.counts,
    watch: 'OFF', runs}, null, 2));
} finally {
  // temp is the exact mkdtemp directory created above; no user-provided deletion path.
  fs.rmSync(temp, {recursive: true, force: true});
}
