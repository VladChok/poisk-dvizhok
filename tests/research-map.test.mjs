// node --test — Research Map / Evidence v0 (docs/CONTRACT-research-map-evidence-v0.md): the demo is valid and canonical,
// save → reopen is byte-for-byte, and each contract rule is caught by one negative case derived from the demo.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateMap, validateEvidence, parseJsonl, serialize, render} from '../tools/research-map.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'tools', 'research-map.mjs');
const MAP = path.join(ROOT, 'research', 'demo-agent-harness', 'map.json');
const EVIDENCE = path.join(ROOT, 'research', 'demo-agent-harness', 'evidence.jsonl');
const demo = () => JSON.parse(fs.readFileSync(MAP, 'utf8'));
const lines = () => parseJsonl(fs.readFileSync(EVIDENCE, 'utf8'));
const node = (map, id) => map.nodes.find(n => n.id === id);
const rules = (r) => r.violations.map(v => v.rule);
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8'});

// ── positive ──

test('demo map: 0 violations; shape required by the task', () => {
  const map = demo();
  const r = validateMap(map);
  assert.deepEqual(r.violations, []);
  const count = (f) => map.nodes.filter(f).length;
  assert.ok(count(n => n.level === 'FIELD') >= 1);
  assert.ok(count(n => n.level === 'CLUSTER') >= 3);
  assert.ok(count(n => n.level === 'CANDIDATE') >= 6);
  assert.ok(count(n => n.status === 'CUT' && n.reason) >= 2);
  const leaf = (n) => !map.nodes.some(c => c.parent === n.id);
  assert.ok(count(n => n.status === 'SURVIVED' && leaf(n)) >= 1);
  assert.ok(count(n => n.level === 'DEEP_DIVE' || n.status === 'WATCH') >= 1);
  assert.ok(map.nodes.some(n => n.reach.length === 2 && n.reach[0].tool === 'prior-knowledge' && n.reach[1].tool === 'gh'));
});

test('demo evidence: 0 violations; at least one negative claim by rule C (scope pointer + limitation)', () => {
  const r = validateEvidence(lines(), demo());
  assert.deepEqual(r.violations, []);
  const negatives = lines().map(l => l.value).filter(e => !('position' in e.pointer));
  assert.ok(negatives.length >= 1 && negatives.every(e => e.limitation));
});

test('save → reopen byte-for-byte (CLI, two generations); the committed demo is already canonical in content', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-map-'));
  const m1 = path.join(tmp, 'm1.json'), m2 = path.join(tmp, 'm2.json');
  assert.equal(cli('save', MAP, '--out', m1).status, 0);
  assert.equal(cli('save', m1, '--out', m2).status, 0);
  assert.equal(fs.readFileSync(m2, 'utf8'), fs.readFileSync(m1, 'utf8'));
  assert.equal(fs.readFileSync(m1, 'utf8'), fs.readFileSync(MAP, 'utf8').replace(/\r\n/g, '\n'));
  assert.equal(serialize(demo()), fs.readFileSync(m1, 'utf8'));
});

test('render --node on a survivor: path from the FIELD, reason, reach chain, verdict of the branch', () => {
  const out = render(demo(), {node: 'DD-agent-reach'});
  assert.match(out, /path \(where it came from\): F0 › CL2 › CA-agent-reach › DD-agent-reach/);
  assert.match(out, /why: MIT, main pushed 2026-09-15/);
  assert.match(out, /reach: gh@2026-09-26/);
  assert.match(out, /verdict of this branch = SURVIVED/);
  const full = render(demo());
  assert.match(full, /resume points \(OPEN\): F0 \(FIELD\), CL2 \(CLUSTER\), CA-jina-reader \(CANDIDATE\)/);
  assert.match(full, /reach: prior-knowledge@2026-09-26 → gh@2026-09-26/);
});

// ── negatives: one per rule, each fails on its expected rule ──

test('CUT without reason → REASON', () => {
  const map = demo(); node(map, 'CA-storm').reason = '';
  assert.deepEqual(rules(validateMap(map)), ['REASON']);
});

test('DONE on a leaf → DONE-LEAF (rule B)', () => {
  const map = demo(); node(map, 'CA-codex').status = 'DONE';
  assert.deepEqual(rules(validateMap(map)), ['DONE-LEAF']);
});

