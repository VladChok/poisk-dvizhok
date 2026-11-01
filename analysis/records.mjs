import {clean, fail, hash} from '../memory/safety.mjs';

export const MAX_JSON = 1048576;
export const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
};
export function encode(value) {
  clean(value); const json = JSON.stringify(stable(value));
  if (Buffer.byteLength(json) > MAX_JSON) fail('ANALYSIS_LIMIT');
  return json;
}
export const identity = value => hash(encode(value));
export function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) fail('INVALID_ANALYSIS_INPUT');
  clean(value); return value;
}
export function string(value, max = 4000, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('INVALID_ANALYSIS_INPUT');
  clean(value); return value;
}
export function reference(value) {
  fields(value, ['kind', 'id', 'claim', 'source'], ['kind', 'id']);
  if (!['revision', 'check', 'run', 'claim'].includes(value.kind) || !/^[a-f0-9]{64}$/.test(value.id) ||
      (value.kind === 'claim' ? typeof value.claim !== 'string' || !value.claim : value.claim !== undefined) ||
      (value.source !== undefined && (value.kind !== 'run' || typeof value.source !== 'string'))) fail('INVALID_REFERENCE');
  if (value.claim !== undefined) string(value.claim, 200);
  if (value.source !== undefined) string(value.source, 8192);
  return stable(value);
}
export function contentIdentity(source, observation) {
  if (source.adapter === 'github' && source.source_type === 'file') {
    const match = observation.canonicalUrl?.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([a-f0-9]{40})\/(.+)$/);
    let decoded; try { decoded = match ? decodeURIComponent(match[4]) : null; } catch { decoded = null; }
    if (match && decoded && observation.revision === match[3] && observation.identity === `github:${match[1].toLowerCase()}/${match[2].toLowerCase()}:${match[3]}:${decoded}`) {
      return `github-file:${match[1].toLowerCase()}/${match[2].toLowerCase()}:${match[4]}`;
    }
  }
  return `${source.adapter}:${source.source_type}:${source.identity}`;
}
export function item(db, revision, check = null, override = {}) {
  const sourceId = revision?.source_id || check?.source_id;
  const source = db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId);
  if (!source) fail('NOT_FOUND');
  const original = revision ? JSON.parse(revision.observation_json) : JSON.parse(check.observation_json);
  const checked = check ? JSON.parse(check.observation_json) : original;
  const {content, ...observation} = original;
  const retrievedAt = override.retrievedAt || check?.observed_at || revision.first_observed_at;
  const noValidator = check?.status === 'NOT_MODIFIED' && !checked.etag && !checked.lastModified;
  const typeMatches = source.source_type === original.sourceType && checked.sourceType === original.sourceType;
  const snapshot = {sourceId, identity: source.identity, adapter: source.adapter, sourceType: original.sourceType, recordedSourceType: source.source_type,
    contentIdentity: contentIdentity(source, original), revisionId: revision?.id || null, checkId: check?.id || null,
    pointer: {locator: original.canonicalUrl, version: original.revision || original.hash || (check ? `check:${check.id}` : `revision:${revision.id}`)},
    retrievedAt, publishedAt: original.publishedAt, updatedAt: original.updatedAt,
    eventAt: null, observation, checkObservation: check ? {...checked, content: undefined} : null,
    baselineStatus: check?.baseline_status || 'OBSERVED', comparisonBaseline: !typeMatches ? 'SOURCE_TYPE_MISMATCH' : noValidator ? 'NO_RECORDED_VALIDATOR' : check?.baseline_status || 'OBSERVED',
    availability: revision && !noValidator && typeMatches ? 'OBSERVED' : 'UNKNOWN',
    byteLength: typeof content === 'string' ? Buffer.byteLength(content) : null,
    contentDigest: typeof content === 'string' ? hash(content) : null,
    hash: revision?.sha256 || null, hasContent: typeof content === 'string', ...override};
  return snapshot;
}
const runOK = status => ['OK', 'NOT_MODIFIED', 'PARTIAL'].includes(status);
export function resolve(db, ref) {
  ref = reference(ref);
  let items = [], checks = [], claim = null, run = null, limitations = [];
  if (ref.kind === 'revision') {
    const row = db.prepare('SELECT * FROM revisions WHERE id=?').get(ref.id);
    if (!row) fail('NOT_FOUND'); items = [item(db, row)];
  } else if (ref.kind === 'check') {
    const row = db.prepare('SELECT * FROM checks WHERE id=?').get(ref.id);
    if (!row) fail('NOT_FOUND'); checks.push(row.id);
    items = [item(db, row.revision_id ? db.prepare('SELECT * FROM revisions WHERE id=?').get(row.revision_id) : null, row)];
  } else if (ref.kind === 'claim') {
    const row = db.prepare('SELECT * FROM claims WHERE bundle_id=? AND claim_id=?').get(ref.id, ref.claim);
    if (!row) fail('NOT_FOUND'); claim = JSON.parse(row.original_json);
    const source = db.prepare('SELECT * FROM sources WHERE id=?').get(row.source_id);
    items = [{sourceId: source.id, identity: source.identity, sourceType: source.source_type, adapter: source.adapter,
      contentIdentity: `claim:${ref.id}:${ref.claim}`, pointer: claim.pointer, claim,
      retrievedAt: db.prepare('SELECT imported_at FROM bundles WHERE id=?').get(ref.id).imported_at,
      publishedAt: null, updatedAt: null, eventAt: null, availability: 'CLAIM_RECORD', hasContent: false}];
  } else {
    run = db.prepare('SELECT * FROM runs WHERE id=?').get(ref.id);
    if (!run) fail('NOT_FOUND');
    const rows = db.prepare('SELECT * FROM checks WHERE run_id=? ORDER BY id LIMIT 202').all(ref.id);
    for (const row of rows) {
      checks.push(row.id);
      const revision = row.revision_id ? db.prepare('SELECT * FROM revisions WHERE id=?').get(row.revision_id) : null;
      const snapshot = item(db, revision, row);
      if (snapshot.sourceType === 'feed' && row.status === 'NOT_MODIFIED' && row.baseline_status === 'REUSED_LAST_GOOD' && snapshot.availability !== 'UNKNOWN') {
        const prior = db.prepare("SELECT run_id FROM checks WHERE source_id=? AND revision_id=? AND status='OBSERVED' AND observed_at<=? AND run_id IS NOT NULL ORDER BY observed_at DESC,rowid DESC LIMIT 1")
          .get(row.source_id, row.revision_id, row.observed_at);
        if (prior) for (const previous of db.prepare('SELECT * FROM checks WHERE run_id=? ORDER BY id LIMIT 202').all(prior.run_id)) {
          const old = item(db, previous.revision_id ? db.prepare('SELECT * FROM revisions WHERE id=?').get(previous.revision_id) : null, previous,
            {retrievedAt: row.observed_at, validatedBy: row.id, inheritedFromRun: prior.run_id});
          if (old.sourceType !== 'feed') { checks.push(previous.id); items.push(old); }
        }
      } else if (snapshot.sourceType !== 'feed') items.push(snapshot);
    }
    if (!runOK(run.status)) {
      // Preserve prior pointers as LAST KNOWN, never pretend failed fetch captured bytes.
      for (const source of db.prepare('SELECT s.* FROM sources s JOIN run_sources r ON r.source_id=s.id WHERE r.run_id=? ORDER BY s.id LIMIT 101').all(ref.id)) {
        const prior = db.prepare('SELECT * FROM checks WHERE source_id=? AND revision_id IS NOT NULL AND observed_at<=? ORDER BY observed_at DESC,rowid DESC LIMIT 1').get(source.id, run.at);
        const previous = prior ? item(db, db.prepare('SELECT * FROM revisions WHERE id=?').get(prior.revision_id), prior) : null;
        if (prior) checks.push(prior.id);
        items.push({sourceId: source.id, identity: source.identity, adapter: source.adapter, sourceType: source.source_type,
          contentIdentity: previous?.contentIdentity || `${source.adapter}:${source.source_type}:${source.identity}`,
          pointer: {locator: source.locator, version: `unavailable run:${run.id}`}, lastKnownPointer: previous?.pointer || null,
          retrievedAt: run.at, publishedAt: null, updatedAt: null, eventAt: null,
          availability: 'UNAVAILABLE', fetchStatus: run.status, hasContent: false});
      }
    }
    const metadata = JSON.parse(run.metadata_json);
    limitations.push(...(metadata.limitations || []));
    if (run.status === 'PARTIAL') limitations.push('PARTIAL_RUN');
    if (metadata.coverage?.complete === false && run.status !== 'NOT_MODIFIED') limitations.push('INCOMPLETE_RECORDED_ROUTE');
    run = {id: run.id, adapter: run.adapter, status: run.status, at: run.at, request: JSON.parse(run.request_json),
      counters: metadata.coverage || null, attempts: metadata.attempts || [], limitations};
  }
  if (ref.source) {
    if (!db.prepare('SELECT 1 FROM sources WHERE id=? OR identity=? OR locator=?').get(ref.source, ref.source, ref.source)) fail('NOT_FOUND');
    items = items.filter(i => [i.sourceId, i.identity, i.pointer?.locator, i.contentIdentity].includes(ref.source));
  }
  if (items.length > 100) { limitations.push('COMPARISON_LIMIT'); items = items.slice(0, 100); }
  return {ref, items, checks: [...new Set(checks)].sort(), claim, run, limitations: [...new Set(limitations)].sort()};
}

