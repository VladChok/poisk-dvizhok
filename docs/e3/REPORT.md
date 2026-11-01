# E3 implementation handoff — issue #8

Separate branch `impl/research-engine-e3-20261031`, stacked on verified E2
`807c14870bfb1ce098ef0295e3f817ba6d02a39d`. Final submitted head SHA, hosted CI
run/jobs and artifact links are recorded in the E3 Draft PR description. Committed
local logs explicitly identify the pre-commit working tree; they are not claimed
as final-head CI. STOP for OWNER/FRIDAY review. WATCH OFF.

## Repository synchronization and baseline

Fetched/pruned origin before creating the branch and rechecked before publication.
Main `31448c9c82b6c2a96dcfed160488148f63da3dea`; docs PR1 ref
`e02ba42bd2e6dab4e6e4514fcdef16c7feb630e1`; E0 PR3
`e9ef2b87cdb62ec8fa00d5774cd78a91b215915f`; E1 PR5
`138f717685f489b9c02f9542e4b007c91df900b0`; E2 PR7
`807c14870bfb1ce098ef0295e3f817ba6d02a39d`. Local E2 checkout was clean, with
no local-only/remote-only commits before branching. Upstream refs remained unchanged
at publication. No reset/rebase, other-repository edits, merge or deploy.