test('DEEP_DIVE node with status DONE → DEEP-DIVE-DONE (rule B), even with a child', () => {
  const map = demo();
  node(map, 'DD-agent-reach').status = 'DONE';
  map.nodes.push({...structuredClone(node(map, 'DD-agent-reach')), id: 'DD-child', parent: 'DD-agent-reach', status: 'SURVIVED'});
  assert.deepEqual(rules(validateMap(map)), ['DEEP-DIVE-DONE']);
});

test('reach as an object instead of an array → SCHEMA (rule A)', () => {
  const map = demo(); node(map, 'CA-codex').reach = {tool: 'gh', at: '2026-09-26'};
  const r = validateMap(map);
  assert.ok(rules(r).includes('SCHEMA'));
  assert.match(r.violations.find(v => v.rule === 'SCHEMA').msg, /type object, expected array/);
});

test('extra field on a node → SCHEMA; reordered keys → KEY-ORDER', () => {
  const map = demo(); node(map, 'CA-codex').claim = 'x';
  assert.deepEqual(validateMap(map).violations.map(v => [v.rule, v.msg]), [['SCHEMA', 'extra field claim']]);
  const map2 = demo(); const {id, level, ...rest} = node(map2, 'CA-codex');
  map2.nodes[map2.nodes.findIndex(n => n.id === 'CA-codex')] = {level, id, ...rest};
  assert.deepEqual(rules(validateMap(map2)), ['KEY-ORDER']);
});

test('parent does not resolve → PARENT; two roots → ROOT; repeated id → ID-UNIQUE; candidate without sources/reach → SOURCES, REACH', () => {
  const a = demo(); node(a, 'CA-codex').parent = 'CL9';
  assert.deepEqual(rules(validateMap(a)), ['PARENT']);
  const b = demo(); node(b, 'CL3').parent = null;
  assert.deepEqual(rules(validateMap(b)), ['ROOT', 'ROOT']);
  const c = demo(); c.nodes.push(structuredClone(node(c, 'CA-storm')));
  assert.deepEqual(rules(validateMap(c)), ['ID-UNIQUE']);
  const d = demo(); Object.assign(node(d, 'CA-storm'), {sources: [], reach: []});
  assert.deepEqual(rules(validateMap(d)), ['SOURCES', 'REACH']);
});

test('evidence: map_node does not resolve → MAP-NODE', () => {
  const l = lines(); l[0].value.map_node = 'CA-nowhere';
  assert.deepEqual(rules(validateEvidence(l, demo())), ['MAP-NODE']);
});

test('evidence: negative claim (no position) without limitation → NEGATIVE-LIMITATION (rule C)', () => {
  const l = lines(); const c3 = l.find(x => x.value.claim_id === 'c3').value;
  assert.ok(!('position' in c3.pointer));
  c3.limitation = null;
  assert.deepEqual(rules(validateEvidence(l, demo())), ['NEGATIVE-LIMITATION']);
});

test('evidence: repeated claim_id → CLAIM-UNIQUE; key order / missing version → KEY-ORDER, SCHEMA', () => {
  const l = lines(); l[1].value.claim_id = 'c1';
  assert.deepEqual(rules(validateEvidence(l, demo())), ['CLAIM-UNIQUE']);
  const l2 = lines(); const {claim_id, claim, ...rest} = l2[0].value; l2[0].value = {claim, claim_id, ...rest};
  assert.deepEqual(rules(validateEvidence(l2, demo())), ['KEY-ORDER']);
  const l3 = lines(); delete l3[0].value.pointer.version;
  assert.deepEqual(validateEvidence(l3, demo()).violations.map(v => [v.rule, v.msg]), [['SCHEMA', 'missing field version']]);
});

test('CLI: exit 1 and the rule code on a negative file; save refuses an invalid map', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-map-neg-'));
  const bad = demo(); node(bad, 'CA-codex').status = 'DONE';
  const file = path.join(tmp, 'bad.json');
  fs.writeFileSync(file, JSON.stringify(bad));
  const r = cli('validate', file);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /1 violations[\s\S]*DONE-LEAF {2}node CA-codex/);
  const s = cli('save', file, '--out', path.join(tmp, 'out.json'));
  assert.equal(s.status, 1);
  assert.equal(fs.existsSync(path.join(tmp, 'out.json')), false);
});