export function comparePair(left, right) {
  const result = {left: left || null, right: right || null, verdict: 'INCONCLUSIVE', reason: '',
    independence: 'UNKNOWN', factualContradiction: false, hints: [], changedFields: []};
  if (left?.availability === 'UNAVAILABLE' || right?.availability === 'UNAVAILABLE') return {...result, verdict: 'UNAVAILABLE', reason: 'RECORDED_FETCH_FAILURE; not deletion or falsehood'};
  if (!left || !right) return {...result, reason: 'MISSING_RECORDED_ITEM; bounded absence is not deletion'};
  if (left.claim || right.claim) return {...result, reason: 'CLAIM_MEANING_REQUIRES_EXPLICIT_MANUAL_LINK'};
  if (left.contentDigest && left.contentDigest === right.contentDigest && left.sourceId !== right.sourceId) result.hints.push('IDENTICAL_TEXT_POSSIBLE_SYNDICATION');
  if (left.contentIdentity !== right.contentIdentity || left.sourceType !== right.sourceType) return {...result, reason: 'DIFFERENT_SOURCE_IDENTITY_OR_TYPE'};
  if (!left.hasContent || !right.hasContent || !left.hash || !right.hash || left.availability === 'UNKNOWN' || right.availability === 'UNKNOWN') return {...result, reason: 'MISSING_CONTENT_HASH_OR_VALIDATED_BASELINE'};
  for (const field of ['hash', 'contentDigest', 'publishedAt', 'updatedAt']) if (left[field] !== right[field]) result.changedFields.push(field);
  const revisionChanged = left.observation?.revision !== right.observation?.revision;
  if (revisionChanged) result.changedFields.push('revision');
  const same = left.hash === right.hash && left.contentDigest === right.contentDigest && !revisionChanged;
  return {...result, verdict: same ? 'SAME' : 'CHANGED', reason: same ? 'SAME_RECORDED_BYTES_AND_VERSION; not truth' : 'CHANGED_BYTES_OR_VERSION; not factual contradiction'};
}

