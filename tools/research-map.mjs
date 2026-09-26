#!/usr/bin/env node
// Research Map / Evidence v0 — validator, renderer, canonical save. Contract: docs/CONTRACT-research-map-evidence-v0.md.
// No dependencies (Node >= 20, standard library only). The schema files in schema/ are the single source of the field
// shapes: a minimal interpreter below reads them (type, enum, minLength, pattern, properties, required,
// additionalProperties, items, $ref) — no ajv. Key order = order of `properties` in the schema. Cross-field rules that
// JSON Schema cannot express are checked in code, each with its own rule code.
//
//   node tools/research-map.mjs validate <map.json>
//   node tools/research-map.mjs validate-evidence <evidence.jsonl> --map <map.json>
//   node tools/research-map.mjs render <map.json> [--node <id>]
//   node tools/research-map.mjs save <map.json> --out <file>
//
// Exit: 0 — ok; 1 — violations; 2 — usage / unreadable input.
//
// FUTURE SLOTS — deliberately not implemented in v0 (METHOD-stalactite-search.md § Future slots):
//   - source tools / adapters: reach[].tool is an open vocabulary; nothing here fetches sources;
//   - source trust / security filtering, known-good / blocked source policies: pointers are not judged;
//   - search heuristics / candidate scoring: status and reason are written by the researcher, not computed;
//   - automatic WATCH refresh: WATCH is only a status here.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema');
const schemas = new Map();
const loadSchema = (file) => {
  if (!schemas.has(file)) schemas.set(file, JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, file), 'utf8')));
  return schemas.get(file);
};

// "#/$defs/x" — in the current file; "other.json#/$defs/x" — in a sibling schema file.
function deref(ref, file) {
  const [target, frag = ''] = ref.split('#');
  const f = target || file;
  let node = loadSchema(f);
  for (const part of frag.split('/').filter(Boolean)) node = node[part];
  if (!node) throw new Error(`schema: unresolved $ref ${ref} in ${file}`);
  return {schema: node, file: f};
}

const typeOf = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

// Minimal JSON Schema check. Violations: {rule, where, msg}. rule = SCHEMA or KEY-ORDER.
export function checkSchema(value, schema, file, where = '$', out = []) {
  if (schema.$ref) { const d = deref(schema.$ref, file); return checkSchema(value, d.schema, d.file, where, out); }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.includes(typeOf(value))) { out.push({rule: 'SCHEMA', where, msg: `type ${typeOf(value)}, expected ${types.join('|')}`}); return out; }
  }
  if (schema.enum && !schema.enum.includes(value)) out.push({rule: 'SCHEMA', where, msg: `${JSON.stringify(value)} not in ${schema.enum.join('|')}`});
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) out.push({rule: 'SCHEMA', where, msg: 'empty string'});
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push({rule: 'SCHEMA', where, msg: `${JSON.stringify(value)} does not match ${schema.pattern}`});
  }
  if (typeOf(value) === 'object' && schema.properties) {
    const known = Object.keys(schema.properties);
    for (const k of schema.required ?? []) if (!(k in value)) out.push({rule: 'SCHEMA', where, msg: `missing field ${k}`});
    for (const k of Object.keys(value)) if (!known.includes(k) && schema.additionalProperties === false) out.push({rule: 'SCHEMA', where, msg: `extra field ${k}`});
    const present = Object.keys(value).filter(k => known.includes(k));
    const expected = known.filter(k => k in value);
    if (present.join() !== expected.join()) out.push({rule: 'KEY-ORDER', where, msg: `keys ${present.join(',')}, contract order ${expected.join(',')}`});
    for (const k of expected) checkSchema(value[k], schema.properties[k], file, `${where}.${k}`, out);
  }
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => checkSchema(v, schema.items, file, `${where}[${i}]`, out));
  return out;
}

// Canonical form: every object re-emitted in schema property order (save → reopen byte-for-byte).
export function canonical(value, schema, file) {
  if (schema.$ref) { const d = deref(schema.$ref, file); return canonical(value, d.schema, d.file); }
  if (Array.isArray(value)) return value.map(v => schema.items ? canonical(v, schema.items, file) : v);
  if (typeOf(value) === 'object' && schema.properties) {
    const out = {};
    for (const k of Object.keys(schema.properties)) if (k in value) out[k] = canonical(value[k], schema.properties[k], file);
    for (const k of Object.keys(value)) if (!(k in out)) out[k] = value[k];
    return out;
  }
  return value;
}

const LEAF_END = ['CUT', 'SURVIVED', 'WATCH', 'OPEN'];
const NEEDS_SOURCES = ['CANDIDATE', 'DEEP_DIVE'];
const empty = (s) => s == null || String(s).trim() === '';

