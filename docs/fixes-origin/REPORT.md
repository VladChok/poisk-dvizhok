# Issue15: WATCH replay origin — implementation handoff

Base: `410e06190f350726c23273213f1ffea180060d21` (Draft#14).
Branch: `fix/watch-idempotency-origin-20261101`; new stacked Draft targets
`fix/friday-watch-p1-p2-20261031`. Date2026-11-01. Final immutable head/CI links
are recorded in the PR validation report and each runtime proof's `commit`.
Previous PRs/main unchanged. WATCH OFF; no merge/deploy/live monitor/OS task.

## Reproduction before production edits

Read local FRIDAY-FINAL-RECHECK-20261101.md and its reviewer-extra.test.mjs.
Only their hashes/provenance and sanitized technical evidence are published;
private report contents are not copied. [RED-EXECUTION.json](RED-EXECUTION.json)
records untouched base production code, baseline148/148 and exact failing probe.
Test-only commit `f820f9653661412adbf11dbe9955e1251fde30ac` precedes the fix.
[RED.tap](RED.tap), [RED-EVIDENCE.json](RED-EVIDENCE.json):1FAIL/1PASS. Future
slot collision after close/reopen replays schedule=null, makes only1HTTP request
and leaves next_due01:00 at clock03:00. The second original redirect/auth probe
passes. Fixtures and acceptance assertions were preserved; module imports and
opt-in evidence destination made portable. In the permanent hook, fixed-head
captures label the pinned starting SHA as `base`, not a fabricated current `head`.

## Structural correction

`watch/store.mjs` completedReplay reads candidates in descending append order,
then verifies immutable CHECK_START records inside claim's existing IMMEDIATE
transaction. Exactly one event must match watch+attempt+started_at. It must state
the requested boolean origin; the completed result must reference its own attempt
and run. Scheduled candidates additionally require exact activationId/dueAt in
both start and result. Manual candidates must not carry scheduled identity.
Result JSON is a consistency check, never the authority for origin. User-controlled
request_key spelling is never treated as provenance.

Thus a manual completion cannot satisfy due; a manual command cannot inherit a
scheduled result. Search continues past rows of the wrong domain to preserve an
older valid manual replay, even with the exact same due-v2 key. No prefix ban or
renaming workaround. Leases, eligibility, activation fencing, quotas, clock checks,
cooldowns, transactional scheduling and delivery receipts remain in force.

## Historical SQLite compatibility

No schema/DDL/checksum/version/dependency change: existing v3 immutable events
already suffice. Old manual CHECK_START payloads with scheduled=false but no epoch
fields remain usable, including reserved-looking keys. Old scheduled payloads
without epoch/slot cannot prove an exact scheduled replay. Missing or conflicting
starts, inconsistent output or unknown legacy origin are retained and bypassed;
an explicit run performs fresh acquisition subject to normal controls. New trusted
completion then provides idempotency. No history is rewritten, deleted or backfilled;
open/list/read/restore never fetch. Evidence v0 and previous schema1/2/3 remain.
Queries use built-in SQLite JSON validation/extraction; malformed payload cannot
be used as origin. Start-event lookup may scan history; no unreviewed DDL/index
change is introduced. Resource limits of the existing local SQLite store apply.

## Red → green and validation

[GREEN.tap](GREEN.tap), [GREEN-EVIDENCE.json](GREEN-EVIDENCE.json):2/2PASS.
[GREEN-ORIGIN.tap](GREEN-ORIGIN.tap):9/9PASS, covering reverse collision, legacy
manual/scheduled/ambiguous records, forged mutable result metadata, conflicting
events, wrong epoch/slot, concurrent due workers, replay behind other-domain rows,
receipt dedup and backup/new-root restore. Earlier148 tests are unchanged; total159.
Captured red/green logs precede final commit; authoritative exact-head clean runs
are in PR/CI artifacts, avoiding a self-referential SHA in this tracked report.

```text
node tools/run-offline.mjs --test-reporter=tap > offline-tests.tap
node tools/memory-proof.mjs > memory-proof.json
node tools/comparison-proof.mjs > comparison-proof.json
node tools/watch-proof.mjs > watch-proof.json
node tools/friday-fix-proof.mjs > friday-fix-proof.json
node tools/watch-origin-proof.mjs > watch-origin-proof.json
node tools/verify-runtime-proofs.mjs
```

Original proofs retain19/34/35/24 counts; new origin proof uses18fresh CLI processes
with real migrations, both collision directions, manual replay,4distinct stored
acquisitions, report receipts, v3 backup/new-root restore and final disabled watch.
All fixture transport, Node network APIs denied. Six CI cells Windows2022/Ubuntu
×Node20/22/24 check exact head, clean tree,159tests and all five proof counts.

## Review gate and rollback

Handoff is for a different independent reviewer, not self-acceptance. Reproduce
the preserved collision against base and the fixed head; review CHECK_START as
authority, reverse/legacy/ambiguity cases, CI logs, no-history-edit invariants and
backup/restore. Previous FRIDAY HOLD remains until explicitly superseded.
Rollback code alone restores the vulnerable shared lookup despite DDL compatibility;
prefer a pre-change backup restored to a new root, keep desired watches disabled
and review state before any explicit operation. No OS task exists to uninstall.
Offline tests do not establish live-source availability, hardware power-loss or
network-filesystem durability. No live smoke or resident monitoring was run.
