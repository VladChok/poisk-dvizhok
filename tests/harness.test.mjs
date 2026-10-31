import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createHarness, validateConfig} from '../harness/engine.mjs';
import {createClient, publicAddress, safeURL, httpsWire, HarnessError} from '../harness/network.mjs';
import {parseFeed} from '../harness/feed.mjs';

const NOW = Date.parse('2026-10-31T03:00:00Z');
const REF = 'e9ef2b87cdb62ec8fa00d5774cd78a91b215915f';
const FEED = 'https://feeds.example.com/news.xml';
const HOSTS = ['api.github.com', 'feeds.example.com', 'mirror.example.com'];
const repo = {id: 1, full_name: 'Public/Project', private: false, created_at: '2020-01-01T00:00:00Z'};
const response = (data = {}, status = 200, headers = {}) => ({status,
  headers: {'content-type': 'application/json', ...headers}, body: typeof data === 'string' ? data : JSON.stringify(data)});
const rss = `<rss version="2.0"><channel><lastBuildDate>Fri, 30 Oct 2026 12:00:00 GMT</lastBuildDate>
 <item><guid>stable-1</guid><title>Привет &amp; мир</title><link>https://publisher.example.com/post</link>
 <pubDate>Thu, 29 Oct 2026 12:00:00 GMT</pubDate><description><![CDATA[<b>plain data</b>]]></description></item>
 <item><guid>stable-1</guid><title>duplicate</title></item><item><title>broken item</title></item>
 <item><guid>stable-2</guid><pubDate>invalid</pubDate><link>http://127.0.0.1/</link></item></channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><updated>2026-10-30T12:00:00Z</updated><entry>
 <id>urn:example:1</id><title>Atom</title><link href="/post"/><published>2026-10-29T12:00:00Z</published>
 <updated>2026-10-30T10:00:00Z</updated><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">data</div></content>
 </entry></feed>`;
const xmlResponse = (body = rss, status = 200, headers = {}) => response(body, status, {'content-type': 'application/rss+xml', ...headers});
function mock(sequence, config = {}, overrides = {}) {
  let time = NOW;
  const calls = [], waits = [], dnsCalls = [];
  const deps = {clock: () => time, token: '',
    lookup: async host => { dnsCalls.push(host); return [{address: '8.8.8.8', family: 4}]; },
    sleep: async ms => { waits.push(ms); time += ms; },
    wire: async (url, options) => {
      calls.push({url: url.href, ...options});
      const next = sequence.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(url, options);
      assert.ok(next, 'unexpected request: ' + url.href); return next;
    }, ...overrides};
  const settings = {allowedHosts: HOSTS, feeds: [FEED], limits: {minIntervalMs: 0}, ...config};
  return {harness: createHarness(settings, deps), client: createClient({hosts: HOSTS, budget: settings.limits, ...deps}), calls, waits, dnsCalls};
}
const fileResponse = (content = 'Привет\n') => {
  const bytes = Buffer.from(content);
  return response({type: 'file', size: bytes.length, encoding: 'base64', content: bytes.toString('base64'),
    sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}, 200, {etag: '"file-1"', 'last-modified': 'Fri, 30 Oct 2026 12:00:00 GMT'});
};

test('doctor configuration is honest/offline, adapters disable and web is unavailable', async () => {
  const {harness, calls} = mock([], {adapters: {rss: false}});
  const report = await harness.doctor();
  assert.equal(calls.length, 0);
  assert.match(report.mode, /network not tested/);
  assert.equal(report.adapters.find(a => a.adapter === 'rss').status, 'DISABLED');
  assert.equal(report.adapters.find(a => a.adapter === 'web').reason, 'NO_CREDENTIALS');
  assert.equal((await harness.discover('rss', {url: FEED})).status, 'DISABLED');
  assert.equal((await harness.discover('web', {})).status, 'NO_CREDENTIALS');
  assert.equal((await harness.discover('unknown', {})).status, 'UNKNOWN_ADAPTER');
});

