# Local WATCH E4 — OFF by default

WATCH reuses E1 acquisition, E2 SQLite and E3 comparison/coverage. Sources are data,
never executable instructions. The default is no resident process, OS task, timer,
service or outbound delivery. `enable` records desired state; it starts nothing.
`due --once` is a finite serial scheduler pass explicitly started by the operator.

## Install and migrate

Node >=20, same pinned dependencies/native driver as E2/E3. On PowerShell use
`npm.cmd ci --ignore-scripts --no-audit --no-fund`, then
`npm.cmd rebuild better-sqlite3 --ignore-scripts=false`; on Ubuntu use `npm`.
Windows Node20 may require VS2022 C++ tooling, Python3.12 and
`$env:npm_config_msvs_version='2022'`. No runtime installation occurs in the CLI.
CI covers Windows2022/Ubuntu Node20/22/24; Windows10/11 are an operator setup target,
not a separately executed OS matrix. No new dependency or runtime minimum bump.

```text
node tools/research-memory.mjs init --data-dir .research-engine/local
node tools/research-memory.mjs import research/e0-node-sqlite --data-dir .research-engine/local
node tools/research-analysis.mjs migrate --backup .research-engine/v1.sqlite --data-dir .research-engine/local
node tools/research-watch.mjs migrate --backup .research-engine/v2.sqlite --data-dir .research-engine/local
node tools/research-memory.mjs doctor --data-dir .research-engine/local --json
node tools/research-engine.mjs watch --help
```

Private scope is default, in a physically separate database; use --scope public
only for public fixtures. Keep the same scope on all commands. New v2→v3 migration
requires a NEW backup path with existing parent; holds a writer lock, saves a
consistent standalone v2 copy, then applies/validates v3 transactionally. Failure
rolls back. Existing v3 is an idempotent no-op; v1 must use reviewed v1→v2 first.
No read creates/migrates a DB. Original v1/v2 SQL/checksums and Evidence v0 unchanged.

Rollback: restore the v2 backup with `research-memory restore --from <v2.sqlite>
--data-dir <NEW-root>` and return to E3 code. Do not downgrade/overwrite in place.
New memory/analysis CLIs read v1/v2/v3 explicitly; legacy library defaults still
refuse newer schemas. New E3 library callers can opt into supportedVersion=3.

## Register targets

RSS/Atom needs an explicit E1 config, e.g. local-config.json (ignored):

```json
{"version":1,"allowedHosts":["feeds.example.com"],"feeds":["https://feeds.example.com/news"],"limits":{"maxResults":20,"maxPages":3,"maxRequests":12}}
```

Replace example hosts with the public feed you explicitly authorize. Config permits
only HTTPS/public DNS/allowed redirects through E1. No browser scraping, private
accounts, paywall/anti-bot bypass or optional credential acquisition. Credentials
may be externally injected as GITHUB_TOKEN; no credentials enter watch definitions.

```text
node tools/research-watch.mjs add --name news --source rss --url https://feeds.example.com/news --config local-config.json --interval 24h --timezone Asia/Krasnoyarsk --data-dir .research-engine/local
node tools/research-watch.mjs add --name repos --source github --query "sqlite research" --interval 6h --data-dir .research-engine/local
node tools/research-watch.mjs list --data-dir .research-engine/local --json
```

Definitions are DISABLED. Stable ID=scope+name; exact target, normalized config,
interval, timezone, output root, brief and policy have an immutable fingerprint.
Changed configuration requires a new named definition; duplicate identical add
deduplicates, conflicting reuse fails. GitHub search tracks captured per-repository
ID/name/created/updated metadata, not code or full repository content. Results remain
bounded discovery leads. Different identities/names are not merged or corroborated.
General web add returns NO_PROVIDER_NO_CREDENTIALS; no backend is invented.