// Map: schema + invariants of the contract. Returns {violations, warnings}.
export function validateMap(map) {
  const violations = checkSchema(map, loadSchema('map.schema.json'), 'map.schema.json');
  const warnings = [];
  const nodes = Array.isArray(map?.nodes) ? map.nodes.filter(n => typeOf(n) === 'object') : [];
  const v = (rule, n, msg) => violations.push({rule, where: n ? `node ${n.id}` : '$', msg});
  const byId = new Map();
  for (const n of nodes) {
    if (byId.has(n.id)) v('ID-UNIQUE', n, 'id repeats');
    else byId.set(n.id, n);
  }
  const children = new Map();
  for (const n of nodes) if (n.parent != null) (children.get(n.parent) ?? children.set(n.parent, []).get(n.parent)).push(n);
  const roots = nodes.filter(n => n.parent === null);
  if (roots.length !== 1) v('ROOT', null, `${roots.length} nodes with parent: null, expected exactly 1`);
  for (const r of roots) if (r.level !== 'FIELD') v('ROOT', r, `root level ${r.level}, expected FIELD`);
  for (const n of nodes) {
    if (n.parent != null && !byId.has(n.parent)) v('PARENT', n, `parent ${n.parent} does not resolve`);
    else if (n.parent != null) {
      const seen = new Set([n.id]);
      for (let cur = byId.get(n.parent); cur; cur = cur.parent == null ? null : byId.get(cur.parent)) {
        if (seen.has(cur.id)) { v('PARENT', n, 'parent chain is a cycle'); break; }
        seen.add(cur.id);
      }
    }
    if (n.status !== 'OPEN' && empty(n.reason)) v('REASON', n, `status ${n.status} without reason`);
    if (NEEDS_SOURCES.includes(n.level)) {
      if (!Array.isArray(n.sources) || n.sources.length < 1) v('SOURCES', n, `level ${n.level} needs sources[] >= 1`);
      if (!Array.isArray(n.reach) || n.reach.length < 1) v('REACH', n, `level ${n.level} needs reach[] >= 1`);
    }
    const kids = children.get(n.id) ?? [];
    if (n.status === 'DONE' && !kids.length) v('DONE-LEAF', n, 'DONE on a node without children (rule B: a leaf ends CUT|SURVIVED|WATCH)');
    if (n.level === 'DEEP_DIVE' && n.status === 'DONE') v('DEEP-DIVE-DONE', n, 'a DEEP_DIVE node is never DONE (rule B: its status is the branch verdict)');
    if (!kids.length && !LEAF_END.includes(n.status) && n.status !== 'DONE') warnings.push({rule: 'LEAF-END', where: `node ${n.id}`, msg: `leaf with status ${n.status}; rule B: a leaf ends CUT|SURVIVED|WATCH (OPEN if unfinished)`});
  }
  return {violations, warnings};
}

// Evidence: schema per line + claim_id unique + map_node resolves + rule C (no position => limitation not null).
export function validateEvidence(lines, map) {
  const schema = loadSchema('evidence.schema.json');
  const ids = new Set((map?.nodes ?? []).map(n => n?.id));
  const violations = [];
  const seen = new Set();
  lines.forEach(({line, value, error}) => {
    const where = `line ${line}`;
    if (error) { violations.push({rule: 'SCHEMA', where, msg: `not JSON (${error})`}); return; }
    violations.push(...checkSchema(value, schema, 'evidence.schema.json', where));
    if (typeOf(value) !== 'object') return;
    if (seen.has(value.claim_id)) violations.push({rule: 'CLAIM-UNIQUE', where, msg: `claim_id ${value.claim_id} repeats`});
    seen.add(value.claim_id);
    if (!ids.has(value.map_node)) violations.push({rule: 'MAP-NODE', where, msg: `map_node ${value.map_node} does not resolve in the map`});
    const p = value.pointer;
    if (typeOf(p) === 'object' && !('position' in p) && value.limitation == null) violations.push({rule: 'NEGATIVE-LIMITATION', where, msg: `${value.claim_id}: pointer without position (scope pointer) needs limitation naming the method (rule C)`});
  });
  return {violations, claims: seen.size};
}

export function parseJsonl(text) {
  return text.replace(/^﻿/, '').split(/\r?\n/).map((raw, i) => ({raw, line: i + 1})).filter(l => l.raw.trim())
    .map(({raw, line}) => { try { return {line, value: JSON.parse(raw)}; } catch (e) { return {line, error: e.message}; } });
}

export function serialize(map) {
  return JSON.stringify(canonical(map, loadSchema('map.schema.json'), 'map.schema.json'), null, 2) + '\n';
}

// ── render ──

const reachChain = (n) => (n.reach ?? []).map(r => `${r.tool}@${r.at}`).join(' → ') || '—';
const pointerText = (p) => `${p.locator}${p.position ? ` ${p.position}` : ''} @ ${p.version}`;
const head = (n) => `${n.level} ${n.status} ${n.id} — ${n.title}`;