test('GitHub discovery pagination, dedup, provenance, public filtering and partial limits', async () => {
  const page2 = `https://api.github.com/search/repositories?q=engine%20is%3Apublic&per_page=20&page=2`;
  const {harness, calls} = mock([
    response({items: [repo, {...repo, private: true, id: 2}], incomplete_results: true}, 200, {link: `<${page2}>; rel="next"`, etag: '"page1"'}),
    response({items: [repo, {...repo, id: 3, full_name: 'Public/Other'}]})
  ], {}, {token: 'secret-read-token'});
  const result = await harness.discover('github', {query: 'engine'});
  assert.equal(result.status, 'OK');
  assert.equal(result.observations.length, 2);
  assert.equal(result.requests, 2);
  assert.ok(result.limitations.includes('INCOMPLETE_SEARCH'));
  const first = result.observations[0];
  assert.equal(first.identity, 'github:public/project');
  assert.equal(first.observedAt, '2026-10-31T03:00:00.000Z');
  assert.equal(first.publishedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(first.etag, '"page1"');
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal(calls[0].headers.authorization, 'Bearer secret-read-token');
  assert.equal(JSON.stringify(result).includes('secret-read-token'), false);
});

test('GitHub empty search is not absence; unsafe qualifiers and pagination rejected', async () => {
  const {harness} = mock([response({items: []})]);
  const empty = await harness.discover('github', {query: 'nothing'});
  assert.equal(empty.status, 'OK'); assert.deepEqual(empty.observations, []);
  assert.match(empty.limitations.join(), /cannot establish comprehensive absence/);
  assert.equal((await harness.discover('github', {query: 'is:private'})).status, 'INVALID_QUERY');
  assert.equal((await harness.discover('github', {query: 'engine "'})).status, 'INVALID_QUERY');
  const unsafe = mock([response({items: [repo]}, 200, {link: '<https://api.github.com/user>; rel="next"'})]);
  const result = await unsafe.harness.discover('github', {query: 'engine'});
  assert.equal(result.status, 'PARTIAL'); assert.ok(result.limitations.includes('UNSAFE_PAGINATION'));
});

test('GitHub pagination failure preserves first page, max pages and max results are explicit', async () => {
  const page2 = `https://api.github.com/search/repositories?q=engine%20is%3Apublic&per_page=20&page=2`;
  const seq = () => [response({items: [repo]}, 200, {link: `<${page2}>; rel="next"`}), response({}, 404)];
  const partial = await mock(seq()).harness.discover('github', {query: 'engine'});
  assert.equal(partial.status, 'PARTIAL'); assert.equal(partial.observations.length, 1);
  assert.ok(partial.limitations.includes('NOT_FOUND'));
  const capped = await mock(seq(), {limits: {maxPages: 1, minIntervalMs: 0}}).harness.discover('github', {query: 'engine'});
  assert.ok(capped.limitations.includes('PAGINATION_LIMIT')); assert.equal(capped.requests, 1);
  const limited = await mock([response({items: [repo, {...repo, id: 4}]})], {limits: {maxResults: 1, minIntervalMs: 0}}).harness.discover('github', {query: 'engine'});
  assert.equal(limited.observations.length, 1);
});

test('GitHub pinned UTF-8 file verifies Git blob/hash and stays unauthenticated', async () => {
  const {harness, calls} = mock([response({private: false}), fileResponse()], {}, {token: 'secret'});
  const result = await harness.retrieve('github', {repo: 'Public/Project', ref: REF, file: 'docs/тест.md'});
  assert.equal(result.status, 'OK');
  assert.equal(result.observations[0].content, 'Привет\n');
  assert.equal(result.observations[0].revision, REF);
  assert.equal(result.observations[0].etag, '"file-1"');
  assert.match(result.observations[0].canonicalUrl, /blob\/e9ef2b8/);
  assert.match(calls[1].url, /contents\/docs\/%D1/);
  assert.ok(calls.every(c => !c.headers.authorization));
});

test('GitHub exact commit attributes source committer date separately from retrieval time', async () => {
  const {harness} = mock([response({private: false}), response({sha: REF, commit: {message: 'test', committer: {date: '2026-10-20T10:00:00Z'}}})]);
  const result = await harness.retrieve('github', {repo: 'Public/Project', ref: REF});
  assert.equal(result.status, 'OK');
  assert.equal(result.observations[0].publishedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(result.observations[0].observedAt, '2026-10-31T03:00:00.000Z');
});

test('GitHub rejects unpinned refs, private repo, invalid file, wrong blob and wrong revision', async () => {
  assert.equal((await mock([]).harness.retrieve('github', {repo: '../user', ref: REF})).status, 'INVALID_REPO');
  assert.equal((await mock([]).harness.retrieve('github', {repo: 'Public/Project', ref: 'main'})).status, 'PINNED_REF_REQUIRED');
  const privateRepo = mock([response({private: true})]);
  assert.equal((await privateRepo.harness.retrieve('github', {repo: 'Public/Project', ref: REF, file: 'README.md'})).status, 'NOT_PUBLIC');
  assert.equal(privateRepo.calls.length, 1);
  assert.equal((await mock([response({private: false})]).harness.retrieve('github', {repo: 'Public/Project', ref: REF, file: '../secret'})).status, 'INVALID_FILE');
  const bad = fileResponse(); bad.body = JSON.stringify({...JSON.parse(bad.body), sha: '0'.repeat(40)});
  assert.equal((await mock([response({private: false}), bad]).harness.retrieve('github', {repo: 'Public/Project', ref: REF, file: 'README.md'})).status, 'BLOB_HASH_MISMATCH');
  assert.equal((await mock([response({private: false}), response({sha: '0'.repeat(40), commit: {}})]).harness.retrieve('github', {repo: 'Public/Project', ref: REF})).status, 'REVISION_MISMATCH');
});

test('304 handles GitHub search/file and feeds without invented content, conditional headers retained', async () => {
  const file = mock([response({private: false}), response('', 304, {etag: '"same"'})]);
  const result = await file.harness.retrieve('github', {repo: 'Public/Project', ref: REF, file: 'README.md', etag: '"same"'});
  assert.equal(result.status, 'NOT_MODIFIED'); assert.equal(result.observations[0].content, null);
  assert.equal(result.observations[0].hash, null); assert.equal(file.calls[1].headers['if-none-match'], '"same"');
  const search = await mock([response('', 304)]).harness.discover('github', {query: 'engine', etag: '"same"'});
  assert.equal(search.status, 'NOT_MODIFIED');
  const feed = mock([xmlResponse('', 304, {etag: '"feed"'})]);
  const unchanged = await feed.harness.retrieve('rss', {url: FEED, etag: '"feed"', lastModified: 'yesterday'});
  assert.equal(unchanged.status, 'NOT_MODIFIED'); assert.equal(unchanged.observations[0].status, 'NOT_MODIFIED');
  assert.equal(feed.calls[0].headers['if-modified-since'], 'yesterday');
});

test('RSS/Atom identities, dates, CDATA, dedup and malformed items remain auditable', async () => {
  const {harness} = mock([xmlResponse(rss, 200, {etag: '"rss1"'})]);
  const result = await harness.discover('rss', {url: FEED});
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.observations.length, 2);
  const first = result.observations[0];
  assert.equal(first.identity, `${FEED}#entry=stable-1`); assert.equal(first.title, 'Привет & мир');
  assert.equal(first.content, '<b>plain data</b>');
  assert.equal(first.publishedAt, '2026-10-29T12:00:00.000Z');
  assert.equal(result.feed.updatedAt, '2026-10-30T12:00:00.000Z');
  assert.ok(result.limitations.includes('DUPLICATE_ITEM')); assert.ok(result.limitations.includes('ITEM_WITHOUT_STABLE_ID'));
  assert.ok(result.observations[1].limitations.includes('INVALID_SOURCE_DATE'));
  const parsed = parseFeed(atom, FEED, 10);
  assert.equal(parsed.entries[0].id, 'urn:example:1');
  assert.equal(parsed.entries[0].canonicalUrl, 'https://feeds.example.com/post');
  assert.equal(parsed.entries[0].content, 'data');
  assert.equal(parsed.entries[0].updatedAt, '2026-10-30T10:00:00.000Z');
});

test('feed parser rejects broken XML, DTD/XXE, wrong namespace and excessive depth', () => {
  for (const [xml, code] of [
    ['<rss><channel>', 'MALFORMED_XML'],
    ['<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel>&x;</channel></rss>', 'UNSAFE_XML'],
    ['<feed xmlns="urn:wrong"/>', 'UNSUPPORTED_FEED'],
    ['<rss>' + '<a>'.repeat(70) + '</a>'.repeat(70) + '</rss>', 'XML_LIMIT']
  ]) assert.throws(() => parseFeed(xml, FEED, 10), new RegExp(code));
  assert.equal(parseFeed('<rss><channel/></rss>', FEED, 10).entries.length, 0);
  assert.equal(parseFeed(rss, FEED, 1).entries.length, 1);
});

test('RSS refuses undeclared feed and HTML response, returns sane errors', async () => {
  const invalid = await mock([]).harness.retrieve('rss', {url: 'https://feeds.example.com/other'});
  assert.equal(invalid.status, 'FEED_NOT_CONFIGURED');
  const html = await mock([response('<html/>', 200, {'content-type': 'text/html'})]).harness.retrieve('rss', {url: FEED});
  assert.equal(html.status, 'UNSUPPORTED_CONTENT_TYPE');
});

test('HTTP errors, revoked credentials, outages and malformed responses never leak raw messages', async t => {
  for (const [status, expected] of [[401, 'AUTH_ERROR'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [429, 'THROTTLED'], [503, 'UNAVAILABLE']]) {
    await t.test(String(status), async () => {
      const {harness} = mock([response('secret-provider-error', status)], {limits: {retries: 0, minIntervalMs: 0}});
      const result = await harness.discover('github', {query: 'engine'});
      assert.equal(result.status, expected); assert.equal(JSON.stringify(result).includes('secret-provider-error'), false);
    });
  }
  assert.equal((await mock([new Error('secret-url-token')], {limits: {retries: 0, minIntervalMs: 0}}).harness.discover('github', {query: 'engine'})).status, 'NETWORK_ERROR');
  assert.equal((await mock([response('{')]).harness.discover('github', {query: 'engine'})).status, 'INVALID_RESPONSE');
});

test('bounded exponential backoff, Retry-After, reset time and request quotas', async () => {
  const transient = mock([response({}, 503), response({}, 503), response({items: []})]);
  assert.equal((await transient.harness.discover('github', {query: 'engine'})).status, 'OK');
  assert.deepEqual(transient.waits, [1000, 2000]);
  const rate = mock([response({}, 429, {'retry-after': '2'}), response({items: []})]);
  assert.equal((await rate.harness.discover('github', {query: 'engine'})).status, 'OK');
  assert.deepEqual(rate.waits, [2000]);
  const long = mock([response({}, 429, {'retry-after': '3600'})]);
  assert.equal((await long.harness.discover('github', {query: 'engine'})).status, 'THROTTLED');
  assert.equal(long.calls.length, 1);
  assert.equal((await long.harness.discover('github', {query: 'other'})).status, 'THROTTLED');
  assert.equal(long.calls.length, 1, 'rate limit suppresses later same-origin routes');
  const reset = mock([response({}, 403, {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 3)}), response({items: []})]);
  assert.equal((await reset.harness.discover('github', {query: 'engine'})).status, 'OK'); assert.deepEqual(reset.waits, [3000]);
  const capped = mock([response({}, 503)], {limits: {maxRequests: 1, minIntervalMs: 0}});
  assert.equal((await capped.harness.discover('github', {query: 'engine'})).status, 'REQUEST_LIMIT');
});

test('timeouts include DNS and body; cancellation is explicit and prompt', async () => {
  const never = () => new Promise(() => {});
  const stalledDNS = mock([], {limits: {timeoutMs: 15, minIntervalMs: 0}}, {lookup: never});
  assert.equal((await stalledDNS.harness.discover('github', {query: 'engine'})).status, 'TIMEOUT');
  const body = mock([never], {limits: {timeoutMs: 15, minIntervalMs: 0}});
  assert.equal((await body.harness.discover('github', {query: 'engine'})).status, 'TIMEOUT');
  const ctrl = new AbortController(); ctrl.abort();
  const cancelled = mock([]);
  assert.equal((await cancelled.harness.discover('github', {query: 'engine', signal: ctrl.signal})).status, 'CANCELLED');
  assert.equal(cancelled.calls.length, 0);
  const mid = mock([never]); const active = new AbortController();
  const pending = mid.harness.discover('github', {query: 'engine', signal: active.signal});
  setTimeout(() => active.abort(), 5);
  assert.equal((await pending).status, 'CANCELLED');
});

test('SSRF: URL tricks, IP literals, metadata/private DNS, mixed answers and IPv6 transitions denied', async t => {
  for (const url of ['http://api.github.com/', 'https://api.github.com@127.0.0.1/', 'https://api.github.com:444/',
    'https://0x7f000001/', 'https://2130706433/', 'https://[::1]/', 'file:///etc/passwd', 'https://api.github.com.evil.com/',
    'https://api.github.com/#secret', 'https://localhost/']) assert.throws(() => safeURL(url, HOSTS), /UNSAFE_URL/);
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '192.0.2.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', '3fff::1']) {
    await t.test(address, async () => {
      assert.equal(publicAddress(address), false);
      const m = mock([], {}, {lookup: async () => [{address, family: address.includes(':') ? 6 : 4}]});
      assert.equal((await m.harness.discover('github', {query: 'engine'})).status, 'UNSAFE_DNS');
      assert.equal(m.calls.length, 0);
    });
  }
  assert.equal(publicAddress('8.8.8.8'), true); assert.equal(publicAddress('2606:4700:4700::1111'), true);
  const mixed = mock([], {}, {lookup: async () => [{address: '8.8.8.8', family: 4}, {address: '127.0.0.1', family: 4}]});
  assert.equal((await mixed.harness.discover('github', {query: 'engine'})).status, 'UNSAFE_DNS');
});

