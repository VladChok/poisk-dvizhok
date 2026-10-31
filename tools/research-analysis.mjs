#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openAnalysis} from '../analysis/store.mjs';
import {fields, encode} from '../analysis/records.mjs';
import {migrateToV2} from '../memory/migrate.mjs';
import {code, clean, jsonFile} from '../memory/safety.mjs';

const HELP = `Research Analysis E3 — offline recorded evidence; WATCH OFF
node tools/research-analysis.mjs migrate --backup <NEW-v1.sqlite>
node tools/research-analysis.mjs compare --kind revision|check|run --from id --to id [--source id] [--brief id] [--save]
node tools/research-analysis.mjs compare --input <left-right-references.json> [--save] | --id <comparison>
node tools/research-analysis.mjs coverage --input <query-family.json> [--save] | --brief id | --id coverage
node tools/research-analysis.mjs link --input <manual-link.json> | --id link
node tools/research-analysis.mjs review --input <link-decision-actor-rationale.json>
node tools/research-analysis.mjs list --type comparisons|coverage|links [--brief id] [--limit N --offset N]
node tools/research-analysis.mjs report --brief id [--limit N] [--out NEW-directory] [--allow-private]
All commands: --data-dir path, --scope private|public (default private), --json.
Reads never initialize or migrate. Create v1 with memory init, then explicitly migrate.
No acquisition, semantic truth judgement, automatic absence proof, scheduler or WATCH.
Exit: 0 success; 1 data/storage failure; 2 usage.`;
const common = ['data-dir', 'scope', 'json'];
const optionsByCommand = {
  migrate: ['backup'], compare: ['kind', 'from', 'to', 'source', 'brief', 'save', 'input', 'id'],
  coverage: ['input', 'brief', 'save', 'id'], link: ['input', 'id'], review: ['input'],
  list: ['type', 'brief', 'limit', 'offset'], report: ['brief', 'out', 'allow-private', 'limit']
};
const bools = new Set(['json', 'save', 'allow-private']);
export async function main(args) {
  if (args.length === 1 && args[0] === '--help') { console.log(HELP); return 0; }
  const [command, ...rest] = args, options = {};
  try {
    if (!(command in optionsByCommand)) throw new Error();
    const allowed = [...common, ...optionsByCommand[command]];
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i].startsWith('--') ? rest[i].slice(2) : '';
      if (!allowed.includes(flag) || flag in options) throw new Error();
      if (bools.has(flag)) options[flag] = true;
      else if (rest[i + 1] && !rest[i + 1].startsWith('--')) options[flag] = rest[++i];
      else throw new Error();
    }
    if (command === 'compare') {
      const selectors = Number(!!options.id) + Number(!!options.input) + Number(!!(options.kind || options.from || options.to));
      if (selectors !== 1 || (!options.input && !options.id && !(options.kind && options.from && options.to)) ||
          (options.id && (options.save || options.source || options.brief)) || (options.input && (options.source || options.brief))) throw new Error();
    }
    if (command === 'coverage' && (Number(!!options.input) + Number(!!options.id) + Number(!!options.brief) !== 1 || (!options.input && options.save))) throw new Error();
    if (command === 'link' && Number(!!options.input) + Number(!!options.id) !== 1) throw new Error();
    if (command === 'review' && !options.input) throw new Error();
    if (command === 'list' && !options.type) throw new Error();
    if (command === 'report' && (!options.brief || (options['allow-private'] && !options.out))) throw new Error();
  } catch { console.error('Invalid arguments. Run with --help.'); return 2; }
  const base = {dataDir: options['data-dir'], scope: options.scope || 'private'};
  let analysis;
  try {
    let result;
    if (command === 'migrate') result = await migrateToV2({...base, backup: options.backup});
    else {
      analysis = openAnalysis({...base, write: !!options.save || ['link', 'review'].includes(command)});
      const input = options.input ? jsonFile(options.input, 1048576) : undefined;
      if (command === 'compare') {
        if (options.id) result = analysis.getComparison(options.id);
        else if (input) {
          fields(input, ['left', 'right', 'brief'], ['left', 'right']);
          result = analysis.compare(input.left, input.right, {brief: input.brief, save: options.save});
        } else result = analysis.compare({kind: options.kind, id: options.from, ...(options.source ? {source: options.source} : {})},
          {kind: options.kind, id: options.to, ...(options.source ? {source: options.source} : {})}, {brief: options.brief, save: options.save});
      } else if (command === 'coverage') result = input ? analysis.coverage(input, {save: options.save}) :
        options.id ? analysis.getCoverage(options.id) : analysis.coverageForBrief(options.brief);
      else if (command === 'link') result = input ? analysis.link(input) : analysis.getLink(options.id);
      else if (command === 'review') {
        fields(input, ['link', 'decision', 'actor', 'rationale', 'key'], ['link', 'decision', 'actor', 'rationale']);
        result = analysis.review(input.link, input);
      } else if (command === 'list') result = {records: analysis.list(options.type, {brief: options.brief,
        ...(options.limit ? {limit: Number(options.limit)} : {}), ...(options.offset ? {offset: Number(options.offset)} : {})})};
      else if (command === 'report') {
        const settings = {...(options.limit ? {limit: Number(options.limit)} : {})};
        result = options.out ? analysis.exportReport(options.brief, options.out, {...settings, allowPrivate: options['allow-private']}) : analysis.report(options.brief, settings);
      }
    }
    clean(result); encode(result); console.log(JSON.stringify({status: 'OK', ...result, watch: 'OFF'}, null, options.json ? 2 : 0)); return 0;
  } catch (error) { console[options.json ? 'log' : 'error'](JSON.stringify({status: code(error), watch: 'OFF'})); return 1; }
  finally { analysis?.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