For immutable GitHub SHA audit, specify `--mode pinned-audit --repo owner/name
--ref <40-hex-SHA> [--file path]` instead of query. This checks availability/integrity
of that pin, never pretends it follows a changing branch. Moving branches are not
implemented. RSS articles linked from entries are not fetched/verified articles.

`add --input definition.json` accepts name/source/url or query or pinned-audit
repo/ref/file, config, interval (1m..365d, units s/m/h/d), timezone, out, brief,
actor, maxPending (1..1000, default100), historyDays (1..36500, default365).
Output defaults beside the private/public DB under watch-reports/<watch-id>.
History retention controls the default view only; --all exposes older audit rows.
No evidence is silently purged. Pending-report/row/logical disk quotas stop growth.

## Explicit checks, reports and controls

The commands below perform network only when explicitly invoked for the registered
target; this implementation work order did not execute them against live targets.

```text
node tools/research-watch.mjs run news --once --key manual-check-1 --data-dir .research-engine/local --json
node tools/research-watch.mjs history news --all --data-dir .research-engine/local --json
node tools/research-watch.mjs report <delivery-id> --data-dir .research-engine/local --json
node tools/research-watch.mjs report <delivery-id> --write --allow-private --data-dir .research-engine/local
node tools/research-watch.mjs enable news --data-dir .research-engine/local
node tools/research-watch.mjs due --once --network --limit 10 --max-requests 50 --data-dir .research-engine/local --json
node tools/research-watch.mjs disable news --data-dir .research-engine/local
node tools/research-watch.mjs remove news --data-dir .research-engine/local
```

Manual run-once works while disabled. `--key` returns a completed request without
another fetch; omit for a new check. All checks retain E2 observations/runs, E3
comparisons/coverage and watch attempt history. Meaningful outcomes create pending
SQLite reports; SAME/validated304 and identical retries do not emit duplicate files.
Report IDs are returned by run/history. `report --write` publishes locally; private
scope requires explicit --allow-private. `run --write` and `due --write` can publish
new reports with the same private gate. Report/receipt recovery is a separate
explicit command; due does not silently export pending private content.

Markdown+JSON include actual pointers/versions/checks/revisions, dates, E3 comparison
and coverage IDs, requests/counters/gaps. Full source bodies remain in E2. Source
text renders as inert literals. No email/webhook/Telegram/cloud notifications.
SAME/CHANGED describe recorded bytes/version/metadata, never factual contradictions.
NEW means newly captured in this bounded watch, not a newly occurring real event.
Full RSS-response omissions are only REMOVED_OR_UNAVAILABLE candidates (not confirmed
deletion or publisher-wide absence); GitHub search omissions remain STILL_UNKNOWN.
403/404/429/timeouts, duplicates, partial coverage, identity/date ambiguity and stale
validators keep the old source baseline and explicit gaps. Positive partial captures
may be retained, but invalidate an older conditional root cursor. Negative/absence
claims remain NOT_PROVEN. No WATCH result mutates Evidence v0.

304 must match validators actually sent and this watch's own complete baseline.
Its own captured check IDs define cached RSS membership, even if another watch
captured a newer/capped response from the same feed. No fake entry checks/new bytes.
Empty-feed 304 does not resurrect older omitted entries. Source/publisher/update
dates stay separate; event dates are not inferred.

## Scheduler and recovery semantics

Enable sets desired ENABLED and next_due_at UTC, without spawning anything.
The checker is finite, serial concurrency1, max10 targets and conservative global
request reservation (max50); each target also has E1 response/request/retry/time
caps. No foreground infinite loop, daemon or startup hook. It coalesces missed
windows into one check, then schedules from completion; no catch-up storm. Fixed
UTC elapsed intervals are independent of display timezone/DST. Backwards/invalid
clock does not fetch/advance content. Backoff/jitter are deterministic and capped;
provider Retry-After/reset cooldowns persist across restart and matching origin
allowlists, and manual checks also respect them. Enabled desired state survives
restart; it never creates a resident worker by itself.