test('redirects revalidate DNS, strip cross-origin validators and never forward tokens', async () => {
  const redirect = mock([response('', 302, {location: 'https://mirror.example.com/news.xml'}), xmlResponse(atom)], {}, {token: 'secret'});
  const result = await redirect.harness.retrieve('rss', {url: FEED, etag: '"private-validator"'});
  assert.equal(result.status, 'OK'); assert.deepEqual(redirect.dnsCalls, ['feeds.example.com', 'mirror.example.com']);
  assert.equal(redirect.calls[1].headers['if-none-match'], undefined);
  assert.ok(redirect.calls.every(c => !c.headers.authorization));
  const evil = mock([response('', 302, {location: 'https://127.0.0.1/'})]);
  assert.equal((await evil.harness.retrieve('rss', {url: FEED})).status, 'UNSAFE_URL');
  let dnsCount = 0;
  const rebind = mock([response('', 302, {location: '/next'})], {}, {lookup: async () => [{address: ++dnsCount === 1 ? '8.8.8.8' : '127.0.0.1', family: 4}]});
  assert.equal((await rebind.harness.retrieve('rss', {url: FEED})).status, 'UNSAFE_DNS');
  assert.equal(rebind.calls.length, 1);
  const auth = mock([response('', 302, {location: 'https://mirror.example.com/'})], {}, {token: 'secret'});
  assert.equal((await auth.harness.discover('github', {query: 'engine'})).status, 'UNSAFE_REDIRECT');
  assert.equal(auth.calls.length, 1);
});

