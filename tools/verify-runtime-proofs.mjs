#!/usr/bin/env node
// CI acceptance evidence, independent of shell redirection/encoding on each runner.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const read = name => fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, '');
const memory = JSON.parse(read('memory-proof.json')), comparison = JSON.parse(read('comparison-proof.json'));
const watch = JSON.parse(read('watch-proof.json'));
const friday = JSON.parse(read('friday-fix-proof.json'));
const origin = JSON.parse(read('watch-origin-proof.json'));
const tap = read('offline-tests.tap');
const head = spawnSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
const count = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)\\r?$`, 'm'))?.[1] ?? NaN);
// Origin fixes preserve all 148 existing expectations and add 11. Future test changes
// should deliberately update this audit count rather than silently weakening it.
assert.equal(count('tests'), 159); assert.equal(count('pass'), 159);
assert.equal(count('fail'), 0); assert.equal(count('skipped'), 0); assert.equal(count('cancelled'), 0);
for (const proof of [memory, comparison, watch, friday, origin]) {
  assert.equal(proof.commit, head); assert.equal(proof.workingTreeDirty, false); assert.equal(proof.watch, 'OFF');
  assert.equal(proof.runs.length, proof.separateProcesses);
}
assert.equal(memory.status, 'PROVEN'); assert.equal(memory.schema, 1); assert.equal(memory.separateProcesses, 19);
assert.equal(comparison.status, 'PASS'); assert.equal(comparison.separateProcesses, 34);
assert.equal(comparison.migratedTo, 2); assert.equal(comparison.v1RollbackSchema, 1); assert.equal(comparison.v2Restored, true);
assert.equal(watch.status, 'PASS'); assert.equal(watch.separateProcesses, 35); assert.equal(watch.migratedTo, 3);
assert.equal(watch.v2Rollback, true); assert.equal(watch.v3Restored, true); assert.equal(watch.retainedE3Review, 'WITHDRAWN');
assert.equal(watch.osTasksInstalled, 0); assert.equal(watch.backgroundWorker, 'NOT_STARTED');
assert.equal(friday.status, 'PASS'); assert.equal(friday.schema, 3); assert.equal(friday.ddlChanges, false);
assert.equal(friday.separateProcesses, 24);
assert.equal(friday.p1.controlHashMatches, true); assert.equal(friday.p1.conditionalScope, 'EXACT_URI');
assert.equal(friday.p1.redirectedThenDirect, 'CHANGED'); assert.equal(friday.p1.directThenRedirected, 'CHANGED');
assert.equal(friday.p2.sameClockEpochsDistinct, true); assert.equal(friday.p2.scheduleAdvances, true);
assert.equal(friday.p2.restoredActivation, true); assert.equal(friday.singleDelivery, true);
assert.equal(friday.osTasksInstalled, 0); assert.equal(friday.backgroundWorker, 'NOT_STARTED');
assert.equal(origin.status, 'PASS'); assert.equal(origin.schema, 3);
assert.equal(origin.separateProcesses, 18);
assert.equal(origin.manualToDue, 'ISOLATED'); assert.equal(origin.dueToManual, 'ISOLATED');
assert.equal(origin.manualReplay, 'PRESERVED'); assert.equal(origin.restored, true); assert.equal(origin.acquisitions, 4);
assert.equal(origin.osTasksInstalled, 0); assert.equal(origin.backgroundWorker, 'NOT_STARTED');
console.log(JSON.stringify({head, cleanCheckout: true, tests: count('tests'), pass: count('pass'), fail: count('fail'),
  node: process.version, platform: process.platform, memoryProcesses: memory.separateProcesses,
  comparisonProcesses: comparison.separateProcesses, watchProcesses: watch.separateProcesses, fridayProcesses: friday.separateProcesses, originProcesses: origin.separateProcesses, sqlite: watch.sqlite, migrations: 'v1→v2→v3',
  rollbackSchema: 2, v3Restored: true, retainedE3Review: watch.retainedE3Review, osTasksInstalled: 0, backgroundWorker: 'NOT_STARTED', watch: 'OFF'}, null, 2));
