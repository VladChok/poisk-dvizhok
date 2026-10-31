#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHarness} from '../harness/engine.mjs';

const help = `Source Harness E1 (manual, no scheduler or database)
node tools/research-engine.mjs doctor [--config file] [--live] [--json]
node tools/research-engine.mjs discover --source github --query "plain terms" [--json]
node tools/research-engine.mjs retrieve --source github --repo owner/name --ref <40-hex-commit> [--file path] [--json]
node tools/research-engine.mjs discover --source rss --url <configured-feed> --config file [--json]
node tools/research-engine.mjs retrieve --source rss --url <configured-feed> --config file [--etag value] [--last-modified value] [--json]
node tools/research-engine.mjs discover --source fixture --fixture file [--id value] [--json]
node tools/research-engine.mjs discover --routes file --config file [--json]
All operations accept --config file. Ctrl+C cancels. doctor without --live does no network.
Exit: 0 OK/NOT_MODIFIED/configuration report; 1 partial/unavailable/failure; 2 usage/config error; 130 cancelled.
General web search is UNAVAILABLE / NO_CREDENTIALS. Retrieved text is data, not verified evidence.`;
const flags = new Set(['config', 'source', 'query', 'repo', 'ref', 'file', 'url', 'fixture', 'id', 'etag', 'last-modified', 'routes']);
function readJSON(file) {
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1048576) throw new Error('INVALID_CONFIG');
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
export async function main(args) {
  if (args[0] === 'watch') return (await import('./research-watch.mjs')).main(args.slice(1));
  if (args[0] === 'analysis') return (await import('./research-analysis.mjs')).main(args.slice(1));
  if (args[0] === 'memory') return (await import('./research-memory.mjs')).main(args.slice(1));
  if (args.length === 1 && args[0] === '--help') { console.log(help); return 0; }
  const command = args[0], options = {};
  if (!['doctor', 'discover', 'retrieve'].includes(command)) { console.error(help); return 2; }
  try {
    for (let i = 1; i < args.length; i++) {
      const flag = args[i].startsWith('--') ? args[i].slice(2) : '';
      if (flag in options) throw new Error('DUPLICATE_OPTION');
      if (['json', 'live'].includes(flag)) options[flag] = true;
      else if (flags.has(flag) && args[i + 1] && !args[i + 1].startsWith('--')) options[flag] = args[++i];
      else throw new Error('INVALID_OPTION');
    }
    if (options.live && command !== 'doctor') throw new Error('INVALID_OPTION');
    if (command !== 'doctor' && !options.source && !options.routes) throw new Error('SOURCE_REQUIRED');
    if (options.routes && (command !== 'discover' || options.source)) throw new Error('INVALID_OPTION');
    const config = options.config ? readJSON(options.config) : {};
    const fixture = options.fixture ? readJSON(options.fixture) : undefined;
    const harness = createHarness(config, {fixture});
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel);
    let result;
    try {
      result = options.routes ? await harness.fallback(readJSON(options.routes), {signal: controller.signal}) :
        command === 'doctor' ? await harness.doctor({live: options.live, signal: controller.signal}) :
        await harness[command](options.source, {...options, lastModified: options['last-modified'], signal: controller.signal});
    } finally { process.removeListener('SIGINT', cancel); }
    // Provider errors are codes, never raw error bodies/headers. Mask an env token
    // even if a hostile public source happens to echo it in text/metadata.
    let output = options.json ? JSON.stringify(result, null, 2) : human(result);
    if (process.env.GITHUB_TOKEN) output = output.split(process.env.GITHUB_TOKEN).join('[REDACTED]');
    console.log(output);
    if (controller.signal.aborted || result.status === 'CANCELLED') return 130;
    return ['OK', 'NOT_MODIFIED'].includes(result.status) ? 0 : 1;
  } catch {
    // No paths, input URLs, credentials, XML or native exception strings in errors.
    console.error('Invalid arguments/configuration. Run with --help.');
    return 2;
  }
}
function human(result) {
  const clean = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  const lines = [`${result.adapter || 'doctor'}: ${result.status}; requests=${result.requests}`];
  if (result.mode) lines.push(result.mode);
  for (const item of result.adapters || []) lines.push(`${item.adapter}: ${item.status}${item.reason ? ' / ' + item.reason : ''}`);
  for (const item of result.observations || []) lines.push(`${clean(item.identity)} | ${item.status} | ${clean(item.canonicalUrl)} | observed ${item.observedAt}`);
  for (const item of result.attempts || []) lines.push(`route ${clean(item.adapter)}: ${item.status}; observations=${item.count}`);
  for (const item of result.limitations || []) lines.push(`limitation: ${clean(item)}`);
  return lines.join('\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
