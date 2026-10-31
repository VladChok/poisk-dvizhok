import {createHash} from 'node:crypto';
import {createClient, fail, HarnessError, safeURL, limits} from './network.mjs';
import {parseFeed} from './feed.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const validRepo = value => typeof value === 'string' && repoPattern.test(value) && value.split('/').every(p => p !== '.' && p !== '..');
const text = buffer => { try { return new TextDecoder('utf-8', {fatal: true}).decode(buffer); } catch { fail('UNSUPPORTED_TEXT'); } };
const parse = buffer => { try { return JSON.parse(text(buffer)); } catch { fail('INVALID_RESPONSE'); } };
function jsonResponse(response) {
  if (!/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(response.headers['content-type'] || '')) fail('UNSUPPORTED_CONTENT_TYPE');
  return parse(response.body);
}
const statusCode = response => ({304: 'NOT_MODIFIED', 401: 'AUTH_ERROR', 403: response.retryable ? 'THROTTLED' : 'FORBIDDEN',
  404: 'NOT_FOUND', 429: 'THROTTLED'}[response.status] || (response.status >= 500 ? 'UNAVAILABLE' : 'HTTP_ERROR'));
const errorCode = error => error instanceof HarnessError ? error.code : 'INVALID_RESPONSE';
const initial = adapter => ({version: 1, adapter, status: 'OK', observations: [], limitations: [], requests: 0});
function observation(adapter, values, response, now) {
  const limitations = [...(values.limitations || [])];
  const date = value => {
    if (!value) return null;
    if (!Number.isFinite(Date.parse(value))) { limitations.push('INVALID_SOURCE_DATE'); return null; }
    return new Date(value).toISOString();
  };
  return {version: 1, adapter, sourceType: values.sourceType, identity: values.identity,
    canonicalUrl: values.canonicalUrl, accessRoute: response?.url || 'offline-fixture',
    observedAt: new Date(now()).toISOString(), publishedAt: date(values.publishedAt),
    updatedAt: date(values.updatedAt), revision: values.revision || null,
    etag: response?.headers.etag || null, lastModified: response?.headers['last-modified'] || null,
    hash: values.hash || (response?.body?.length ? sha256(response.body) : null),
    status: values.status || 'OBSERVED', title: values.title || '', content: values.content ?? null,
    limitations};
}

export function validateConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('INVALID_CONFIG');
  const known = ['version', 'allowedHosts', 'feeds', 'adapters', 'limits'];
  if (Object.keys(config).some(key => !known.includes(key)) || (config.version !== undefined && config.version !== 1)) fail('INVALID_CONFIG');
  const hosts = config.allowedHosts ?? ['api.github.com'];
  if (!Array.isArray(hosts) || hosts.length > 50 || hosts.some(h => typeof h !== 'string' || !h)) fail('INVALID_CONFIG');
  for (const h of hosts) safeURL(`https://${h}/`, hosts);
  const feeds = config.feeds ?? [];
  if (!Array.isArray(feeds) || feeds.length > 50) fail('INVALID_CONFIG');
  const normalizedFeeds = feeds.map(f => safeURL(f, hosts).href);
  const adapters = {github: true, rss: true, fixture: true, ...config.adapters};
  if (Object.entries(adapters).some(([key, value]) => !['github', 'rss', 'fixture'].includes(key) || typeof value !== 'boolean')) fail('INVALID_CONFIG');
  return {version: 1, allowedHosts: hosts, feeds: normalizedFeeds, adapters, limits: limits(config.limits)};
}

