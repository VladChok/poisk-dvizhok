#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
// A relative import URL is portable across spaces in Windows checkout paths.
const preload = new URL('../tests/helpers/offline.mjs', import.meta.url).href;
const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: {...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${preload}`.trim()}
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
