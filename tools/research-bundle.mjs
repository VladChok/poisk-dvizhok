#!/usr/bin/env node
// Offline handoff inspection. Source text is data; never executed or fetched.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateMap, validateEvidence, parseJsonl, render} from './research-map.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
function read(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('expected a bundle-relative file');
  const file = fs.realpathSync(path.resolve(root, relative));
  const rel = path.relative(root, file);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('file escapes bundle');
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > MAX_BYTES) throw new Error('file is not regular or exceeds 4 MiB');
  return fs.readFileSync(file);
}
const json = bytes => JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));

export function inspectBundle(directory) {
  const root = fs.realpathSync(directory);
  const brief = read(root, 'brief.md').toString('utf8');
  if (!brief.trim()) throw new Error('empty brief');
  const map = json(read(root, 'map.json'));
  if (map.brief !== path.basename(root)) throw new Error('brief slug must match bundle directory');
  const lines = parseJsonl(read(root, 'evidence.jsonl').toString('utf8'));
  const violations = [...validateMap(map).violations, ...validateEvidence(lines, map).violations];
  if (violations.length) throw new Error(JSON.stringify(violations));
  if (!lines.length) throw new Error('bundle has no evidence');
  const manifest = json(read(root, 'sources.json'));
  if (manifest.version !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error('invalid source manifest');
  const identities = new Set();
  for (const source of manifest.sources) {
    if (typeof source.locator !== 'string' || !source.locator || typeof source.version !== 'string' || !source.version ||
        !/^\d{4}-\d\d-\d\dT.*Z$/.test(source.retrievedAt) || !Number.isFinite(Date.parse(source.retrievedAt)) ||
        !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('invalid source metadata');
    const identity = JSON.stringify([source.locator, source.version]);
    if (identities.has(identity)) throw new Error('duplicate source identity');
    identities.add(identity);
    const hash = createHash('sha256').update(read(root, source.snapshot)).digest('hex');
    if (hash !== source.sha256) throw new Error(`snapshot hash mismatch: ${source.snapshot}`);
  }
  const claims = lines.map(line => line.value);
  for (const pointer of [...claims.map(c => c.pointer), ...map.nodes.flatMap(n => n.sources)]) {
    if (!identities.has(JSON.stringify([pointer.locator, pointer.version]))) throw new Error(`source snapshot missing: ${pointer.locator}`);
  }
  const leaves = map.nodes.filter(n => !map.nodes.some(child => child.parent === n.id));
  return {
    brief: map.brief,
    question: brief,
    // Includes cut reasons, reach chronology, pointers and explicit OPEN resume points.
    navigation: render(map),
    survivors: leaves.filter(n => n.status === 'SURVIVED').map(n => n.id),
    cuts: map.nodes.filter(n => n.status === 'CUT').map(n => ({id: n.id, reason: n.reason})),
    resume: map.nodes.filter(n => n.status === 'OPEN').map(n => ({id: n.id, reason: n.reason})),
    claims,
    snapshotsVerified: manifest.sources.length,
    limitation: 'Integrity and v0 structure only. No factual verification or independent researcher review.'
  };
}

export function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('usage: research-bundle.mjs inspect <bundle-directory> [--json]\nOffline: brief + map + evidence + sources.json + snapshots; RESULT and chat are not read.');
    return 0;
  }
  if (args[0] !== 'inspect' || !args[1] || args.length > 3 || (args[2] && args[2] !== '--json')) {
    console.error('usage: research-bundle.mjs inspect <bundle-directory> [--json]');
    return 2;
  }
  try {
    const result = inspectBundle(args[1]);
    console.log(args[2] === '--json' ? JSON.stringify(result, null, 2) :
      `${result.question}\n${result.navigation}\n${result.claims.map(c => `${c.claim_id}: ${c.claim}\n  ${c.pointer.locator} @ ${c.pointer.version}`).join('\n')}\n${result.snapshotsVerified} snapshot hashes verified. ${result.limitation}`);
    return 0;
  } catch (error) {
    console.error(`bundle: ${error.message}`);
    return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
