#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openMemory, restoreMemory} from '../memory/store.mjs';
import {MemoryError, code, clean, jsonFile} from '../memory/safety.mjs';
import {createHarness} from '../harness/engine.mjs';

const HELP = `Research Memory E2 — local SQLite; WATCH OFF
node tools/research-memory.mjs init [--data-dir path] [--scope private|public]
node tools/research-memory.mjs import <bundle-dir> [--data-dir path]
node tools/research-memory.mjs ingest --source fixture|github|rss [E1 options] [--data-dir path]
node tools/research-memory.mjs ingest --input <saved-E1-result.json> [--key id]
node tools/research-memory.mjs find [--query term] [--source id] [--brief id] [--claim id] [--from UTC] [--to UTC] [--limit N --offset N]
node tools/research-memory.mjs show|history [--source id | --brief id] [--limit N --offset N]
node tools/research-memory.mjs export <brief-id> --out <new-directory-with-brief-slug> [--bundle version-id] [--allow-private]
node tools/research-memory.mjs backup --out <new.sqlite>
node tools/research-memory.mjs restore --from <backup.sqlite> --data-dir <new-root>
node tools/research-memory.mjs route --run id --state OPEN|CUT|REVISIT --reason text
node tools/research-memory.mjs purge --brief id|--source id|--before UTC --confirm
node tools/research-memory.mjs doctor|migrate
All commands: --data-dir path, --scope private|public (default private), --json.
Ingest: --config file --fixture file --operation discover|retrieve --query text
        --repo owner/name --ref commit --file path --url feed --etag value
        --last-modified value --brief id --source-id id --key id
init: --max-bytes number (default 268435456; max 1073741824).
Local reads/doctor never initialize. Init is explicit. Restore never overwrites.
Exit: 0 success; 1 data/driver/acquisition failure or partial; 2 usage; 130 cancelled.`;
const values = new Set(['data-dir', 'scope', 'query', 'source', 'source-id', 'brief', 'claim', 'from', 'to', 'out', 'input', 'offset',
  'key', 'bundle', 'config', 'fixture', 'operation', 'repo', 'ref', 'file', 'url', 'etag', 'last-modified', 'run', 'state', 'reason', 'before', 'limit', 'max-bytes']);
const booleans = new Set(['json', 'confirm', 'allow-private']);
export async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args, options = {}, positional = [];
  if (!['init', 'import', 'ingest', 'find', 'show', 'history', 'export', 'backup', 'restore', 'route', 'purge', 'doctor', 'migrate'].includes(command)) {
    console.error(HELP); return 2;
  }
  try {
    for (let i = 0; i < rest.length; i++) {
      if (!rest[i].startsWith('--')) { positional.push(rest[i]); continue; }
      const key = rest[i].slice(2);
      if (key in options) throw new Error();
      if (booleans.has(key)) options[key] = true;
      else if (values.has(key) && rest[i + 1] && !rest[i + 1].startsWith('--')) options[key] = rest[++i];
      else throw new Error();
    }
    if (positional.length !== (['import', 'export'].includes(command) ? 1 : 0)) throw new Error();
    if (['export', 'backup'].includes(command) && !options.out) throw new Error();
    if (command === 'restore' && !options.from) throw new Error();
    if (command === 'ingest' && (!options.input === !options.source)) throw new Error();
    if (options['max-bytes'] && command !== 'init') throw new Error();
  } catch { console.error('Invalid arguments. Run with --help.'); return 2; }
  const base = {dataDir: options['data-dir'], scope: options.scope || 'private', supportedVersion: 2};
  let memory, result, acquisition, cancelled = false;
  try {
    if (command === 'restore') result = restoreMemory(options.from, base);
    else {
      const write = ['init', 'import', 'ingest', 'route', 'purge', 'migrate'].includes(command);
      memory = openMemory({...base, write, init: command === 'init',
        ...(options['max-bytes'] ? {maxBytes: Number(options['max-bytes'])} : {})});
      if (command === 'init' || command === 'doctor') result = memory.doctor();
      else if (command === 'migrate') result = memory.migrate();
      else if (command === 'import') result = memory.importBundle(positional[0]);
      else if (command === 'find') result = {matches: memory.find({query: options.query, source: options.source,
        brief: options.brief, claim: options.claim, from: options.from, to: options.to,
        ...(options.limit ? {limit: Number(options.limit)} : {}), ...(options.offset ? {offset: Number(options.offset)} : {})})};
      else if (['show', 'history'].includes(command)) result = memory.getHistory({source: options.source, brief: options.brief,
        ...(options.limit ? {limit: Number(options.limit)} : {}), ...(options.offset ? {offset: Number(options.offset)} : {})});
      else if (command === 'export') result = memory.exportBundle(positional[0], options.out, {bundle: options.bundle, allowPrivate: options['allow-private']});
      else if (command === 'backup') result = await memory.backup(options.out);
      else if (command === 'route') result = memory.route(options.run, options.state, options.reason);
      else if (command === 'purge') result = memory.purge({brief: options.brief, source: options.source, before: options.before, confirm: options.confirm});
      else if (command === 'ingest') {
        if (options.input) acquisition = jsonFile(options.input, 32 * 1024 * 1024);
        else {
          const harness = createHarness(options.config ? jsonFile(options.config) : {},
            {fixture: options.fixture ? jsonFile(options.fixture) : undefined});
          const operation = options.operation || 'discover';
          if (!['discover', 'retrieve'].includes(operation)) throw new MemoryError('INVALID_OPERATION');
          const controller = new AbortController(), cancel = () => { cancelled = true; controller.abort(); };
          process.once('SIGINT', cancel);
          try { acquisition = await harness[operation](options.source, {...options,
            lastModified: options['last-modified'], signal: controller.signal}); }
          finally { process.removeListener('SIGINT', cancel); }
        }
        result = memory.storeRun(acquisition, {brief: options.brief || null, source: options['source-id'] || null, key: options.key || randomUUID()});
        result.acquisitionStatus = acquisition.status;
      }
    }
    clean(result);
    console.log(options.json ? JSON.stringify({status: 'OK', ...result}, null, 2) : human(result));
    return cancelled ? 130 : acquisition && !['OK', 'NOT_MODIFIED'].includes(acquisition.status) ? 1 : 0;
  } catch (error) {
    const status = code(error);
    console[options.json ? 'log' : 'error'](options.json ? JSON.stringify({status, watch: 'OFF'}) : `memory: ${status}`);
    return 1;
  } finally { memory?.close(); }
}
function human(result) {
  const safe = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  const lines = [`memory: ${result.status || 'OK'}; WATCH OFF`];
  for (const [key, value] of Object.entries(result)) {
    if (key === 'matches') for (const item of value) lines.push(`${item.kind} ${item.entity_id}: ${safe(item.text)}`);
    else lines.push(`${key}: ${safe(typeof value === 'object' ? JSON.stringify(value) : value)}`);
  }
  return lines.join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