export function createHarness(input = {}, deps = {}) {
  const config = validateConfig(input), now = deps.clock || (() => Date.now());
  const client = createClient({...deps, hosts: config.allowedHosts, budget: config.limits,
    token: deps.token ?? process.env.GITHUB_TOKEN});
  const github = 'https://api.github.com';
  function enabled(source) {
    if (source === 'web') fail('NO_CREDENTIALS');
    if (!(source in config.adapters)) fail('UNKNOWN_ADAPTER');
    if (!config.adapters[source]) fail('DISABLED');
  }
  async function publicRepo(repo, signal) {
    if (!validRepo(repo)) fail('INVALID_REPO');
    // Deliberately unauthenticated: a configured token must never grant access to
    // private repository content. File/commit retrieval also remains public-only.
    const result = await client.get(`${github}/repos/${repo}`, {signal});
    if (result.status !== 200) throw new HarnessError(statusCode(result));
    const meta = jsonResponse(result);
    if (meta.private !== false || meta.visibility === 'private') fail('NOT_PUBLIC');
    return meta;
  }
  async function githubDiscover(options, result) {
    const query = options.query;
    // Restrict user input to plain terms: caller cannot override is:public.
    if (typeof query !== 'string' || !query.trim() || query.length > 200 || !/^[\p{L}\p{N} _./-]+$/u.test(query)) fail('INVALID_QUERY');
    let next = `${github}/search/repositories?q=${encodeURIComponent(query + ' is:public')}&per_page=${config.limits.maxResults}`;
    const visited = new Set(), seen = new Set(); let page = 0;
    while (next && page++ < config.limits.maxPages && result.observations.length < config.limits.maxResults) {
      if (visited.has(next)) { result.limitations.push('PAGINATION_LOOP'); break; }
      visited.add(next);
      const response = await client.get(next, {signal: options.signal, auth: true,
        etag: page === 1 ? options.etag : undefined, lastModified: page === 1 ? options.lastModified : undefined});
      if (response.status !== 200) {
        result.status = statusCode(response);
        if (response.status === 304) result.observations.push(observation('github', {
          sourceType: 'repository-search', identity: next, canonicalUrl: 'https://github.com/search', status: 'NOT_MODIFIED',
          limitations: ['No content returned; caller must retain previous observations.']}, response, now));
        return;
      }
      const data = jsonResponse(response);
      if (!Array.isArray(data.items)) fail('INVALID_RESPONSE');
      result.coverage.pagesFetched++; result.coverage.itemsSeen += data.items.length;
      if (data.incomplete_results) result.limitations.push('INCOMPLETE_SEARCH');
      const inspectedBefore = result.coverage.itemsInspected;
      for (const item of data.items) {
        result.coverage.itemsInspected++;
        if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.id) || item.id < 1) { result.coverage.invalidItems++; continue; }
        if (item.private === true) { result.coverage.filteredItems++; continue; }
        if (item.private !== false || !validRepo(item.full_name)) { result.coverage.invalidItems++; continue; }
        if (seen.has(item.id)) { result.coverage.duplicateItems++; continue; }
        seen.add(item.id);
        result.observations.push(observation('github', {sourceType: 'repository', identity: `github:${item.full_name.toLowerCase()}`,
          canonicalUrl: `https://github.com/${item.full_name}`, title: item.full_name,
          publishedAt: item.created_at, updatedAt: item.updated_at,
          limitations: ['Discovery lead; popularity, search ranking and a search miss do not verify facts or absence.']}, response, now));
        if (result.observations.length >= config.limits.maxResults) break;
      }
      if (result.coverage.itemsInspected - inspectedBefore < data.items.length) result.limitations.push('RESULT_LIMIT');
      const link = response.headers.link?.match(/<([^>]+)>;\s*rel="next"/);
      next = link?.[1] || null;
      if (next) {
        const url = safeURL(next, ['api.github.com']);
        const first = new URL([...visited][0]);
        if ([...url.searchParams.keys()].some(k => !['q', 'per_page', 'page'].includes(k) || url.searchParams.getAll(k).length !== 1) ||
            url.origin !== first.origin || url.pathname !== first.pathname || url.searchParams.get('q') !== first.searchParams.get('q') ||
            url.searchParams.get('per_page') !== first.searchParams.get('per_page') || !/^\d+$/.test(url.searchParams.get('page'))) fail('UNSAFE_PAGINATION');
      }
    }
    if (next) result.limitations.push('PAGINATION_LIMIT');
    result.coverage.complete = !next && !result.limitations.some(l => /LIMIT|INCOMPLETE|LOOP/.test(l));
    result.limitations.push('Search is bounded and cannot establish comprehensive absence.');
  }
  async function githubRetrieve(options, result) {
    const {repo, ref, file, signal} = options;
    if (!sha(ref)) fail('PINNED_REF_REQUIRED');
    await publicRepo(repo, signal);
    let endpoint = `${github}/repos/${repo}/commits/${ref}`;
    let canonicalUrl = `https://github.com/${repo}/commit/${ref}`;
    if (file !== undefined) {
      if (typeof file !== 'string' || !file || file.length > 1000 || /[\\\x00-\x1f]/.test(file) ||
          file.split('/').some(part => !part || part === '..' || part === '.')) fail('INVALID_FILE');
      const encoded = file.split('/').map(encodeURIComponent).join('/');
      endpoint = `${github}/repos/${repo}/contents/${encoded}?ref=${ref}`;
      canonicalUrl = `https://github.com/${repo}/blob/${ref}/${encoded}`;
    }
    const response = await client.get(endpoint, {signal, etag: options.etag, lastModified: options.lastModified});
    if (response.status !== 200 && response.status !== 304) { result.status = statusCode(response); return; }
    const data = response.status === 200 ? jsonResponse(response) : {};
    const limitations = [];
    let content = null, contentHash = null, publishedAt = null;
    if (response.status === 200) {
      if (file !== undefined) {
        if (data.type !== 'file' || data.encoding !== 'base64' || !sha(data.sha) || typeof data.content !== 'string') fail('UNSUPPORTED_FILE');
        const encoded = data.content.replace(/\s/g, '');
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail('INVALID_RESPONSE');
        const bytes = Buffer.from(encoded, 'base64');
        if (bytes.length > config.limits.maxBytes || data.size !== bytes.length) fail('TOO_LARGE');
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blob !== data.sha) fail('BLOB_HASH_MISMATCH');
        content = text(bytes); contentHash = sha256(bytes);
        limitations.push('GitHub contents API file representation; submodules, directories and binary/non-UTF8 files unsupported.');
      } else {
        if (data.sha !== ref || !data.commit) fail('REVISION_MISMATCH');
        content = data.commit.message || ''; publishedAt = data.commit.committer?.date || null;
        limitations.push('Committer date is source metadata, not retrieval time or independently verified event time.');
      }
    } else limitations.push('No content returned; retain last known good content.');
    result.status = response.status === 304 ? 'NOT_MODIFIED' : 'OK';
    result.observations.push(observation('github', {sourceType: file !== undefined ? 'file' : 'commit',
      identity: `github:${repo.toLowerCase()}:${ref}:${file ?? ''}`, canonicalUrl, revision: ref,
      title: file ?? ref, content, hash: contentHash, publishedAt,
      status: response.status === 304 ? 'NOT_MODIFIED' : 'OBSERVED', limitations}, response, now));
  }
  async function rss(options, result) {
    const url = safeURL(options.url, config.allowedHosts).href;
    if (!config.feeds.includes(url)) fail('FEED_NOT_CONFIGURED');
    const response = await client.get(url, {signal: options.signal, etag: options.etag, lastModified: options.lastModified});
    if (response.status !== 200 && response.status !== 304) { result.status = statusCode(response); return; }
    if (response.status === 304) {
      result.status = 'NOT_MODIFIED';
      result.observations.push(observation('rss', {sourceType: 'feed', identity: url, canonicalUrl: url,
        status: 'NOT_MODIFIED', limitations: ['No entries returned; retain previous baseline.']}, response, now));
      return;
    }
    if (!/^(application\/(rss\+xml|atom\+xml|xml)|text\/xml)(;|$)/i.test(response.headers['content-type'] || '')) fail('UNSUPPORTED_CONTENT_TYPE');
    const feed = parseFeed(text(response.body), url, config.limits.maxResults, response.url);
    result.feed = {identity: url, updatedAt: feed.updatedAt, etag: response.headers.etag || null,
      lastModified: response.headers['last-modified'] || null, hash: sha256(response.body), totalItems: feed.totalItems};
    result.limitations.push(...feed.limitations);
    Object.assign(result.coverage, feed.counters, {pagesFetched: 1, complete: feed.counters.itemsInspected === feed.totalItems});
    result.observations = feed.entries.map(entry => observation('rss', {sourceType: 'feed-entry',
      ...entry, revision: entry.hash, limitations: [...entry.limitations, 'Feed publisher claims; linked pages were not fetched.']}, response, now));
    if (feed.limitations.some(x => x !== 'RESULT_LIMIT')) result.status = 'PARTIAL';
  }
  function fixture(options, result) {
    result.coverage ||= {version: 1, pagesFetched: null, itemsSeen: 0, itemsInspected: 0, duplicateItems: 0,
      invalidItems: 0, filteredItems: 0, resultCap: config.limits.maxResults, pageCap: config.limits.maxPages, complete: false};
    const data = deps.fixture;
    if (!data || data.version !== 1 || !Array.isArray(data.items) || data.items.length > 1000) fail('INVALID_FIXTURE');
    if (data.error) fail(['TIMEOUT', 'UNAVAILABLE', 'AUTH_ERROR'].includes(data.error) ? data.error : 'INVALID_FIXTURE');
    const seen = new Set();
    result.coverage.itemsSeen = data.items.length; result.coverage.itemsInspected = data.items.length;
    result.observations = data.items.filter(item => {
      if (typeof item.id !== 'string' || !item.id || typeof item.content !== 'string') { result.coverage.invalidItems++; return false; }
      if (seen.has(item.id)) { result.coverage.duplicateItems++; return false; }
      seen.add(item.id);
      if (options.id && item.id !== options.id) { result.coverage.filteredItems++; return false; }
      return true;
    }).slice(0, config.limits.maxResults).map(item => observation('fixture', {sourceType: 'fixture', identity: `fixture:${item.id}`,
      canonicalUrl: `fixture:${item.id}`, title: item.id, content: item.content, revision: sha256(item.content), hash: sha256(item.content),
      limitations: ['Synthetic fixture, not a live source.']}, null, now));
    result.coverage.complete = seen.size <= config.limits.maxResults && result.coverage.invalidItems === 0;
  }
  async function execute(operation, source, options = {}) {
    const result = initial(source), before = client.requests;
    result.coverage = {version: 1, pagesFetched: operation === 'discover' || source === 'rss' ? 0 : null,
      itemsSeen: 0, itemsInspected: 0, duplicateItems: 0, invalidItems: 0, filteredItems: 0,
      resultCap: config.limits.maxResults, pageCap: config.limits.maxPages, complete: false};
    result.request = {operation, ...Object.fromEntries(['query', 'repo', 'ref', 'file', 'url', 'id']
      .filter(key => typeof options[key] === 'string').map(key => [key, options[key]]))};
    try {
      enabled(source);
      if (source === 'github') await (operation === 'discover' ? githubDiscover : githubRetrieve)(options, result);
      else if (source === 'rss') await rss(options, result);
      else fixture(options, result);
    } catch (error) {
      result.status = errorCode(error);
    }
    if (result.observations.length && !['OK', 'NOT_MODIFIED', 'PARTIAL'].includes(result.status)) {
      result.limitations.push(result.status); result.status = 'PARTIAL';
    }
    result.requests = client.requests - before;
    if (source === 'github' && operation === 'retrieve' && ['OK', 'NOT_MODIFIED'].includes(result.status)) result.coverage.complete = true;
    result.trace = client.trace.slice(-result.requests);
    if (result.requests === 0) result.trace = [];
    return result;
  }
  async function doctor({live = false, signal} = {}) {
    const adapters = Object.entries(config.adapters).map(([adapter, on]) => ({adapter,
      status: !on ? 'DISABLED' : adapter === 'rss' && !config.feeds.length ? 'UNCONFIGURED' : adapter === 'fixture' && !deps.fixture ? 'UNCONFIGURED' : 'CONFIGURED',
      mode: adapter === 'github' ? ((deps.token ?? process.env.GITHUB_TOKEN) ? 'token for public discovery/doctor; retrieval unauthenticated' : 'public unauthenticated') : adapter === 'rss' ? 'declared feeds only' : 'offline'}));
    if (live) for (const item of adapters) {
      if (item.status !== 'CONFIGURED') continue;
      if (item.adapter === 'github') {
        try {
          const response = await client.get(`${github}/rate_limit`, {signal, auth: true});
          item.status = response.status === 200 ? 'AVAILABLE' : statusCode(response);
        } catch (error) { item.status = errorCode(error); }
      } else if (item.adapter === 'rss') {
        const probes = [];
        for (const url of config.feeds) probes.push(await execute('retrieve', 'rss', {url, signal}));
        item.feeds = probes.map((probe, i) => ({url: config.feeds[i], status: probe.status}));
        item.status = probes.every(p => ['OK', 'NOT_MODIFIED'].includes(p.status)) ? 'AVAILABLE' : 'PARTIAL';
      } else item.status = fixtureStatus();
    }
    adapters.push({adapter: 'web', status: 'UNAVAILABLE', reason: 'NO_CREDENTIALS', limitation: 'No general web provider is implemented/configured.'});
    return {version: 1, status: adapters.some(a => !['AVAILABLE', 'CONFIGURED', 'DISABLED', 'UNCONFIGURED'].includes(a.status) && a.adapter !== 'web') ? 'PARTIAL' : 'OK',
      mode: live ? 'live-manual' : 'configuration-only; network not tested', adapters, limits: config.limits, requests: client.requests};
  }
  function fixtureStatus() { try { fixture({}, initial('fixture')); return 'AVAILABLE'; } catch (error) { return errorCode(error); } }
  async function fallback(routes, {signal} = {}) {
    if (!Array.isArray(routes) || !routes.length || routes.length > 5) fail('INVALID_ROUTES');
    const attempts = [];
    for (const route of routes) {
      if (!route || !['github', 'rss', 'fixture'].includes(route.source) ||
          Object.keys(route).some(k => !['source', 'query', 'url', 'id'].includes(k))) fail('INVALID_ROUTES');
      const result = await execute('discover', route.source, {...route, signal});
      attempts.push({adapter: route.source, status: result.status, count: result.observations.length,
        request: result.request, trace: result.trace, limitations: result.limitations, requests: result.requests, coverage: result.coverage});
      if (result.observations.length) return {...result, attempts,
        requests: attempts.reduce((n, a) => n + a.requests, 0),
        status: attempts.length > 1 || result.status === 'PARTIAL' ? 'PARTIAL' : result.status,
        limitations: [...result.limitations, 'Explicit caller-supplied fallback routes; outputs are not equivalent sources or verified facts.']};
      if (result.status === 'CANCELLED') break;
    }
    return {version: 1, adapter: attempts.at(-1).adapter, request: attempts.at(-1).request, coverage: attempts.at(-1).coverage,
      trace: attempts.flatMap(a => a.trace), status: signal?.aborted ? 'CANCELLED' : 'UNAVAILABLE', observations: [], attempts,
      requests: attempts.reduce((n, a) => n + a.requests, 0), limitations: ['No usable observations in the declared bounded routes. This is not evidence of absence.']};
  }
  // Serialize whole operations as well as network requests so quotas/traces cannot
  // be misattributed when the module API is used by concurrent callers.
  let queue = Promise.resolve();
  const serial = fn => { const pending = queue.then(fn); queue = pending.catch(() => {}); return pending; };
  return {discover: (source, options) => serial(() => execute('discover', source, options)),
    retrieve: (source, options) => serial(() => execute('retrieve', source, options)),
    doctor: options => serial(() => doctor(options)),
    fallback: (routes, options) => serial(() => fallback(routes, options)), config};
}
