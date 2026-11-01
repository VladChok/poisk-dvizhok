# E4 local WATCH decision (before implementation)

2026-10-31, issue #10. Branch from inspected E3
a407d9f355e54898af5c003cdf2de7bff8f58ee2; origin main/docs/E0–E3 unchanged,
clean checkout, no local-only commits. Windows Node v24.19.0 baseline107 tests,
E2 19-process and E3 34-process proofs all exit0. Existing native dependency and
VS2022/Python3.12 Windows Node20 build retained. No dependency/schema-v0 change.
E3 independent source/hosted CI review PASS; independent local rerun and OWNER
acceptance pending. Older gates remain separate. WATCH OFF at delivery.

## Integration and identity

Use E1 createHarness only, E2 storeRun/observations/backup/quotas, E3 resolve,
compare and saved coverage. No parallel HTTP, database or semantic truth system.
Watch identity is scope+name; immutable definition fingerprint includes exact
target, normalized E1 config/allowlists/caps, interval, display timezone, output
root and policy. Changes require a new named watch; archive retains original.
RSS must be an explicitly configured HTTPS feed. GitHub plain public search
tracks captured repository metadata (not exhaustive results or repository files).
E1 will retain deterministic per-repository metadata bytes so E3 can compare the
actual item, rather than comparing an unrelated whole search-page hash.
Optional pinned-audit uses E1 pinned SHA retrieval and explicitly does not pretend
an immutable commit changes. No moving branches, general web scraper or private
account monitoring. Web returns NO_PROVIDER/NO_CREDENTIALS without acquisition.
Fixture transport is explicit, JSON-only, no network fallback or executed text.

## Schema v3 and rollback

Keep v1/v2 DDL/checksums and v1→v2 migration byte-identical. Add separate explicit
v2→v3 migration: immediate writer lock, consistent v2 backup, transactional DDL/
checksum/fingerprint/integrity validation, rollback on failure. No automatic
migration on reads; v1 requires reviewed v1→v2 first. Legacy APIs keep their
supported-version defaults; new CLIs explicitly opt into v3. Backups/restore
validate all three versions. Rollback restores v2 backup into NEW root + E3 code.
Watch definitions/events/members/deltas/receipts are immutable; run attempts are
explicitly finalized/abandoned, operational state/cursors mutable. Preserve all
E3 links/reviews and exact original-byte v0 artifacts. FKs protect provenance.
No migration, init, doctor, install or import schedules work.

## State and time

Add creates DISABLED. Explicit enable sets desired ENABLED and next_due_at UTC,
without starting anything. Manual run-once works while disabled. Disable/remove
cancel the active lease/fence and prevent subsequent scheduled work; remove is
archival, never deletion. Already-issued network requests cannot be retracted.
Timezones use Intl validation/display only. Fixed intervals use UTC milliseconds;
DST never changes elapsed intervals. Missed windows coalesce to one bounded check,
next due from completion (no catch-up storm). Backwards clock fails/records skew
without fetching or advancing content; invalid/out-of-order source dates remain
unknown. No source publication date is promoted into event/retrieval time.

Scheduler is an explicit finite `due --once`, serial concurrency1, max10 watches
and global request budget, no daemon/timer/autostart. A user may later separately
authorize an external OS schedule; this implementation registers none. Per-target
E1 limits/timeouts and deterministic capped retry/backoff+jitter remain enforced.
Leases are SQLite immediate transactions with unique fencing tokens; duration
exceeds the configured E1 worst-case request budget. Expired workers may have
issued requests, but cannot commit after another worker owns the lease. Recovery
marks abandoned attempts; an idempotency key returns a completed attempt without
another fetch. Disable fences in-flight commits. Cancellation keeps baselines.

## Deltas and reporting

NEW/CHANGED describe identified captured representations, never factual truth.
E3 handles comparisons and pins both source/check/revision pointers. Missing or
ambiguous bytes/identity/validators/source dates => STILL_UNKNOWN. Partial search
may retain validated positive captures, but omissions remain UNKNOWN. RSS omissions
from a comparable fully enumerated feed RESPONSE may be REMOVED_OR_UNAVAILABLE
candidates, explicitly NOT confirmed deletion or publisher-wide absence. GitHub
search omission is always bounded/unknown. Failed route retains last-known content.

304 requires validators actually sent for this watch and matching its own validated
root baseline. E1 records request validators when a 304 omits response validators;
WATCH also checks correspondence. RSS cached membership comes from this watch's
own last-good complete capture, not a newer unrelated partial run of the same feed.
No new bytes or fake entry checks are invented for 304. SAME/NOT_MODIFIED remain in
attempt history and produce no duplicate change report. Ambiguous/failed checks do
not replace validated content. Original captures and unavailable records persist.

Commit acquisition, E3 comparison/coverage, cursor, semantic event IDs and pending
delivery in one SQLite transaction. Meaningful outcome signatures exclude retrieval
time/check IDs, dedup identical retries, and distinguish later recurrent transitions.
Acquisition is at-least-once after crash; committed cursor/events are fenced and
idempotent. Local delivery is at-least-once with a deterministic report directory,
content/manifest verification and receipt recovery; no exactly-once external claim.
Crash after commit/before receipt can re-publish/verify identical bytes, not overwrite
an unrelated destination. Owned partial publication can resume; a crash before an
ownership manifest is durable may need explicit operator cleanup. No deletion of
unknown directories. Reports are bounded inert Markdown+JSON without source bodies.

Private partition default, explicit private-file publication consent, guarded
local paths/.gitignore/no-clobber staging, known-secret checks; no encryption or
generic PII detection. Report output is explicit (--write); pending payload stays
in SQLite until then. Retention policy bounds default history views, never silently
purges evidence; pending-report/row/logical-disk quotas stop growth. WAL/backups/
reports add physical disk. No cloud delivery/notifications. All tests offline with
fake clocks and E1 HTTP fixtures; no live smoke/recurring monitor authorized here.

## Proof

Preserve107 tests, add migration/future/rollback, default-OFF, RSS and GitHub actual
adapter checks, 304/cross-watch baseline, positive/omitted/partial/error states,
clock/DST/backoff/cancellation, multi-process leases/crash/fencing, report recovery/
dedup/no-clobber/private/secret/SSRF and exact v0 + E3 reviews roundtrip tests.
Fresh-process WATCH proof plus unchanged E2/E3 proofs on Windows/Linux Node20/22/24,
TAP/artifacts tied to clean submitted HEAD. No actual recurring process or OS task
installed in tests/CI. Stop at stacked Draft PR and OWNER/FRIDAY handoff, WATCH OFF.
