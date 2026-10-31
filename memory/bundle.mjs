import fs from 'node:fs';
import path from 'node:path';
import {inspectBundle} from '../tools/research-bundle.mjs';
import {validateMap, validateEvidence, parseJsonl} from '../tools/research-map.mjs';
import {safePath, readFile, jsonFile, relativeFile, hash, MAX_INPUT, fail, clean} from './safety.mjs';

export function readBundle(directory) {
  const root = safePath(directory), files = new Map();
  const map = jsonFile(path.join(root, 'map.json'));
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(map.brief) || map.brief !== path.basename(root)) fail('INVALID_BRIEF');
  relativeFile(map.brief);
  const evidenceBytes = readFile(path.join(root, 'evidence.jsonl'));
  const evidence = parseJsonl(evidenceBytes.toString('utf8'));
  if (validateMap(map).violations.length || validateEvidence(evidence, map).violations.length) fail('INVALID_V0');
  const allowed = new Set(['brief.md', 'map.json', 'evidence.jsonl', 'RESULT.md', 'REVIEW-GATE.md', 'EXECUTION.json', '.gitignore']);
  if (fs.existsSync(path.join(root, 'sources.json'))) {
    const manifest = jsonFile(path.join(root, 'sources.json'));
    if (!Array.isArray(manifest.sources) || manifest.sources.length > 50) fail('INPUT_LIMIT');
    for (const source of manifest.sources) allowed.add(relativeFile(source.snapshot));
    allowed.add('sources.json');
  }
  let total = 0, count = 0;
  function walk(directory, depth = 0) {
    if (depth > 8) fail('INPUT_LIMIT');
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (++count > 100) fail('INPUT_LIMIT');
      const full = safePath(path.join(directory, entry.name));
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      const relative = relativeFile(path.relative(root, full).split(path.sep).join('/'));
      if (!allowed.has(relative)) fail('UNEXPECTED_ARTIFACT');
      const bytes = readFile(full);
      if ((total += bytes.length) > MAX_INPUT) fail('INPUT_LIMIT');
      if (relative === '.gitignore' && bytes.toString('utf8').trim() !== '*') fail('UNEXPECTED_ARTIFACT');
      if (relative === '.gitignore') continue; // local export guard, not research content
      files.set(relative, bytes);
    }
  }
  walk(root);
  // Enforce aggregate byte/file bounds before reading any snapshots a second time.
  if (files.has('sources.json')) {
    try { inspectBundle(root); } catch { fail('INVALID_SNAPSHOTS'); }
  }
  if (!files.get('brief.md')?.toString('utf8').trim()) fail('INVALID_BRIEF');
  clean(map); for (const line of evidence) clean(line.value);
  const id = hash(JSON.stringify([...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, hash(bytes)])));
  return {id, brief: map.brief, map, evidence: evidence.map(e => e.value), files};
}