export function render(map, {node: focus = null} = {}) {
  const nodes = map.nodes;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const kids = (id) => nodes.filter(n => n.parent === id);
  const out = [];
  const detail = (n, pad) => {
    if (!empty(n.reason)) out.push(`${pad}why: ${n.reason}`);
    if ((n.reach ?? []).length) out.push(`${pad}reach: ${reachChain(n)}`);
    if ((n.sources ?? []).length) out.push(`${pad}sources: ${n.sources.map(pointerText).join(' ; ')}`);
  };
  if (!focus) {
    out.push(`brief: ${map.brief} · ${nodes.length} nodes`);
    const walk = (n, prefix, childPrefix) => {
      out.push(prefix + head(n));
      const list = kids(n.id);
      detail(n, childPrefix + (list.length ? '│   ' : '    '));
      list.forEach((c, i) => {
        const last = i === list.length - 1;
        walk(c, childPrefix + (last ? '└── ' : '├── '), childPrefix + (last ? '    ' : '│   '));
      });
    };
    for (const r of nodes.filter(n => n.parent === null)) walk(r, '', '');
    const open = nodes.filter(n => n.status === 'OPEN');
    out.push('', `resume points (OPEN): ${open.length ? open.map(n => `${n.id} (${n.level})`).join(', ') : 'none'}`);
    const survivors = nodes.filter(n => n.status === 'SURVIVED' && !kids(n.id).length);
    out.push(`brief survivors (leaf SURVIVED): ${survivors.length ? survivors.map(n => n.id).join(', ') : 'none'}`);
    return out.join('\n') + '\n';
  }
  const n = byId.get(focus);
  if (!n) throw new Error(`node ${focus} not in the map`);
  const chain = [];
  for (let cur = n; cur; cur = cur.parent == null ? null : byId.get(cur.parent)) { chain.unshift(cur); if (chain.length > nodes.length) break; }
  out.push(`path (where it came from): ${chain.map(c => c.id).join(' › ')}`);
  chain.slice(0, -1).forEach((c, i) => { out.push(`${'  '.repeat(i)}${head(c)}`); if (!empty(c.reason)) out.push(`${'  '.repeat(i)}  why: ${c.reason}`); });
  const pad = '  '.repeat(chain.length - 1);
  out.push(`${pad}${head(n)}   ← node`);
  detail(n, pad + '  ');
  if (!empty(n.notes)) out.push(`${pad}  notes: ${n.notes}`);
  const list = kids(n.id);
  out.push('', `children (where it goes): ${list.length ? '' : 'none — leaf; verdict of this branch = ' + n.status + (n.status === 'OPEN' ? ' (resume here)' : '')}`);
  for (const c of list) out.push(`  ${head(c)}${empty(c.reason) ? '' : ` — ${c.reason}`}`);
  return out.join('\n') + '\n';
}

// ── CLI ──

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
const printViolations = (list) => { for (const x of list) console.log(`  ${x.rule}  ${x.where}  ${x.msg}`); };
const tally = (nodes, key) => Object.entries(nodes.reduce((m, n) => (m[n[key]] = (m[n[key]] ?? 0) + 1, m), {})).map(([k, c]) => `${k} ${c}`).join(', ');

export function main(argv) {
  const [cmd, file, ...rest] = argv;
  const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
  const usage = 'usage: research-map.mjs validate <map.json> | validate-evidence <evidence.jsonl> --map <map.json> | render <map.json> [--node <id>] | save <map.json> --out <file>';
  if (!cmd || !file) { console.error(usage); return 2; }
  try {
    if (cmd === 'validate') {
      const map = readJson(file);
      const {violations, warnings} = validateMap(map);
      const nodes = Array.isArray(map.nodes) ? map.nodes : [];
      console.log(`${file}: ${violations.length} violations, ${nodes.length} nodes`);
      console.log(`  by level: ${tally(nodes, 'level')}`);
      console.log(`  by status: ${tally(nodes, 'status')}`);
      printViolations(violations);
      for (const w of warnings) console.log(`  warning ${w.rule}  ${w.where}  ${w.msg}`);
      return violations.length ? 1 : 0;
    }
    if (cmd === 'validate-evidence') {
      const mapFile = opt('map');
      if (!mapFile) { console.error(usage); return 2; }
      const {violations, claims} = validateEvidence(parseJsonl(fs.readFileSync(file, 'utf8')), readJson(mapFile));
      console.log(`${file}: ${violations.length} violations, ${claims} claims (map ${mapFile})`);
      printViolations(violations);
      return violations.length ? 1 : 0;
    }
    if (cmd === 'render') {
      process.stdout.write(render(readJson(file), {node: opt('node') ?? null}));
      return 0;
    }
    if (cmd === 'save') {
      const out = opt('out');
      if (!out) { console.error(usage); return 2; }
      const map = readJson(file);
      const {violations} = validateMap(map);
      if (violations.length) { console.log(`${file}: ${violations.length} violations — not saved`); printViolations(violations); return 1; }
      writeAtomic(out, serialize(map));
      console.log(`saved ${out}`);
      return 0;
    }
    console.error(usage);
    return 2;
  } catch (e) {
    console.error(`${cmd} ${file}: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
