# Recorded evidence comparison E3

Manual offline comparison, query history and a competing-evidence ledger, issue #8.
Node >=20 and the unchanged E2 dependencies. WATCH OFF. No scheduler or truth model.
E4's separate [WATCH](../watch/README.md) reuses these comparisons in schema v3.
The analysis CLI explicitly supports v3; library callers opt into supportedVersion=3.
The v1→v2 command remains unchanged and does not perform the separate v3 migration.
Decisions are explicitly attributed operator input, not authenticated OWNER approval.

## Start and migration

Install as in [memory](../memory/README.md). These commands use an explicit local
data root and default private scope; add `--scope public` only for public fixtures.
Keep the same scope on every operation. Reads never create a missing database.

```text
node tools/research-memory.mjs init --data-dir .research-engine/e3
node tools/research-memory.mjs import research/e0-node-sqlite --data-dir .research-engine/e3
node tools/research-memory.mjs ingest --source fixture --fixture tests/fixtures/harness.json --brief e0-node-sqlite --data-dir .research-engine/e3 --json
node tools/research-analysis.mjs migrate --backup .research-engine/pre-e3.sqlite --data-dir .research-engine/e3 --json
node tools/research-memory.mjs doctor --data-dir .research-engine/e3 --json
node tools/research-engine.mjs analysis --help
```

The backup path must be NEW, with an existing parent. Migration holds an immediate
writer lock, saves a consistent standalone v1 backup, applies and validates v2 in
one transaction. Failure rolls back; an already published v1 backup remains usable.
An existing v2 database makes migrate an idempotent no-op. Schema drift/future
versions are refused. Eight new tables and immutable-record triggers are added;
original v1 DDL/checksum, artifact bytes and Evidence v0 remain unchanged.

Rollback: restore the pre-E3 backup with `research-memory restore --from ...
--data-dir <NEW-root>` and use E2 code. E2 refuses schema v2. Restore does not
overwrite a database or downgrade in place. A v2 backup restores with the new CLI
and retains comparisons, query families, links and all review decisions.

## Compare actual recorded versions

Ingest JSON returns actual run/check/revision/source IDs. Use those IDs, never a
fabricated hash. `--source` is an optional stored source ID/identity for run selection.
Separate captures of the same source preserve retrieval dates even if the bytes
are identical. Replace the angle-bracket placeholders in these examples.

```text
node tools/research-analysis.mjs compare --kind check --from <first-check> --to <later-check> --brief e0-node-sqlite --save --data-dir .research-engine/e3 --json
node tools/research-analysis.mjs compare --kind run --from <first-run> --to <later-run> --source <stored-source-id> --save --data-dir .research-engine/e3 --json
node tools/research-analysis.mjs compare --id <saved-comparison-id> --data-dir .research-engine/e3 --json
```

Without `--save`, comparison/coverage is read-only. Library: `openAnalysis` from
`analysis/store.mjs`; `compare(left, right, {brief, save})`. References have kind
revision/check/run and actual 64-character `id`; run references may include `source`.
Claims use `{kind:"claim", id:<bundle-id>, claim:<claim-id>}`. `compare --input`
accepts `{left,right,brief?}` for mixed references or v0 claims.

SAME requires comparable source identity/type, bytes, hash and recorded revision.
CHANGED reports bytes/hash/version change, including a new pinned commit with the
same file bytes. Publication-date differences are separately listed; event time
is never inferred from retrieval or publication. Equal text across different
sources is INCONCLUSIVE with a possible syndication hint. GitHub exact files may
align across pinned commits only for the verified exact repository/path.

304 has no new bytes. E3 requires E2's historical baseline plus a recorded matching
ETag/Last-Modified; unknown/stale/missing validators are INCONCLUSIVE. RSS run 304
can inherit previously captured entry membership via the validated feed root.
Missing items in a bounded search are INCONCLUSIVE. Fetch failure is UNAVAILABLE,
retaining last-known pointers; no inference of deletion, retraction or falsehood.
Partial pagination, caps and different stored run requests prevent an overall
SAME/CHANGED claim, while per-item comparisons remain visible.

## Query families and coverage

`coverage --input file --save` accepts a JSON object:

```json
{
  "brief": "e0-node-sqlite",
  "family": "sqlite-behavior",
  "question": "Which captured source describes this behavior?",
  "variants": ["SQLite поведение", "SQLite behavior"],
  "language": "ru",
  "region": "unspecified",
  "dateWindow": {"from": null, "to": null},
  "plannedRoutes": [{"adapter": "web", "query": "SQLite behavior", "note": "Not executed; no configured provider."}],
  "runIds": [],
  "decisions": [],
  "negative": {"statement": "No conclusion from the bounded search", "verdict": "NOT_PROVEN"}
}
```

