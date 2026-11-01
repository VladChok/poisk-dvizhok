# E4 local WATCH — issue #10 implementation handoff

Separate `impl/research-engine-e4-20261031` branch from verified E3
`a407d9f355e54898af5c003cdf2de7bff8f58ee2`, targeting the still-open E3 Draft PR9.
Final submitted SHA, actual hosted CI jobs/artifacts and changed-path list are
recorded in the E4 Draft PR description. Committed local execution is explicitly
pre-commit/dirty evidence; it is not final-head CI. WATCH OFF. STOP for OWNER/FRIDAY.

## Start and upstream review

Fetched/pruned and inspected actual refs, clean checkout, no local-only work:
main31448c9c82b6c2a96dcfed160488148f63da3dea;
docs PR1 e02ba42bd2e6dab4e6e4514fcdef16c7feb630e1;
E0 PR3 e9ef2b87cdb62ec8fa00d5774cd78a91b215915f;
E1 PR5 138f717685f489b9c02f9542e4b007c91df900b0;
E2 PR7 807c14870bfb1ce098ef0295e3f817ba6d02a39d;
E3 PR9 a407d9f355e54898af5c003cdf2de7bff8f58ee2.
No blind reset/rebase/stash, existing PR overwrite or other-repository write.

Read [independent E3 review](https://github.com/VladChok/poisk-dvizhok/pull/9#pullrequestreview-5721958650):
source/hosted CI PASS, independent local CLI rerun NOT RUN, OWNER/FRIDAY pending.
E0 second-reviewer CLI HOLD and E1/E2 rerun gates stay open. Review explicitly
permits separate E4 development, not automatic production/merge acceptance.

Read frozen v0 contract/schemas, staged task/architecture, E1 adapters/options,
E2 store/backup/schema and E3 comparison/migration/tests. Wrote ADR before code.
Baseline Windows x64 Node v24.19.0:107/107 exit0, E2 proof19 processes exit0,
E3 proof34 processes exit0; clean E3-head metadata in [baseline logs](BASELINE-107.tap),
[E2 baseline](BASELINE-MEMORY.json), [E3 baseline](BASELINE-COMPARISON.json).
Used the existing installed pinned native driver; no new package/lockfile/runtime
change. Native clean installation is repeated in hosted CI, not falsely attributed
to this local baseline. Windows Node20 retains VS2022/Python3.12 source-build path.

## Working implementation

- Same E1 public GitHub/RSS acquisition, E2 SQLite history and E3 comparisons/
  coverage. No parallel acquisition/database/truth system. GitHub search now
  captures deterministic per-item repository metadata bytes for E3 comparison;
  optional pinned-audit explicitly does not follow moving commits/branches.
- Schema v3 with10 WATCH tables, actual explicit v2→v3 backup/migration, writer
  lock, checksum/fingerprint/integrity validation, rollback/future/drift refusal.
  Original v1/v2 DDL/checksums/migration are byte-identical. E3 reviews and exact
  Evidence v0 bytes survive v3 and restored v2. Default initialization stays v1;
  old API version defaults remain, new CLIs explicitly support v3. No read migrates.
- Named immutable/fingerprinted definitions, default DISABLED, explicit enable/
  disable/archive, UTC next due, timezone display, scope/output/policy, per-run
  leases/fencing, append-only events/members/deltas and separately persisted receipts.
- Manual disabled run-once, list/show/history/report and explicit finite due-once
  control plane. Serial concurrency1, max10 watches/global50 reserved requests,
  per-target E1 limits, missed windows coalesced, deterministic capped backoff/jitter.
  Provider Retry-After/reset cooldowns persist by origin, across watches/restarts,
  including explicit manual checks. Enable starts no process or OS task.
- NEW/CHANGED/SAME/NOT_MODIFIED/REMOVED_OR_UNAVAILABLE/STILL_UNKNOWN scoped
  representation outcomes, old/new actual source pointers/checks/revisions and
  distinct publisher/retrieval dates. Fully enumerated RSS response omissions are
  cautious candidates; bounded GitHub omission is unknown. No deletion, event
  truth, independent corroboration or comprehensive absence is proven.
- 304 checks validators actually sent against this watch's own complete root and
  captured member check IDs. Missing/stale/out-of-order/foreign partial baselines
  are unknown. Empty response does not resurrect older membership. Positive partial
  captures can be retained but invalidate stale conditional roots; failures keep
  good content. No new source bytes or fake entry checks invented from304.
- SQLite atomic acquisition/comparison/coverage/cursor/delta/pending report commit;
  semantic signatures dedup repeat outcomes/retries. Local inert Markdown+JSON,
  explicit private export, bounded payloads, ignore guard before staged content,
  no-clobber manifest ownership, resumable partial publication/receipt recovery.
  No external notification or Evidence v0 promotion.

## Measured offline verification

[EXECUTION.json](EXECUTION.json) records exact commands/exits/stderr and provenance.
[Full Windows TAP](OFFLINE-WINDOWS.tap): **130/130 PASS**,107 existing expectations
unchanged +23 E4 tests, exit0, zero skips/todo/failures. Node v24.19.0, win32/x64,
better-sqlite3 12.11.1, SQLite3.53.2. Test wrapper denies network APIs in parent
and inherited subprocesses. No live smoke or recurring source check executed.

[Memory proof](MEMORY-WINDOWS.json):19 fresh processes; [comparison proof](COMPARISON-WINDOWS.json):34;
[WATCH proof](WATCH-WINDOWS.json):35. All exit0. WATCH proof uses actual E1 RSS
parser/304 via explicit JSON HTTP fixtures, not a substitute watcher/HTTP backend.
It demonstrates migrations1→2→3, preserved E3 withdrawn review, default disabled,
NEW/CHANGED/SAME/304, idempotent key, finite due+disable, report/receipt dedup, v3
backup/new-root restore, v2 rollback and exact v0 export with original validators/
inspector. Fixture definitions are removed/disabled and temp roots cleaned.

Tests additionally exercise two simultaneous worker processes, forced process kill,
lease expiry/ABANDONED recovery/stale-commit fencing/disable, crash after DB commit
and after files-before-receipt, owned partial repair vs unrelated-directory refusal,
symlinks/secrets/private export, quota rollback, 401/403/404/429/503/real timeout,
in-flight cancellation, private DNS/redirect refusal, provider cooldown restart,
duplicate/capped RSS, conflicting dates/backwards clock, DST/missed windows and
no implicit initialization/network/task registration. Existing E2 concurrent write/
corruption and E3 negative-claim/identity tests remain unchanged and passing.

Hosted matrix checks out actual PR HEAD and performs clean native installation,
130 tests plus all three proofs, clean-SHA/runtime verification and four-file
artifact upload on Windows2022/Ubuntu × Node20/22/24. Actual CI conclusions and
links belong in the final PR description; a configured matrix alone is not PASS.
Windows10/11 setup is documented, not an independently executed OS matrix.

## Delivery guarantees, limits and OFF state

Acquisition is at-least-once after crash, not exactly-once network access. Expired
workers may have issued requests; fencing prevents an obsolete owner from committing.
Disable cannot retract an already-sent request. All attempts/cursors remain durable;
completed idempotency keys do not fetch again. No resident background loop exists.

Local report delivery is at-least-once with deterministic content/manifest and one
receipt per delivery. Crash after commit/before receipt safely verifies or resumes
owned identical bytes. Crash before the ownership manifest is durable can leave
a guarded unknown directory requiring explicit operator cleanup; never auto-adopt
or delete unrelated files. Real hardware power-loss/network-filesystem atomicity
and external exactly-once delivery are not proven. No external delivery exists.

Default private partition, no encryption/general PII detection/authenticated actor
identity. Known secrets rejected, not rewritten into evidence. Reports omit full
source bodies. Canonical JSON cap1MiB, bounded E1/E3 items, list/history max100,
global row/logical disk quotas and maxPending. historyDays is view retention, not
automatic evidence deletion; long-lived stores may need operator archival/backup
before quota exhaustion. WAL/backups/reports add physical usage. No moving branch
tracking, web provider, crawler or verified article/semantic truth classifier.

Runtime private/public data lives under explicit --data-dir or existing E2 per-user
defaults; reports default beside that DB. Only reproducible fixture/public logs
are committed. Static diff check confirms frozen schemas/observation schema/v0 CLI,
v1/v2 migration and107 old tests unchanged. No tracked DB/WAL/private export.
WATCH source/CLI contains no OS registration, process-spawning or timer loop.
Tests spawn only bounded fixture workers; no source monitor is launched.

Rollback: restore pre-E4 v2 backup into NEW root and use E3. Disable/remove are
explicit controls; remove archives, never purges. Uninstall leaves research/backups
intact; no service/task needs unregistering. See [operator guide](../../watch/README.md)
and [ADR](../ADR-E4-WATCH.md). No merge/deploy/task installation/notifications or
live monitoring. WATCH OFF. Stop for FRIDAY/OWNER review; older gates remain open.
