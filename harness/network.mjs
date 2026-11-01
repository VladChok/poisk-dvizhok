import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import ipaddr from 'ipaddr.js';
import {setTimeout as delay} from 'node:timers/promises';

export class HarnessError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const fail = code => { throw new HarnessError(code); };
export const defaults = Object.freeze({timeoutMs: 10000, maxBytes: 1048576, maxResults: 20,
  maxRequests: 12, maxPages: 3, maxRedirects: 3, retries: 2, minIntervalMs: 1000, maxWaitMs: 30000});
const ceilings = {timeoutMs: 60000, maxBytes: 4194304, maxResults: 100, maxRequests: 50,
  maxPages: 10, maxRedirects: 5, retries: 3, minIntervalMs: 60000, maxWaitMs: 60000};
export function limits(input = {}) {
  for (const key of Object.keys(input)) if (!(key in defaults)) fail('INVALID_LIMITS');
  const out = {...defaults, ...input};
  for (const [key, value] of Object.entries(out)) {
    const minimum = ['retries', 'maxRedirects', 'minIntervalMs', 'maxWaitMs'].includes(key) ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum || value > ceilings[key]) fail('INVALID_LIMITS');
  }
  return out;
}
export function safeURL(value, hosts) {
  if (typeof value !== 'string' || value.length > 8192) fail('UNSAFE_URL');
  let url;
  try { url = new URL(value); } catch { fail('UNSAFE_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      net.isIP(url.hostname.replace(/^\[|\]$/g, '')) || !hosts.includes(url.hostname) ||
      !/^[a-z0-9.-]+$/.test(url.hostname) || !url.hostname.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) fail('UNSAFE_URL');
  return url;
}
export function publicAddress(address) {
  try {
    const ip = ipaddr.parse(address);
    if (ip.range() !== 'unicast') return false;
    // Only global-unicast IPv6; exclude transition/translation and special-use blocks.
    if (ip.kind() === 'ipv6') return ip.match(ipaddr.parseCIDR('2000::/3')) &&
      !ip.match(ipaddr.parseCIDR('2001::/23')) && !ip.match(ipaddr.parseCIDR('2002::/16')) &&
      !ip.match(ipaddr.parseCIDR('3fff::/20'));
    return true;
  } catch { return false; }
}
async function bounded(promise, signal) {
  if (signal.aborted) fail(signal.reason?.code || 'CANCELLED');
  let abort;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(new HarnessError(signal.reason?.code || 'CANCELLED'));
      signal.addEventListener('abort', abort, {once: true});
    })]);
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}

// DNS is resolved once per hop. The connection lookup returns ONLY those checked
// addresses; an HTTP agent or second DNS resolution cannot bypass the decision.
export function httpsWire(url, {addresses, headers, signal, maxBytes}, requestImpl = https.request) {
  return new Promise((resolve, reject) => {
    const lookup = (_hostname, options, callback) => {
      if (typeof options === 'function') { callback = options; options = {}; }
      const candidates = addresses.filter(a => !options.family || a.family === options.family);
      if (!candidates.length) return callback(new HarnessError('DNS_ERROR'));
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    };
    const request = requestImpl(url, {method: 'GET', agent: false, lookup, headers, signal}, response => {
      const chunks = []; let bytes = 0;
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); request.destroy(new HarnessError('UNSUPPORTED_ENCODING')); return;
      }
      if (Number(response.headers['content-length']) > maxBytes) {
        response.destroy(); request.destroy(new HarnessError('TOO_LARGE')); return;
      }
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(); request.destroy(new HarnessError('TOO_LARGE')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks)}));
    });
    request.on('error', reject);
    request.end();
  });
}