Immediate SQLite leases serialize workers. Duration exceeds configured E1 worst-case
budget. Each owner has a fencing token; stale/disabled workers cannot commit after
ownership changes. A killed worker leaves a RUNNING attempt until lease expiry;
recovery marks it ABANDONED and checks again. Acquisition is at-least-once: requests
can repeat after crash, but committed cursor/event/report transitions deduplicate.
Disable/remove invalidate the lease, prevent future scheduled work and retain all
history. Already-issued requests cannot be remotely retracted; cancellation/exit
does not advance good content. Removed definitions are terminal archival records.

Local delivery is at-least-once with deterministic directory/content verification,
not an external exactly-once claim. DB acquisition/cursor/deltas/pending delivery
commit together. Crash after commit/before publication retries the same delivery;
crash after files/before receipt verifies existing exact bytes and records one
receipt. Owned partial publication can fill missing files from the manifest;
unrelated/replaced files and unknown directories are refused. A crash in the tiny
mkdir/ignore/manifest ownership window may require explicit operator cleanup after
checking the directory. No unrelated directory is automatically adopted/deleted.

Uninstall/disable: disable or remove desired watches, stop any caller-controlled
finite invocation with Ctrl+C, retain DB/backups, optionally remove node_modules.
There is no OS task/service to unregister from this implementation. Optional OS
scheduling is only a future separately authorized integration; no registration
command is supplied or executed. Do not schedule a restored backup without review.

## Offline proof and limits

```text
node tools/run-offline.mjs
node tools/memory-proof.mjs
node tools/comparison-proof.mjs
node tools/watch-proof.mjs
```

The WATCH proof is35 fresh CLI processes, actual E1 RSS parser/conditional logic
through explicit JSON HTTP fixtures, SQLite migration/persistence, changes/304,
enable+finite due+disable, local publication/receipt dedup, v3 backup/restore,
v2 rollback and preserved E3 withdrawal/exact v0 bytes. Network APIs are denied.
`--http-fixture file [--at UTC]` is an explicit reproduction transport with
{version:1,responses:[{url,status,responseHeaders,body}]} and no network fallback.
Clock override requires a fixture. Real sources are never polled by tests/CI.

Lists/history max100 with offset; default history view bounded by historyDays,
--all retains audit access. Canonical JSON input/output/report cap1MiB; source
refs/representations bounded by E1/E3; large output fails instead of truncating
silently. SQLite/WAL/backups/reports consume additional physical disk. No generic
PII detection, at-rest encryption, authenticated operator identity, arbitrary
power-loss/network-filesystem proof or confirmed article/deletion/absence verdict.
Tests simulate crashes/fake clocks, not hardware failures. See docs/e4/REPORT.md
for exact source/CI evidence and outstanding independent acceptance gates.
WATCH OFF at handoff; no live smoke, resident monitor, OS registration, merge/deploy.

## FRIDAY P1/P2 corrections

See [fix report](../docs/fixes/FRIDAY-P1-P2-REPORT.md). Validators in the existing
schema-v3 JSON cursor now include their exact effective URI. Legacy cursors have
no proven scope and require one explicit unconditional check; reads never upgrade
or fetch. Redirected RSS is retrieved unconditionally through the declared target.
Invalid 304 retains the last good bytes, clears the conditional cursor and records
unknown rather than unchanged.

Scheduled keys bind watch + immutable ENABLE event ID + due slot. Same-clock
disable/enable creates a distinct durable activation; repeated enable while enabled
preserves schedule/lease. Eligibility and epoch fencing precede scheduled replay.
Manual keys and delivery receipts retain their existing idempotency behavior.
No DDL/checksum/version change or automatic migration. Existing histories and
backups remain schema3. `node tools/friday-fix-proof.mjs` adds a24-process offline
restart/restore proof. All enable/due calls in tests use isolated fixture state.
FRIDAY's previous HOLD requires a fresh independent decision on the submitted SHA.