test('wire pins checked addresses to lookup, disables agents and enforces streaming size/encoding', async () => {
  const perform = async ({encoding, length, chunks = ['ok'], all = false, maxBytes = 10}) => {
    let checked;
    const wire = (url, opts, callback) => {
      const req = new EventEmitter(); req.destroy = error => req.emit('error', error);
      req.end = () => queueMicrotask(() => {
        assert.equal(opts.agent, false);
        opts.lookup('feeds.example.com', {all}, (error, value, family) => { assert.equal(error, null); checked = {value, family}; });
        const res = new EventEmitter(); res.statusCode = 200;
        res.headers = {...(encoding ? {'content-encoding': encoding} : {}), ...(length ? {'content-length': length} : {})};
        res.destroy = () => {};
        callback(res);
        for (const chunk of chunks) res.emit('data', Buffer.from(chunk));
        res.emit('end');
      });
      return req;
    };
    const response = await httpsWire(new URL(FEED), {addresses: [{address: '8.8.8.8', family: 4}], headers: {}, maxBytes}, wire);
    return {response, checked};
  };
  assert.deepEqual((await perform({})).checked, {value: '8.8.8.8', family: 4});
  assert.deepEqual((await perform({all: true})).checked.value, [{address: '8.8.8.8', family: 4}]);
  await assert.rejects(perform({encoding: 'gzip'}), /UNSUPPORTED_ENCODING/);
  await assert.rejects(perform({length: '999'}), /TOO_LARGE/);
  await assert.rejects(perform({chunks: ['123456', '789012']}), /TOO_LARGE/);
});