export function createClient({hosts, budget = {}, token, clock = () => Date.now(), sleep = delay,
  lookup = hostname => dns.lookup(hostname, {all: true, verbatim: true}), wire = httpsWire} = {}) {
  const quota = limits(budget);
  if (!Array.isArray(hosts) || !hosts.length || hosts.some(h => typeof h !== 'string' || h !== h.toLowerCase())) fail('INVALID_HOSTS');
  let requests = 0, lastRequest = null, queue = Promise.resolve();
  const cooldowns = new Map();
  const trace = [];
  async function perform(input, {signal: external, etag, lastModified, validatorUrl, auth = false} = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort(new HarnessError('CANCELLED'));
    if (external?.aborted) cancel();
    external?.addEventListener('abort', cancel, {once: true});
    // Wall-clock timeout covers DNS, pacing, redirects, retries AND response body.
    const timer = setTimeout(() => controller.abort(new HarnessError('TIMEOUT')), quota.timeoutMs);
    const signal = controller.signal;
    let url, origin, requestUrl, conditionUrl, hops = 0, attempt = 0;
    try {
      url = safeURL(input, hosts); origin = url.origin; requestUrl = url.href;
      conditionUrl = validatorUrl === undefined ? requestUrl : safeURL(validatorUrl, hosts).href;
      while (true) {
        if (signal.aborted) fail(signal.reason?.code || 'CANCELLED');
        if ((cooldowns.get(url.origin) || 0) > clock()) fail('THROTTLED');
        if (requests >= quota.maxRequests) fail('REQUEST_LIMIT');
        if (lastRequest !== null) {
          const wait = quota.minIntervalMs - (clock() - lastRequest);
          if (wait > 0) await bounded(sleep(wait, undefined, {signal}), signal);
        }
        const addresses = await bounded(lookup(url.hostname), signal);
        if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !publicAddress(a.address) || net.isIP(a.address) !== a.family)) fail('UNSAFE_DNS');
        const headers = {'user-agent': 'poisk-dvizhok-source-harness/1', accept: 'application/json, application/atom+xml, application/rss+xml, application/xml, text/xml', 'accept-encoding': 'identity'};
        if (url.hostname === 'api.github.com') {
          headers['x-github-api-version'] = '2022-11-28';
          if (auth && token && url.origin === origin) headers.authorization = `Bearer ${token}`;
        }
        // A validator belongs to one exact URI, not an origin. After any
        // redirect retrieve unconditionally, including a same-origin path/query.
        if (hops === 0 && url.href === requestUrl && conditionUrl === requestUrl) {
          if (etag) headers['if-none-match'] = etag;
          if (lastModified) headers['if-modified-since'] = lastModified;
        }
        requests++; lastRequest = clock();
        let response;
        try {
          response = await bounded(wire(url, {addresses, headers, signal, maxBytes: quota.maxBytes}), signal);
        } catch (error) {
          if (signal.aborted) fail(signal.reason?.code || 'CANCELLED');
          if (error instanceof HarnessError) throw error;
          if (attempt++ < quota.retries) {
            const wait = 1000 * 2 ** (attempt - 1);
            if (wait <= quota.maxWaitMs) { await bounded(sleep(wait, undefined, {signal}), signal); continue; }
          }
          fail('NETWORK_ERROR');
        }
        const body = Buffer.from(response.body ?? '');
        if (body.length > quota.maxBytes) fail('TOO_LARGE');
        const headersOut = Object.fromEntries(Object.entries(response.headers || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
        trace.push({host: url.hostname, status: response.status, bytes: body.length});
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          if (hops++ >= quota.maxRedirects || !headersOut.location) fail('REDIRECT_LIMIT');
          url = safeURL(new URL(headersOut.location, url).href, hosts);
          // GitHub authenticated API operations may not redirect to another host.
          if ((auth || new URL(input).hostname === 'api.github.com') && url.origin !== origin) fail('UNSAFE_REDIRECT');
          continue;
        }
        const rateLimited = response.status === 429 || (response.status === 403 &&
          (headersOut['x-ratelimit-remaining'] === '0' || headersOut['retry-after']));
        if (rateLimited || response.status >= 500) {
          let wait = rateLimited ? 60000 * 2 ** attempt : 1000 * 2 ** attempt;
          if (headersOut['retry-after']) {
            const value = headersOut['retry-after'];
            wait = /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - clock());
          } else if (headersOut['x-ratelimit-remaining'] === '0' && headersOut['x-ratelimit-reset']) {
            wait = Math.max(0, Number(headersOut['x-ratelimit-reset']) * 1000 - clock());
          }
          wait = Number.isFinite(wait) ? Math.max(1000, wait) : 60000;
          if (rateLimited || headersOut['retry-after']) cooldowns.set(url.origin, clock() + wait);
          if (wait <= quota.maxWaitMs && attempt < quota.retries) {
            attempt++; await bounded(sleep(wait, undefined, {signal}), signal); continue;
          }
        }
        return {status: response.status, headers: headersOut, body, url: url.href, requests,
          representation: {version: 1, requestUrl, effectiveUrl: url.href, redirected: hops > 0,
            conditional: {uri: url.href, etag: headers['if-none-match'] || null, lastModified: headers['if-modified-since'] || null}},
          retryable: Boolean(rateLimited || response.status >= 500)};
      }
    } catch (error) {
      if (signal.aborted) fail(signal.reason?.code || 'CANCELLED');
      if (error instanceof HarnessError) throw error;
      fail('NETWORK_ERROR');
    } finally {
      clearTimeout(timer); external?.removeEventListener('abort', cancel);
    }
  }
  return {quota, trace, get requests() { return requests; },
    get cooldowns() { return [...cooldowns].filter(([,at])=>at>clock()).map(([origin,at])=>({origin,retryAt:new Date(Math.min(at,253402300799999)).toISOString()})); },
    get: (url, options = {}) => {
      // One active request per harness; rejected callers do not poison the queue.
      const task = queue.then(() => perform(url, options));
      queue = task.catch(() => {});
      return task;
    }};
}
