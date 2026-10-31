import fs from 'node:fs';
import path from 'node:path';
import {openMemory} from '../memory/store.mjs';
import {clean, fail, safePath, temporary} from '../memory/safety.mjs';
import {comparison, resolve, reference, fields, string, encode, identity} from './records.mjs';

const LIMIT = 100;
const date = value => value === null || (typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)));
const page = (limit, offset) => { if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT || !Number.isInteger(offset) || offset < 0 || offset > 100000) fail('INVALID_QUERY'); };
const parse = row => row ? {...row, payload: JSON.parse(row.payload_json || row.specification_json)} : null;

export class ResearchAnalysis {
  constructor(memory) {
    if (memory.migrate().schema !== 2) fail('MIGRATION_REQUIRED');
    this.memory = memory; this.db = memory.db;
  }
  close() { this.memory.close(); }
  brief(id) { if (id && !this.db.prepare('SELECT 1 FROM briefs WHERE id=?').get(id)) fail('NOT_FOUND'); return id || null; }
  anchor(resolved) {
    const ref = reference(resolved.ref), id = identity(ref), first = resolved.items[0];
    this.db.prepare('INSERT OR IGNORE INTO analysis_anchors VALUES (?,?,?,?,?,?,?,?,?)').run(id, ref.kind,
      ref.kind === 'run' ? null : first?.sourceId || null,
      ref.kind === 'revision' ? ref.id : ref.kind === 'check' ? first?.revisionId || null : null,
      ref.kind === 'check' ? ref.id : null, ref.kind === 'run' ? ref.id : null,
      ref.kind === 'claim' ? ref.id : null, ref.claim || null, encode(ref));
    for (const check of resolved.checks) this.db.prepare('INSERT OR IGNORE INTO analysis_members VALUES (?,?)').run(id, check);
    return id;
  }
  compare(left, right, {brief = null, save = false} = {}) {
    brief = this.brief(brief);
    const computed = comparison(this.db, left, right);
    const id = identity([computed.id, brief]);
    if (save) return this.memory.transaction(() => {
      const anchors = computed.resolved.map(r => this.anchor(r));
      this.db.prepare('INSERT OR IGNORE INTO comparisons VALUES (?,?,?,?,?,?,?)').run(id, this.memory.now(), brief,
        ...anchors, computed.payload.verdict, encode(computed.payload));
      this.memory.document('comparison', id, `${computed.payload.verdict} ${computed.payload.pairs.map(p => p.reason).join('\n')}`, {brief});
      return {id, ...computed.payload, saved: true};
    });
    return {id, ...computed.payload, saved: false};
  }
  getComparison(id) {
    const row = parse(this.db.prepare('SELECT * FROM comparisons WHERE id=?').get(id));
    if (!row) fail('NOT_FOUND');
    return {id, createdAt: row.created_at, brief: row.brief_id, ...row.payload, saved: true};
  }
  list(kind, {brief, limit = 50, offset = 0} = {}) {
    page(limit, offset); this.brief(brief);
    const tables = {comparisons: 'comparisons', coverage: 'query_families', links: 'evidence_links'};
    const table = Object.hasOwn(tables, kind) ? tables[kind] : null;
    if (!table) fail('INVALID_QUERY');
    const rows = this.db.prepare(`SELECT * FROM ${table} ${brief ? 'WHERE brief_id=?' : ''} ORDER BY created_at,id LIMIT ? OFFSET ?`)
      .all(...(brief ? [brief] : []), limit, offset);
    const records = rows.map(row => ({id: row.id, createdAt: row.created_at, brief: row.brief_id, ...parse(row).payload}));
    encode(records); return records;
  }
  usedRun(id) {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id);
    if (!row) fail('NOT_FOUND');
    const metadata = JSON.parse(row.metadata_json), counters = metadata.coverage || null;
    const gaps = [...(metadata.limitations || []).filter(x => /LIMIT|INCOMPLETE|UNAVAILABLE|PARTIAL|NO_CREDENTIALS|INVALID/.test(x))];
    if (!['OK', 'NOT_MODIFIED'].includes(row.status)) gaps.push(row.status);
    if (!counters) gaps.push('LEGACY_COUNTERS_UNKNOWN');
    else if (!counters.complete && row.status !== 'NOT_MODIFIED') gaps.push('INCOMPLETE_RECORDED_ROUTE');
    const captured = this.db.prepare('SELECT count(*) n FROM checks WHERE run_id=?').get(id).n;
    if (!captured && !['NOT_MODIFIED'].includes(row.status)) gaps.push('NO_CAPTURED_OBSERVATIONS');
    const items = this.db.prepare("SELECT count(*) n FROM checks c JOIN sources s ON s.id=c.source_id WHERE c.run_id=? AND s.source_type<>'feed'").get(id).n;
    if (!items && row.status !== 'NOT_MODIFIED') gaps.push('NO_SOURCE_ITEMS_CAPTURED');
    if (row.status === 'NOT_MODIFIED') {
      const conditional = this.db.prepare("SELECT baseline_status,observation_json FROM checks WHERE run_id=? AND status='NOT_MODIFIED'").all(id);
      if (!conditional.length || conditional.some(c => { const o = JSON.parse(c.observation_json); return c.baseline_status !== 'REUSED_LAST_GOOD' || (!o.etag && !o.lastModified); })) gaps.push('UNVALIDATED_304_BASELINE');
    }
    const sourceRefs = this.db.prepare(`SELECT c.id checkId,c.source_id sourceId,c.revision_id revisionId,s.source_type sourceType,
      c.status,c.observed_at retrievedAt,c.baseline_status baselineStatus FROM checks c JOIN sources s ON s.id=c.source_id WHERE c.run_id=? ORDER BY c.id LIMIT 100`).all(id);
    if (captured > sourceRefs.length) gaps.push('SOURCE_REFERENCE_LIMIT');
    return {id, adapter: row.adapter, status: row.status, observedAt: row.at, request: JSON.parse(row.request_json),
      counters, metricProvenance: counters ? 'ADAPTER_RECORDED' : 'UNKNOWN; HTTP counts are not pagination counts',
      counterScope: metadata.attempts?.length ? 'FINAL_ATTEMPT_ONLY; inspect each recorded attempt separately' : 'SINGLE_RECORDED_ROUTE',
      httpRequests: metadata.requests ?? null, capturedChecks: captured, capturedSourceItems: items, sourceRefs,
      attempts: metadata.attempts || [], gaps: [...new Set(gaps)].sort(),
      backendAppliedLanguage: null, backendAppliedRegion: null, backendAppliedDateWindow: null,
      routeEvents: this.db.prepare('SELECT id,at,state,reason FROM route_events WHERE run_id=? ORDER BY at,id').all(id)};
  }
  coverage(input, {save = false} = {}) {
    fields(input, ['brief', 'family', 'question', 'variants', 'plannedRoutes', 'runIds', 'language', 'region', 'dateWindow', 'decisions', 'negative'], ['family', 'question', 'runIds']);
    const brief = this.brief(input.brief);
    string(input.family, 200); string(input.question);
    const variants = input.variants || [];
    if (!Array.isArray(variants) || variants.length > 50) fail('ANALYSIS_LIMIT');
    variants.forEach(v => string(v, 200));
    if (!Array.isArray(input.runIds) || input.runIds.length > LIMIT || input.runIds.some(id => !/^[a-f0-9]{64}$/.test(id))) fail('INVALID_ANALYSIS_INPUT');
    const runIds = [...new Set(input.runIds)].sort();
    const used = runIds.map(id => this.usedRun(id));
    if (brief && runIds.some(id => this.db.prepare('SELECT brief_id FROM runs WHERE id=?').get(id).brief_id !== brief)) fail('BRIEF_RUN_MISMATCH');
    const planned = input.plannedRoutes || [];
    if (!Array.isArray(planned) || planned.length > 50) fail('ANALYSIS_LIMIT');
    for (const route of planned) {
      fields(route, ['adapter', 'query', 'url', 'note'], ['adapter']);
      if (!['github', 'rss', 'fixture', 'web'].includes(route.adapter)) fail('INVALID_ANALYSIS_INPUT');
      for (const key of ['query', 'url', 'note']) if (route[key] !== undefined) string(route[key], key === 'url' ? 8192 : 1000);
    }
    if (input.language !== undefined) string(input.language, 64);
    if (input.region !== undefined) string(input.region, 128);
    if (input.dateWindow) {
      fields(input.dateWindow, ['from', 'to'], ['from', 'to']);
      if (!date(input.dateWindow.from) || !date(input.dateWindow.to) || (input.dateWindow.from && input.dateWindow.to && Date.parse(input.dateWindow.from) > Date.parse(input.dateWindow.to))) fail('INVALID_DATE');
    }
    const decisions = input.decisions || [];
    if (!Array.isArray(decisions) || decisions.length > LIMIT || new Set(decisions.map(d => d.source)).size !== decisions.length) fail('INVALID_ANALYSIS_INPUT');
    for (const decision of decisions) {
      fields(decision, ['source', 'verdict', 'reason'], ['source', 'verdict', 'reason']);
      if (!['CUT', 'SURVIVED', 'WATCH', 'OPEN'].includes(decision.verdict)) fail('INVALID_ANALYSIS_INPUT');
      string(decision.reason);
      const belongsRun = runIds.some(id => this.db.prepare('SELECT 1 FROM run_sources WHERE run_id=? AND source_id=?').get(id, decision.source));
      const belongsBrief = brief && this.db.prepare('SELECT 1 FROM claims c JOIN bundles b ON b.id=c.bundle_id WHERE b.brief_id=? AND c.source_id=?').get(brief, decision.source);
      if (!belongsRun && !belongsBrief) fail('DECISION_NOT_IN_SCOPE');
    }
    if (input.negative) {
      fields(input.negative, ['statement', 'verdict'], ['statement']); string(input.negative.statement);
      if (input.negative.verdict && input.negative.verdict !== 'NOT_PROVEN') fail('UNSUPPORTED_NEGATIVE_CLAIM');
    }
    const gaps = [...new Set(used.flatMap(r => r.gaps))].sort();
    const payload = {version: 1, family: input.family, question: input.question, brief, variants,
      requested: {language: input.language || null, region: input.region || null, dateWindow: input.dateWindow || null},
      plannedRoutes: planned.map(route => ({...route, access: 'PLANNED_ONLY'})), usedRoutes: used,
      decisions: [...decisions].sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
      assessment: !used.length ? 'PLANNED_ONLY' : gaps.length ? 'PARTIAL_OR_UNKNOWN' : 'BOUNDED_RECORDED_ROUTES',
      gaps, privateScope: this.memory.scope === 'private', independence: 'UNKNOWN',
      negative: {statement: input.negative?.statement || null, verdict: 'NOT_PROVEN', reason: 'Recorded searches do not prove comprehensive absence.'},
      limitations: ['Requested language/region/date labels are not backend-applied filters.', 'Fixtures are synthetic. Different outlets do not establish independence.'], watch: 'OFF'};
    const id = identity(payload);
    if (save) return this.memory.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO query_families VALUES (?,?,?,?,?)').run(id, this.memory.now(), brief, input.family, encode(payload));
      for (const run of runIds) this.db.prepare('INSERT OR IGNORE INTO coverage_runs VALUES (?,?)').run(id, run);
      for (const d of decisions) this.db.prepare('INSERT OR IGNORE INTO coverage_decisions VALUES (?,?,?,?)').run(id, d.source, d.verdict, d.reason);
      this.memory.document('coverage', id, `${input.family}\n${input.question}\n${variants.join('\n')}\n${gaps.join('\n')}`, {brief});
      return {id, ...payload, saved: true};
    });
    return {id, ...payload, saved: false};
  }
  getCoverage(id) {
    const row = parse(this.db.prepare('SELECT * FROM query_families WHERE id=?').get(id));
    if (!row) fail('NOT_FOUND'); return {id, ...row.payload, createdAt: row.created_at, saved: true};
  }
  coverageForBrief(brief) {
    this.brief(brief);
    const rows = this.db.prepare('SELECT id FROM runs WHERE brief_id=? ORDER BY at,id LIMIT 100').all(brief);
    const report = this.coverage({brief, family: 'recorded-run-history', question: 'Recorded acquisition routes for this brief', runIds: rows.map(r => r.id)});
    const count = this.db.prepare('SELECT count(*) n FROM runs WHERE brief_id=?').get(brief).n;
    if (count > rows.length) { report.gaps.push('HISTORY_LIMIT'); report.assessment = 'PARTIAL_OR_UNKNOWN'; }
    return {...report, totalRuns: count};
  }
  statement(resolved, supplied) {
    if (resolved.claim) {
      if (supplied !== undefined) fail('CANNOT_OVERRIDE_V0_CLAIM');
      return {text: resolved.claim.claim, kind: resolved.claim.kind, value: null, eventAt: null, source: 'FROZEN_V0_CLAIM', original: resolved.claim};
    }
    fields(supplied, ['text', 'kind', 'value', 'eventAt', 'language'], ['text', 'kind']);
    string(supplied.text); if (!['fact', 'author_claim', 'interpretation'].includes(supplied.kind)) fail('INVALID_STATEMENT_KIND');
    if (supplied.value !== undefined && supplied.value !== null && !['string', 'number', 'boolean'].includes(typeof supplied.value)) fail('INVALID_ANALYSIS_INPUT');
    if (typeof supplied.value === 'number' && !Number.isFinite(supplied.value)) fail('INVALID_ANALYSIS_INPUT');
    if (typeof supplied.value === 'string') string(supplied.value, 1000, true);
    if (supplied.eventAt !== undefined && !date(supplied.eventAt)) fail('INVALID_DATE');
    if (supplied.language !== undefined) string(supplied.language, 64);
    return {...supplied, value: supplied.value ?? null, eventAt: supplied.eventAt || null, source: 'OPERATOR_ANNOTATION', textVerifiedAgainstSource: false};
  }
  link(input) {
    fields(input, ['left', 'right', 'leftStatement', 'rightStatement', 'brief', 'relation', 'subject', 'rationale', 'actor', 'commonOrigin'], ['left', 'right', 'relation', 'subject', 'rationale', 'actor']);
    const brief = this.brief(input.brief), left = resolve(this.db, input.left), right = resolve(this.db, input.right);
    if (!left.items.length || !right.items.length || left.items.length !== 1 || right.items.length !== 1) fail('LINK_NEEDS_TWO_SINGLE_SOURCE_ANCHORS');
    if (!['SUPPORTS', 'DISPUTES', 'NOT_COMPARABLE', 'REQUIRES_REVIEW'].includes(input.relation)) fail('INVALID_RELATION');
    fields(input.subject, ['id', 'label', 'context'], ['id', 'label', 'context']);
    string(input.subject.id, 200); string(input.subject.label, 500); string(input.subject.context, 2000);
    string(input.actor, 128); string(input.rationale);
    if (input.commonOrigin) { fields(input.commonOrigin, ['locator', 'basis'], ['locator', 'basis']); string(input.commonOrigin.locator, 2000); string(input.commonOrigin.basis); }
    const leftStatement = this.statement(left, input.leftStatement), rightStatement = this.statement(right, input.rightStatement);
    const hints = [];
    if (left.items[0].sourceId === right.items[0].sourceId) hints.push('SAME_SOURCE_NOT_INDEPENDENT');
    if (left.items[0].contentDigest && left.items[0].contentDigest === right.items[0].contentDigest) hints.push('IDENTICAL_TEXT_POSSIBLE_SYNDICATION');
    const payload = {version: 1, manual: true, relation: input.relation, brief, subject: input.subject,
      left: {ref: left.ref, snapshot: left.items[0], statement: leftStatement}, right: {ref: right.ref, snapshot: right.items[0], statement: rightStatement},
      rationale: input.rationale, actor: input.actor, commonOrigin: input.commonOrigin || null,
      independence: input.commonOrigin ? 'SHARED_ORIGIN_MANUAL_HINT' : 'UNKNOWN', hints,
      engineVerifiedTruth: false, absence: 'NOT_PROVEN'};
    const id = identity(payload);
    return this.memory.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO evidence_links VALUES (?,?,?,?,?,?,?,?)').run(id, this.memory.now(), brief,
        this.anchor(left), this.anchor(right), input.relation, input.actor, encode(payload));
      this.memory.document('evidence-link', id, `${input.subject.label}\n${input.relation}\n${leftStatement.text}\n${rightStatement.text}\n${input.rationale}`, {brief});
      return {id, ...payload};
    });
  }
  review(link, {decision, actor, rationale, key} = {}) {
    if (!this.db.prepare('SELECT 1 FROM evidence_links WHERE id=?').get(link)) fail('NOT_FOUND');
    if (!['OPEN', 'ACCEPTED', 'DISMISSED', 'WITHDRAWN'].includes(decision)) fail('INVALID_REVIEW');
    string(actor, 128); string(rationale); if (key !== undefined) string(key, 200);
    const at = this.memory.now(), id = identity(key ? [link, key] : [link, decision, actor, rationale, at]);
    return this.memory.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM evidence_reviews WHERE id=?').get(id);
      if (prior && (prior.decision !== decision || prior.actor !== actor || prior.rationale !== rationale)) fail('IDEMPOTENCY_CONFLICT');
      this.db.prepare('INSERT OR IGNORE INTO evidence_reviews VALUES (?,?,?,?,?,?)').run(id, link, at, decision, actor, rationale);
      return {id, link, decision, actor, rationale, manual: true};
    });
  }
  getLink(id) {
    const row = parse(this.db.prepare('SELECT * FROM evidence_links WHERE id=?').get(id));
    if (!row) fail('NOT_FOUND');
    return {id, ...row.payload, createdAt: row.created_at,
      reviews: this.db.prepare('SELECT * FROM evidence_reviews WHERE link_id=? ORDER BY at,rowid').all(id)};
  }
  report(brief, {limit = 100} = {}) {
    this.brief(brief); page(limit, 0);
    return this.db.transaction(() => {
      const links = this.list('links', {brief, limit}).map(row => this.getLink(row.id));
      const counts = Object.fromEntries(['comparisons', 'query_families', 'evidence_links'].map(table =>
        [table, this.db.prepare(`SELECT count(*) n FROM ${table} WHERE brief_id=?`).get(brief).n]));
      const report = {version: 1, brief, scope: this.memory.scope, comparisons: this.list('comparisons', {brief, limit}),
        savedCoverage: this.list('coverage', {brief, limit}), currentRecordedCoverage: this.coverageForBrief(brief),
        links, counts, limitations: Object.values(counts).some(n => n > limit) ? ['REPORT_LIMIT'] : [],
        boundary: 'Representations and explicitly attributed manual assertions; no automatic truth or absence verification.', watch: 'OFF'};
      encode(report); return report;
    })();
  }
  exportReport(brief, destination, {allowPrivate = false, limit = 100} = {}) {
    if (this.memory.scope === 'private' && !allowPrivate) fail('PRIVATE_EXPORT_REQUIRED');
    const report = this.report(brief, {limit}), bytes = encode(report), output = safePath(destination);
    if (fs.existsSync(output)) fail('TARGET_EXISTS');
    if (!fs.statSync(path.dirname(output)).isDirectory()) fail('INVALID_PATH');
    const staged = temporary(output); fs.mkdirSync(staged, {mode: 0o700}); let claimed = false;
    try {
      fs.writeFileSync(path.join(staged, '.gitignore'), '*\n', {flag: 'wx', mode: 0o600});
      fs.writeFileSync(path.join(staged, 'report.json'), bytes + '\n', {flag: 'wx', mode: 0o600});
      fs.writeFileSync(path.join(staged, 'REPORT.md'), renderReport(report), {flag: 'wx', mode: 0o600});
      fs.mkdirSync(output, {mode: 0o700}); claimed = true;
      for (const file of ['.gitignore', 'report.json', 'REPORT.md']) fs.renameSync(path.join(staged, file), path.join(output, file));
      fs.rmdirSync(staged); return {brief, files: ['REPORT.md', 'report.json'], watch: 'OFF'};
    } catch (error) {
      fs.rmSync(staged, {recursive: true, force: true});
      if (claimed) fs.rmSync(output, {recursive: true, force: true});
      throw error;
    }
  }
}
const literal = value => {
  const text = String(value ?? 'UNKNOWN').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
  const length = Math.max(0, ...(text.match(/`+/g) || []).map(s => s.length)) + 1;
  const fence = '`'.repeat(length); return `${fence} ${text} ${fence}`;
};
export function renderReport(report) {
  clean(report);
  const lines = [`# Research comparison report: ${literal(report.brief)}`, '', report.boundary, '', 'WATCH OFF.', '', '## Coverage', '',
    `Recorded routes: ${report.currentRecordedCoverage.usedRoutes.length}. Absence: NOT_PROVEN.`,
    `Gaps: ${report.currentRecordedCoverage.gaps.map(literal).join(', ') || 'none recorded; bounded scope only'}`, '', '## Comparisons', ''];
  for (const coverage of [report.currentRecordedCoverage, ...report.savedCoverage]) {
    lines.push(`- Family ${literal(coverage.family)}: ${literal(coverage.question)}; variants ${coverage.variants.map(literal).join(', ')}`,
      `  - Requested labels only: ${literal(JSON.stringify(coverage.requested))}. Absence NOT_PROVEN.`);
    for (const plan of coverage.plannedRoutes) lines.push(`  - PLANNED_ONLY ${literal(JSON.stringify(plan))}`);
    for (const used of coverage.usedRoutes) lines.push(`  - ACTUALLY_RECORDED ${literal(used.id)} ${literal(used.adapter)} ${literal(used.status)} at ${literal(used.observedAt)}; request ${literal(JSON.stringify(used.request))}; counters ${literal(JSON.stringify(used.counters))}; gaps ${literal(used.gaps.join(', '))}`);
    for (const d of coverage.decisions) lines.push(`  - Source ${literal(d.source)}: ${literal(d.verdict)} because ${literal(d.reason)}. WATCH is a label; scheduler OFF.`);
  }
  for (const c of report.comparisons) {
    lines.push(`- ${literal(c.id)}: ${literal(c.verdict)}; ${literal(c.scope)}`);
    for (const pair of c.pairs) {
      lines.push(`  - ${literal(pair.reason)}; left ${literal(pair.left?.pointer?.locator)} @ ${literal(pair.left?.pointer?.version)}; right ${literal(pair.right?.pointer?.locator)} @ ${literal(pair.right?.pointer?.version)}`);
      for (const [side, item] of [['Left', pair.left], ['Right', pair.right]]) lines.push(`    - ${side} retrieved ${literal(item?.retrievedAt)}; published ${literal(item?.publishedAt)}; updated ${literal(item?.updatedAt)}; event time ${literal(item?.eventAt)}`);
    }
  }
  lines.push('', '## Manual competing-evidence ledger', '');
  for (const link of report.links) {
    lines.push(`- ${literal(link.id)}: ${literal(link.relation)}; subject ${literal(link.subject.id)} / ${literal(link.subject.context)}`,
      `  - Left (${literal(link.left.statement.kind)}): ${literal(link.left.statement.text)}; ${literal(link.left.snapshot.pointer.locator)} @ ${literal(link.left.snapshot.pointer.version)}`,
      `  - Right (${literal(link.right.statement.kind)}): ${literal(link.right.statement.text)}; ${literal(link.right.snapshot.pointer.locator)} @ ${literal(link.right.snapshot.pointer.version)}`,
      `  - Manual actor ${literal(link.actor)}: ${literal(link.rationale)}. Independence ${literal(link.independence)}.`);
    for (const side of [link.left, link.right]) lines.push(`  - Retrieved ${literal(side.snapshot.retrievedAt)}; published ${literal(side.snapshot.publishedAt)}; event time (operator annotation) ${literal(side.statement.eventAt)}`);
    for (const review of link.reviews) lines.push(`  - Review ${literal(review.at)}: ${literal(review.decision)} by ${literal(review.actor)}; ${literal(review.rationale)}`);
  }
  return lines.join('\n') + '\n';
}
export function openAnalysis(options = {}) {
  const memory = openMemory({...options, supportedVersion: 2});
  try { return new ResearchAnalysis(memory); } catch (error) { memory.close(); throw error; }
}