test('transport serializes concurrent requests, applies pacing and size bounds', async () => {
  let active = 0, peak = 0;
  const m = mock([async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 5)); active--; return response({}); }, response({})], {limits: {minIntervalMs: 1000}});
  await Promise.all([m.client.get(FEED), m.client.get(FEED)]);
  assert.equal(peak, 1); assert.deepEqual(m.waits, [1000]);
  const big = mock([response('0123456789')], {limits: {maxBytes: 5, minIntervalMs: 0}});
  await assert.rejects(big.client.get(FEED), /TOO_LARGE/);
});

test('fixture adapter is deterministic with fake clock, deduplicates and models failures', async () => {
  const fixture = {version: 1, items: [{id: 'a', content: 'данные'}, {id: 'a', content: 'duplicate'}]};
  const {harness, calls} = mock([], {}, {fixture});
  const first = await harness.discover('fixture');
  assert.equal(first.observations.length, 1); assert.equal(calls.length, 0);
  const retrieved = await harness.retrieve('fixture', {id: 'a'});
  assert.deepEqual(first.observations, retrieved.observations);
  assert.equal(retrieved.request.operation, 'retrieve');
  assert.match(first.observations[0].limitations.join(), /Synthetic/);
  const failed = mock([], {}, {fixture: {...fixture, error: 'TIMEOUT'}});
  assert.equal((await failed.harness.discover('fixture')).status, 'TIMEOUT');
});

