#!/usr/bin/env node
// Explicit opt-in public smoke. Never invoked by tests, CI, install or doctor.
import {createHarness} from '../harness/engine.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--live') {
  console.error('usage: node tools/harness-smoke.mjs --live'); process.exitCode = 2;
} else {
  const startedAt = new Date().toISOString(), start = Date.now();
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  const harness = createHarness({version: 1, allowedHosts: ['api.github.com', 'github.blog'], feeds: ['https://github.blog/feed/'],
    limits: {timeoutMs: 60000, maxBytes: 4194304, maxResults: 3, maxPages: 1, maxRequests: 12}}, {token: ''});
  const runs = [];
  const summarize = (name, result, elapsedMs) => {
    runs.push({name, status: result.status, elapsedMs, requests: result.requests, trace: result.trace, limitations: result.limitations,
      feed: result.feed, observations: result.observations?.map(o => ({identity: o.identity, canonicalUrl: o.canonicalUrl,
        observedAt: o.observedAt, publishedAt: o.publishedAt, updatedAt: o.updatedAt, revision: o.revision,
        etag: o.etag, lastModified: o.lastModified, hash: o.hash, status: o.status}))});
  };
  async function run(name, operation) {
    const at = Date.now(), result = await operation(); summarize(name, result, Date.now() - at); return result;
  }
  const signal = controller.signal;
  try {
    await run('github-discover', () => harness.discover('github', {query: 'poisk-dvizhok', signal}));
    await run('github-commit', () => harness.retrieve('github', {repo: 'VladChok/poisk-dvizhok', ref: 'e9ef2b87cdb62ec8fa00d5774cd78a91b215915f', signal}));
    const fileOptions = {repo: 'VladChok/poisk-dvizhok', ref: 'e9ef2b87cdb62ec8fa00d5774cd78a91b215915f', file: 'README.md', signal};
    const file = await run('github-file', () => harness.retrieve('github', fileOptions));
    if (file.observations?.[0]?.etag) await run('github-file-conditional', () => harness.retrieve('github', {...fileOptions, etag: file.observations[0].etag}));
    const feed = await run('rss-declared-feed', () => harness.discover('rss', {url: 'https://github.blog/feed/', signal}));
    if (feed.feed?.etag) await run('rss-conditional', () => harness.retrieve('rss', {url: 'https://github.blog/feed/', etag: feed.feed.etag, signal}));
  } finally { process.removeListener('SIGINT', cancel); }
  console.log(JSON.stringify({version: 1, startedAt, completedAt: new Date().toISOString(), elapsedMs: Date.now() - start,
    node: process.version, platform: process.platform, auth: 'explicitly unauthenticated; no env token used', runs}, null, 2));
  process.exitCode = controller.signal.aborted ? 130 : runs.every(r => ['OK', 'NOT_MODIFIED', 'PARTIAL'].includes(r.status)) ? 0 : 1;
}
