#!/usr/bin/env node
// CI acceptance evidence, independent of shell redirection/encoding on each runner.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const read = name => fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, '');
const memory = JSON.parse(read('memory-proof.json')), comparison = JSON.parse(read('comparison-proof.json'));
const tap = read('offline-tests.tap');
const head = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
const count = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)\\r?$`, 'm'))?.[1] ?? NaN);
// E3 acceptance preserves 86 prior expectations and adds 21. Future test changes
// should deliberately update this audit count rather than silently weakening it.
assert.equal(count('tests'), 107); assert.equal(count('pass'), 107);
assert.equal(count('fail'), 0); assert.equal(count('skipped'), 0); assert.equal(count('cancelled'), 0);
for (const proof of [memory, comparison]) {
  assert.equal(proof.commit, head); assert.equal(proof.workingTreeDirty, false); assert.equal(proof.watch, 'OFF');
  assert.equal(proof.runs.length, proof.separateProcesses);
}
assert.equal(memory.status, 'PROVEN'); assert.equal(memory.schema, 1); assert.equal(memory.separateProcesses, 19);
assert.equal(comparison.status, 'PASS'); assert.equal(comparison.separateProcesses, 34);
assert.equal(comparison.migratedTo, 2); assert.equal(comparison.v1RollbackSchema, 1); assert.equal(comparison.v2Restored, true);
console.log(JSON.stringify({head, cleanCheckout: true, tests: count('tests'), pass: count('pass'), fail: count('fail'),
  node: process.version, platform: process.platform, memoryProcesses: memory.separateProcesses,
  comparisonProcesses: comparison.separateProcesses, sqlite: comparison.sqlite, migration: 'v1→v2',
  rollbackSchema: 1, v2Restored: true, watch: 'OFF'}, null, 2));