test('explicit fallback preserves failed-route summary and never invents source equivalence', async () => {
  const {harness} = mock([response({}, 401), xmlResponse(atom)]);
  const result = await harness.fallback([{source: 'github', query: 'engine'}, {source: 'rss', url: FEED}]);
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.observations[0].adapter, 'rss');
  assert.deepEqual(result.attempts.map(a => a.status), ['AUTH_ERROR', 'OK']);
  assert.equal(result.requests, 2);
  const unavailable = await mock([response({items: []})]).harness.fallback([{source: 'github', query: 'engine'}]);
  assert.equal(unavailable.status, 'UNAVAILABLE'); assert.match(unavailable.limitations.join(), /not evidence of absence/);
  await assert.rejects(harness.fallback([{source: 'web', script: 'bad'}]), /INVALID_ROUTES/);
});

test('RSS resolves xml:base and redirected relative links without crawling', () => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://publisher.example.com/base/"><entry><id>a</id><link href="post"/></entry></feed>`;
  assert.equal(parseFeed(feed, FEED, 2).entries[0].canonicalUrl, 'https://publisher.example.com/base/post');
  assert.equal(parseFeed(atom, FEED, 2, 'https://mirror.example.com/final.xml').entries[0].canonicalUrl, 'https://mirror.example.com/post');
});

test('redirect loops have finite budget and DNS failures/invalid URLs finish promptly', async () => {
  const loop = mock([response('', 302, {location: FEED}), response('', 302, {location: FEED})], {limits: {maxRedirects: 1, minIntervalMs: 0}});
  assert.equal((await loop.harness.retrieve('rss', {url: FEED})).status, 'REDIRECT_LIMIT');
  assert.equal(loop.calls.length, 2);
  const dns = mock([], {}, {lookup: async () => { throw new Error('provider-secret'); }});
  assert.equal((await dns.harness.retrieve('rss', {url: FEED})).status, 'NETWORK_ERROR');
  await assert.rejects(mock([]).client.get('https://127.0.0.1/'), /UNSAFE_URL/);
});

test('live doctor reports partial adapter availability and masked auth failures', async () => {
  const {harness} = mock([response({}, 401), xmlResponse('<rss><channel/></rss>')], {}, {token: 'revoked-secret'});
  const result = await harness.doctor({live: true});
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.adapters[0].status, 'AUTH_ERROR');
  assert.equal(result.adapters[1].status, 'AVAILABLE');
  assert.equal(JSON.stringify(result).includes('revoked-secret'), false);
});

test('invalid configuration rejects unsafe hosts, credentials and unbounded quotas', () => {
  for (const config of [{allowedHosts: ['localhost']}, {allowedHosts: ['api.github.com'], feeds: ['https://other.example.com/']},
    {token: 'never'}, {limits: {maxBytes: Infinity}}, {limits: {retries: 999}}, {adapters: {rss: 'yes'}}, {version: 2}]) {
    assert.throws(() => validateConfig(config), HarnessError);
  }
});

test('CLI supports human/JSON output, fixture success and explicit unavailable/usage codes offline', () => {
  const cli = fileURLToPath(new URL('../tools/research-engine.mjs', import.meta.url));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = args => spawnSync(process.execPath, [cli, ...args], {cwd: root, encoding: 'utf8', timeout: 5000});
  assert.equal(run(['--help']).status, 0);
  assert.equal(run(['doctor', '--json']).status, 0);
  assert.match(run(['doctor']).stdout, /web: UNAVAILABLE \/ NO_CREDENTIALS/);
  const fixture = run(['discover', '--source', 'fixture', '--fixture', 'tests/fixtures/harness.json', '--json']);
  assert.equal(fixture.status, 0); assert.equal(JSON.parse(fixture.stdout).observations.length, 2);
  assert.equal(run(['discover', '--source', 'web', '--json']).status, 1);
  assert.equal(run(['watch']).status, 2);
  assert.equal(run(['doctor', '--unknown']).status, 2);
  assert.equal(run(['doctor', '--config', '.env']).status, 2);
});
