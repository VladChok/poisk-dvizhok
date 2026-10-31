import {SaxesParser} from 'saxes';
import {createHash} from 'node:crypto';
import {fail} from './network.mjs';

const ATOM = 'http://www.w3.org/2005/Atom';
const hash = text => createHash('sha256').update(text).digest('hex');
function date(value, limitations) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) { limitations.push('INVALID_SOURCE_DATE'); return null; }
  return new Date(time).toISOString();
}
export function parseFeed(xml, feedURL, maxResults, documentURL = feedURL) {
  const parser = new SaxesParser({xmlns: true});
  const stack = []; let root, nodes = 0;
  parser.on('doctype', () => fail('UNSAFE_XML'));
  parser.on('error', () => fail('MALFORMED_XML'));
  parser.on('opentag', tag => {
    if (++nodes > 20000 || stack.length >= 64) fail('XML_LIMIT');
    let base = stack.at(-1)?.base || documentURL;
    if (tag.attributes['xml:base']) {
      try { base = new URL(tag.attributes['xml:base'].value, base).href; } catch { base = 'invalid:'; }
    }
    const node = {name: tag.local, uri: tag.uri, attrs: tag.attributes, base, children: [], text: ''};
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    stack.push(node);
  });
  const text = value => { if (stack.length) stack.at(-1).text += value; };
  parser.on('text', text); parser.on('cdata', text);
  parser.on('closetag', () => {
    const node = stack.pop();
    if (stack.length) stack.at(-1).text += node.text;
  });
  try { parser.write(xml).close(); } catch (error) {
    if (error.code) throw error;
    fail('MALFORMED_XML');
  }
  const atom = root?.name === 'feed' && root.uri === ATOM;
  if (!atom && !(root?.name === 'rss' && root.uri === '')) fail('UNSUPPORTED_FEED');
  const namespace = atom ? ATOM : '';
  const children = (n, name) => n?.children.filter(c => c.name === name && c.uri === namespace) || [];
  const value = (n, name) => children(n, name)[0]?.text.trim() || null;
  const container = atom ? root : children(root, 'channel')[0];
  if (!container) fail('MALFORMED_FEED');
  const candidates = children(container, atom ? 'entry' : 'item');
  const entries = [], issues = [], seen = new Set();
  for (const item of candidates) {
    const linkNode = atom ? children(item, 'link').find(l => !l.attrs.rel || l.attrs.rel.value === 'alternate') : children(item, 'link')[0];
    const link = atom ? linkNode?.attrs.href?.value : linkNode?.text.trim();
    const id = value(item, atom ? 'id' : 'guid') || link;
    if (!id) { issues.push('ITEM_WITHOUT_STABLE_ID'); continue; }
    if (seen.has(id)) { issues.push('DUPLICATE_ITEM'); continue; }
    seen.add(id);
    const limitations = [];
    let canonicalUrl = feedURL;
    if (link) {
      try {
        const url = new URL(link, linkNode?.base || documentURL);
        if (url.protocol !== 'https:' || url.username || url.password || url.port ||
            !/^[a-z0-9.-]+$/.test(url.hostname) || !url.hostname.includes('.') ||
            /(^|\.)(localhost|local|internal)$/.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) throw new Error();
        url.hash = ''; canonicalUrl = url.href;
      } catch { limitations.push('INVALID_ITEM_LINK; feed URL retained'); }
    }
    const publishedAt = date(value(item, atom ? 'published' : 'pubDate'), limitations);
    const updatedAt = date(value(item, 'updated'), limitations);
    const title = value(item, 'title') || '';
    const content = value(item, atom ? 'content' : 'description') || value(item, 'summary') || '';
    const normalized = {id, title, content, publishedAt, updatedAt, canonicalUrl};
    entries.push({...normalized, identity: `${feedURL}#entry=${encodeURIComponent(id)}`,
      hash: hash(JSON.stringify(normalized)), limitations});
    if (entries.length >= maxResults) break;
  }
  const limitations = [...new Set(issues)];
  if (entries.length < candidates.length && entries.length >= maxResults) limitations.push('RESULT_LIMIT');
  const updatedAt = date(value(container, atom ? 'updated' : 'lastBuildDate'), limitations);
  return {entries, updatedAt, limitations, totalItems: candidates.length};
}