Populate runIds from actual ingest results. Decisions have actual source ID,
verdict CUT/SURVIVED/WATCH/OPEN and nonempty reason; source must belong to selected
runs or the brief's actual v0 claims. WATCH is a candidate label only. With no runs,
coverage is PLANNED_ONLY. No backend access is invented from a plan or label.

`coverage --brief <id>` derives current bounded acquisition history;
`coverage --id <id>` reloads an immutable saved family. Reports keep old family
snapshots as well as the current recorded route history. New E1 metadata records
actual pages/raw/inspected/filter/invalid/duplicate counts and configured caps.
Legacy counters are null/UNKNOWN, never reconstructed from HTTP request counts.
Fallback counters apply per attempt; top-level counters describe the final attempt.
Language/region/date labels are requests, with backend-applied filters UNKNOWN.
Failed credentials/rate limits/private scope, incomplete results and missing
observations remain gaps. Every negative conclusion is NOT_PROVEN; requesting
PROVEN is rejected even when a bounded route completed. Fixtures are synthetic.

## Manual links and review

`link --input file` requires left/right actual references, relation SUPPORTS,
DISPUTES, NOT_COMPARABLE or REQUIRES_REVIEW; subject `{id,label,context}`, actor
and rationale. Non-claim anchors additionally require leftStatement/rightStatement:
`{text,kind,value?,eventAt?,language?}`. Kinds are fact/author_claim/interpretation;
values may be a scalar. These are marked OPERATOR_ANNOTATION, with
textVerifiedAgainstSource=false. The tool verifies anchors, not statement truth.
Use run+source selectors only when exactly one captured item resolves per side.

For actual v0 claim anchors, omit the corresponding statement: text, kind, pointer
and original six-field object are copied from the real claim. Overrides are refused.
Optional commonOrigin `{locator,basis}` is an attributed shared-origin hint;
otherwise independence UNKNOWN. Equal text and same-source links do not establish
independent corroboration. Both sides and publisher/retrieval/annotated event dates
survive later decisions or unavailable fetches.

`review --input file` accepts `{link,decision,actor,rationale,key?}`. Decisions
OPEN/ACCEPTED/DISMISSED/WITHDRAWN append; they never overwrite the link. Optional
key is an idempotency key within the link; conflicting reuse is rejected. ACCEPTED
means manual ledger acceptance, not verified truth or an authenticated OWNER action.
`link --id`, `list --type links|coverage|comparisons --brief ... --limit N --offset N`
reload saved records. Query-family/link rationale and comparison reasons are also
searchable using the existing Unicode `memory find` command.

## Reports, limits and proof

```text
node tools/research-analysis.mjs report --brief e0-node-sqlite --out .research-engine/report-e3 --allow-private --data-dir .research-engine/e3 --json
node tools/comparison-proof.mjs
node tools/run-offline.mjs
```

Report creates Markdown and JSON in a NEW directory with .gitignore written before
content publication. Private exports require --allow-private. Output never includes
full source bodies; JSON retains actual references/digests/observations without
content. Markdown uses inert literals, not clickable source HTML or instructions.
Lists/reports default to 50/100 records; max100, explicit list offset, report --limit.
Each side/run comparison is capped at100 items (truncation is inconclusive); input
and canonical output JSON are capped at1MiB. Oversized outputs fail ANALYSIS_LIMIT;
use narrower stored-source comparisons or smaller pages rather than silently losing
data. Pretty JSON whitespace may add overhead. Existing row/logical disk quotas
also apply to E3 writes. A quota/constraint failure rolls back all new rows.

Immutable-record triggers and foreign keys protect ledger entries and their E2
sources/checks/revisions/runs/claims against purge. Audit history has no E3 delete
command; withdrawn decisions remain. SQLite is not encrypted or an authentication
boundary. Known secret rejection is not general PII detection. WAL/backups/reports
can use extra physical disk; network filesystems/power-loss durability are unproven.
Report publication is guarded against overwrite but is not a power-loss-atomic
multi-file transaction. Local filesystem access is trusted; source text is data.

Fresh-process proof uses only synthetic inputs and the public E0 fixture: actual
v1→v2 backup/migration, comparison dedup, competing values + original v0 claims,
review withdrawal, coverage, restart reads, v2 backup/restore and v1 rollback,
exact v0 export/validator/inspector. Every CLI is a new process with network denied.
CI uploads TAP and both E2/E3 JSON proofs for Windows/Linux × Node20/22/24 at the
exact PR HEAD. [Execution report](../docs/e3/REPORT.md) distinguishes dirty local
pre-commit evidence from final-head hosted CI. Independent reviewer reexecution
and OWNER/FRIDAY acceptance remain separate gates. No merge/deploy/E4/WATCH.