export function comparison(db, leftRef, rightRef) {
  const left = resolve(db, leftRef), right = resolve(db, rightRef);
  let pairs;
  if (left.ref.kind !== 'run' && right.ref.kind !== 'run') pairs = [comparePair(left.items[0], right.items[0])];
  else {
    const a = new Map(), b = new Map(), ambiguous = new Set();
    for (const [target, values] of [[a, left.items], [b, right.items]]) for (const value of values) {
      if (target.has(value.contentIdentity)) ambiguous.add(value.contentIdentity); else target.set(value.contentIdentity, value);
    }
    const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
    if (keys.length > 100) left.limitations.push('COMPARISON_LIMIT');
    pairs = keys.slice(0, 100).map(key => {
      const pair = comparePair(a.get(key), b.get(key));
      return ambiguous.has(key) ? {...pair, verdict: 'INCONCLUSIVE', reason: 'AMBIGUOUS_RECORDED_IDENTITY'} : pair;
    });
  }
  const limitations = [...new Set([...left.limitations, ...right.limitations])].sort();
  let verdict = !pairs.length ? 'INCONCLUSIVE' : pairs.every(p => p.verdict === 'SAME') ? 'SAME' :
    pairs.some(p => p.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : pairs.some(p => p.verdict === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'CHANGED';
  if (left.run && right.run && encode(left.run.request) !== encode(right.run.request)) limitations.push('DIFFERENT_RECORDED_ROUTES');
  if ([left.run, right.run].some(r => r && !runOK(r.status))) verdict = 'UNAVAILABLE';
  else if (limitations.some(l => /LIMIT|PARTIAL|INCOMPLETE|DIFFERENT_RECORDED/.test(l))) verdict = 'INCONCLUSIVE';
  const payload = {version: 1, method: 'recorded-representation-v1', scope: 'RECORDED_ITEMS_ONLY',
    left: {ref: left.ref, run: left.run}, right: {ref: right.ref, run: right.run}, verdict, pairs, limitations,
    absence: 'NOT_PROVEN', factualContradiction: false, independence: 'UNKNOWN'};
  const id = identity(payload); return {id, payload, resolved: [left, right]};
}
