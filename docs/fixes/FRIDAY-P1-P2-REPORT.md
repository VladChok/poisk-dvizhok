# FRIDAY P1/P2 remediation — ready for independent recheck, HOLD remains

Issue [#13](https://github.com/VladChok/poisk-dvizhok/issues/13), parent [#12](https://github.com/VladChok/poisk-dvizhok/issues/12).
Base E4: `8208567e1ae7b30e0ae0e02ea8ad0f7c86774a3c`, Draft PR#11,
`impl/research-engine-e4-20261031`. Fix branch:
`fix/friday-watch-p1-p2-20261031`; stacked PR must target that E4 branch.
The immutable submitted head is recorded in the PR validation report and in each
CI proof's `commit`; the verifier requires exact checked-out HEAD and a clean tree.
No previous PR/main ref is changed. WATCH OFF; no live source requests, installed
OS tasks, resident workers, merge or deploy. Test enable/due calls are finite and
operate only on disposable fixture databases behind the network-denying preload.

## Original reproduction and preserved red evidence

Read local `outputs/FRIDAY-REVIEW.md`, `outputs/FRIDAY-MERGE-PLAN.md` and the original
`outputs/friday-adversarial.test.mjs` on2026-10-31. These names are local provenance,
not remotely accessible report links. Private report contents are not republished.
Input hashes, observed time, runtime and exact red commands:
[RED-EXECUTION.json](RED-EXECUTION.json).

On untouched pinned E4 production code, the original130 tests passed. The exact
original three probes failed3/3: two false NOT_MODIFIED cases (same-origin path
and cross-origin), plus the same-timestamp due replay. Durable test-only commit
`ce619e6` precedes the production fix. [Original snapshot](FRIDAY-ORIGINAL-PROBES.mjs),
[original TAP](RED-ORIGINAL.tap), [original HTTP/state evidence](RED-ORIGINAL-EVIDENCE.json),
[regression TAP](RED-REGRESSIONS.tap), [regression evidence](RED-REGRESSION-EVIDENCE.json).
The original snapshot preserves fixtures/assertions; only import paths and an
opt-in portable evidence destination changed. Its diagnostic `notEqual(badCached,
control)` intentionally characterizes the defect. It cannot be a post-fix success
condition: the permanent test keeps the original acceptance assertion and requires
the repaired capture to **equal** the control, emit CHANGED and create a report.
No original130 test file/assertion was modified, deleted or skipped.

Red observed: A→B200 caches B's tag; A later has different bytes with the same
independently valid tag, receives B's condition and returns304; WATCH retains B,
reports NOT_MODIFIED and emits nothing. P2 fetches only once, repeatedly returns
the old completed result and leaves SQLite's due slot expired even two hours later.

## P1 root fix

`harness/network.mjs` binds conditions to an exact normalized request URI. Any
redirect strips both ETag and Last-Modified for all remaining hops. Existing
per-hop allowlist/DNS pinning, authentication isolation, byte/request/redirect/time
caps, pacing, cancellation and cooldowns remain enforced. Optional `validatorUrl`
prevents a caller from accidentally using a cursor for a different initial URI.
Transport returns bounded representation provenance, including conditions actually
sent on the final request. No headers are inferred from original caller intent.

`harness/engine.mjs` uses that provenance.304 requires an actual final-URI condition;
mismatched returned validators are rejected. Missing304 response ETag/date can only
be filled from conditions actually sent. Otherwise status is
UNVALIDATED_NOT_MODIFIED and there is no fabricated NOT_MODIFIED observation.

`memory/store.mjs` validates/stores the result sidecar and records the effective URI
on RSS root metadata, including empty feeds. Logical feed identity stays stable.
`watch/store.mjs` persists URI in existing `validators_json`; own revision/check,
membership, matching validator and exact final URI are all required for304 reuse.
Redirected RSS refreshes through the declared target unconditionally. Legacy cursors
without URI also refresh unconditionally on the next explicit run. Invalid304 keeps
last-good content/history, records unknown and clears only the unsafe cursor.

## P2 root fix

Use the existing immutable, persisted ENABLE audit-event ID as activation epoch.
Append order (`rowid`) distinguishes activations at the exact same timestamp;
history is retained, including backups/restores. No untracked random request key.
Scheduled key is derived from watch ID + activation ID + due slot. Selection reads
activation/slot in one query and claim rechecks both under BEGIN IMMEDIATE before
completed lookup. Lease fencing also checks activation on completion.
Successful observation and next_due advancement remain atomic. ENABLE while already
enabled is an audited no-op preserving epoch, lease and next_due. Manual keys and
idempotent local delivery remain unchanged; stale scheduled selection cannot borrow
a completed manual or previous-activation result. No arbitrary scheduled caller key
can replace the derived schedule key. No future slot is manufactured without a run.

## Storage compatibility and rollback

DDL, migration SQL/checksums and user_version remain unchanged at3. New fields are
optional sidecar/JSON data; existing v1→v2→v3 migrations retain their exact behavior.
Old v3 enabled state already contains ENABLE events, used without any mutation on
read. Legacy timestamp-only completed attempts remain intact. No eager DB upgrade,
source call or scheduling occurs on open/show/history/restore. Evidence v0 bytes
remain unchanged; original proofs validate exported artifacts byte-for-byte.

Backup/restore tests retain cursor URI, activation, old attempt keys, histories,
receipts and schema fingerprint. Prefer a pre-change SQLite backup for code rollback;
restore into a new directory and keep WATCH disabled. Running vulnerable E4 on the
new database would reintroduce P1/P2 despite DDL compatibility. Do not schedule a
restored enabled backup. No destructive in-place schema rollback is needed.

## Validation and reviewer commands

Local Windows/Node24: original130/130 before and after; all148/148 (18 new),0 fail,
0 skip/cancel; preserved FRIDAY regressions red0/3→green3/3. Individual artifacts:
[baseline](BASELINE-130.tap), [original130 green](GREEN-ORIGINAL-130.tap),
[FRIDAY green](GREEN-REGRESSIONS.tap), [green evidence](GREEN-REGRESSION-EVIDENCE.json),
[P1 nine tests](GREEN-P1.tap), [P2 six tests](GREEN-P2.tap).
[AFTER-P1.tap](AFTER-P1.tap) records the intermediate two P1 successes with P2 still red.
These captured logs precede the final commit; final exact-head results live in CI
artifacts and the PR report, avoiding a self-referential commit SHA in this file.

```text
node tools/run-offline.mjs --test-reporter=tap > offline-tests.tap
node tools/memory-proof.mjs > memory-proof.json
node tools/comparison-proof.mjs > comparison-proof.json
node tools/watch-proof.mjs > watch-proof.json
node tools/friday-fix-proof.mjs > friday-fix-proof.json
node tools/verify-runtime-proofs.mjs
```

Original fresh-process proofs: E2=19, E3=34, E4=35, all passing. New proof=24 fresh
processes: redirected→direct and direct→redirected changed sources, control hash
equality, equal-clock disable/enable, no duplicate completed-slot requests, persisted
epoch/schedule, SQLite backup/new-root restore and a single delivered report.
The final disposable watch is DISABLED. All process network APIs are denied.
CI runs the same suite and four proofs on Ubuntu +Windows2022 ×Node20/22/24,
asserting148 tests,19/34/35/24 process counts, exact SHA, clean tree, WATCH OFF,
no background worker/tasks. Artifact: `research-proofs-<os>-node-<version>`.

Additional regressions cover301/302/307/308, same-origin path/query, cross-origin,
multi-hop, direct304 missing/mismatched ETag and Last-Modified, unsolicited redirected
304, empty feeds, pinned GitHub file integrity, legacy cursors, equal-millisecond
cycles/restarts, stale activation/lease, competing connections, manual keys and
delivery receipts. Original security/clock/cancellation/429/multiprocess tests remain.

Changed production files are the four named modules above; supporting changes are
the two READMEs, three regression test files plus two helpers, offline workflow,
proof generator/verifier, ignore entry and this red/green evidence directory.

## Limits and next gate

CI/fixtures do not prove real-source availability or arbitrary power-loss/filesystem
behavior. Redirected feeds intentionally cost unconditional requests. Old unscoped
cursors require an explicit refresh. No live smoke was authorized or performed.
Prior E0–E4 limits and FRIDAY HOLD remain. Independent FRIDAY must rerun the original
and new probes on the submitted immutable SHA, inspect CI logs and issue a fresh
decision before OWNER separately considers any merge plan. Green CI grants no merge,
deployment, Windows task installation or live-monitoring authorization.