Read E2 [independent review](https://github.com/VladChok/poisk-dvizhok/pull/7#pullrequestreview-5721824621):
source/CI/published durability evidence PASS; independent CLI reexecution NOT RUN;
OWNER/FRIDAY acceptance pending. E0 reviewer CLI HOLD and E1 independent runtime
NOT RUN remain open. This implementation does not close those gates.

Baseline: Windows x64 Node v24.19.0; `npm.cmd ci --ignore-scripts --no-audit --no-fund`
and `npm.cmd rebuild better-sqlite3 --ignore-scripts=false`, exit0. All **86** E0–E2
tests passed before edits. Frozen contract/schemas/CLI, observation schema,
memory architecture/ADR/report/CLI and all previous tests were read; E3 ADR was
drafted before implementation. No dependency/runtime bump or lockfile change.

## Implemented behavior

- Offline revision/check/run comparison: SAME, CHANGED, UNAVAILABLE, INCONCLUSIVE;
  anchored IDs/pointers/versions, retrieved vs publisher dates, field differences,
  method version and bounded coverage. New pinned version with identical bytes
  is still CHANGED_VERSION. No byte diff is called a factual contradiction.
- Validated historical 304 only; missing/stale validators and future baselines
  remain inconclusive. RSS 304 reuses actual captured entry membership. Failed
  routes retain last-known pointers; a missing search candidate is not deletion.
- Immutable query families/variants/plans, actual E2 route histories, real adapter
  counters and fallback attempts; legacy counters unknown. Requested labels are
  not backend-applied filters. Source CUT/SURVIVED/WATCH/OPEN reasons remain manual.
  No search-derived absence is marked PROVEN, including completed bounded routes.
- Manual SUPPORTS/DISPUTES/NOT_COMPARABLE/REQUIRES_REVIEW ledger with actual source
  anchors, typed statements, scalar values/annotated dates, subject context,
  actor/rationale and common-origin hints. Independence defaults UNKNOWN; equal
  syndicated text does not corroborate. Actual v0 claims cannot be overwritten.
- Append-only OPEN/ACCEPTED/DISMISSED/WITHDRAWN review events, dedup/restart reads,
  searchable E3 rationale, inert Markdown and structured JSON reports. Retain
  original/withdrawn records; decisions do not authenticate OWNER or verify truth.
- Real explicit v1→v2 migration with writer lock, pre-migration standalone backup,
  transactional schema/checksum/integrity verification, rollback on failure,
  idempotency, future/drift refusal. Eight new tables with immutable-record triggers
  and provenance FKs; referenced E2 data cannot silently be purged.

## Verification and logs

Recorded Windows execution: [EXECUTION.json](EXECUTION.json), complete
[offline TAP stdout](OFFLINE-WINDOWS.tap), [E2 proof](MEMORY-WINDOWS.json),
[E3 proof](COMPARISON-WINDOWS.json). Three commands exit0, stderr empty.
**107/107** tests: 86 unchanged original tests +21 E3 tests; no skips/todo/failures.
better-sqlite3 12.11.1, SQLite 3.53.2, FTS5. E2 proof has19 separate CLI processes;
E3 proof has34 fresh CLI processes (including an expected MIGRATION_REQUIRED exit1
before migration), no network, real backup/restore and exact v0 artifact hashes.

Tests include invalid/missing/stale 304 validators, out-of-order records, changed
and translated bytes, same hash/new retrieval date, different names/types/identities,
syndication, contradictory publisher/annotated event dates, HTTP403/404/429/timeout,
partial/capped pagination and fallback counters, unsupported absence proof, malicious
refs/SQL/markup/secrets, private export and size/row quotas, append-only withdrawal,
busy migration/failure rollback/future schema/drift, concurrent E2 writers,
Unicode/Cyrillic search, new-root v1/v2 restore and exact exported v0 bytes.

Hosted workflow checks out the actual PR head, installs/rebuilds the native driver,
runs all107 tests plus both fresh-process proofs on **ubuntu-latest + windows-2022
× Node20/22/24**, and uploads full TAP + both JSON proofs in each job. See final
PR CI results before asserting matrix PASS. Windows Node20 retains VS2022/Python3.12
source-build path. `tools/verify-runtime-proofs.mjs` additionally verifies the TAP
count and clean exact-head SHA in both proofs and prints the runtime summary into
each job log. Windows Node20 retains VS2022/Python3.12
source-build path; arbitrary stock Windows/Node20 native setup is not implied.

## Compatibility, rollback and limits

Original `memory/schema.mjs` v1 DDL/checksum, frozen `schema/*`, Evidence v0 bundle,
`research-map.mjs` and all86 prior tests are unchanged. New E1 coverage metadata
is optional and separate from observation/Evidence schemas. E2 init still creates
v1; memory CLI supports v1/v2 without automatic upgrade. Legacy openMemory callers
default to v1 and intentionally refuse v2; new callers opt into supportedVersion2.
`memory migrate` stays validation-only; use explicit `analysis migrate --backup`.

Rollback restores the v1 migration backup into a NEW data root and uses E2 code.
No in-place downgrade or deletion of E3 history. A v2 backup restores all E3 state
with the E3 CLI. Reports use guarded new directories/private opt-in and canonical
JSON caps at1MiB; lists/results/source references max100, explicit pagination or
narrower scope required for larger data. Full bodies remain in E2, not copied into
reports. Truncation is explicit/inconclusive; oversize output fails safely.

Counters and saved E1 results are stored operator/adapter records, not authenticated
third-party attestations. Public/private partition is not encryption or generic PII
detection; local filesystem access is trusted. WAL/backups/reports use extra physical
space. Power-loss/multi-file publication and network filesystem durability are not
proven. Manual annotations may be wrong; no LLM/classifier, inference of absence,
source deletion, event truth or independent corroboration. No E4, scheduling,
notifications, private-account ingestion, live monitoring or WATCH activation.

## Changed files

Analysis: `analysis/{records,store}.mjs`, `analysis/README.md`.
Schema: new `memory/{schema-v2,migrate}.mjs`; existing `memory/store.mjs` and README.
CLI/proof: new `tools/{research-analysis,comparison-proof,verify-runtime-proofs}.mjs`; delegation in
`tools/research-engine.mjs`; explicit v2 support in `tools/research-memory.mjs`.
Coverage instrumentation: `harness/{engine,feed}.mjs`. Tests: new
`tests/analysis.test.mjs`; no edits to previous test files. CI/ignore:
`.github/workflows/offline.yml`, `.gitignore`. Documentation: `README.md`,
`docs/ADR-ENGINE-E0-E4.md`, new `docs/ADR-E3-COMPARISON.md` and this `docs/e3/`
report/execution/TAP/two proof files. No other paths changed.

Operator commands/examples: [analysis/README.md](../../analysis/README.md).
Design/migration boundary: [E3 ADR](../ADR-E3-COMPARISON.md).
