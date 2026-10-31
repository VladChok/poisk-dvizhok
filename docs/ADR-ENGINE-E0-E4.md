# ADR: staged Research Engine implementation

Date: 2026-10-31. E0 decision implemented; the original E1–E4 interface plan below
is retained as context. E1 is now implemented separately under issue #4; see the
[E1 addendum](ADR-E1-SOURCE-HARNESS.md). E2–E4 remain planned, not operational.
Task: RESEARCH-ENGINE-CLAUDE-E0-E4-20261031, issue #2.

## Runtime and dependency decision
Keep the existing Node ESM CLI and node:test. E0 introduces no npm dependencies,
install scripts or driver requirement and preserves Node >=20 syntax/APIs.
Actual local runtime: Windows, Node v24.19.0. CI tests Windows/Linux on Node
20/22/24; a configured matrix alone is not a passed matrix (inspect PR checks).

SQLite remains the preferred E2 store. Do not silently import node:sqlite in the
v0 CLI or infer Node 20 support: the bounded historical source probe identifies
lifecycle caveats. Choose a driver only after clean Windows/Linux installation,
license, restart, FTS, locking and migration tests. If built-in SQLite requires a
newer engine runtime, isolate that requirement from the v0 tools and expose a
clear doctor failure on unsupported runtimes. No runtime bump is made by E0.
New dependencies in later PRs require pinned lockfiles and retained licenses.

The retained Node documentation/5-line entry-point snapshots are MIT material,
not imported executable modules. Include the original Node copyright/license
notice. Never execute retrieved content or treat it as worker instructions.

## Data and interfaces
Keep schema/map.schema.json, schema/evidence.schema.json and research-map.mjs
behavior unchanged. The original evidence objects remain exactly six fields.
Additional metadata lives in a versioned sidecar: sources.json v1 identifies
locator/version, retained file/range, SHA-256 and observed retrieval time.
Retrieval time is not publication/event time. A snapshot hash is integrity
metadata, not proof of truth or independent corroboration.

E0 adds `node tools/research-bundle.mjs inspect <directory> [--json]` and --help.
It reads brief/map/evidence, validates v0, verifies source snapshot hashes and
pointer coverage, and renders navigation/resume context. RESULT is not read.
Exit 0 = valid handoff artifacts, 1 = invalid/inaccessible bundle, 2 = usage.
Reads are capped at 4 MiB each and resolved inside the bundle, including symlinks.
No discovery, network access, eval, shell commands or source execution occurs.

E1's separate engine CLI will expose discover/retrieve/doctor operations over
GitHub REST, declared RSS/Atom feeds and deterministic offline fixtures. Source
observations are separate records with canonical identity, adapter/type, retrieval
time, publication time when supplied, revision/conditional validators, hash,
status and limitations. Discovery does not verify facts. Explicit quotas,
pagination, cancellation, partial failure and unavailable-provider statuses are
required before the E1 gate. Broad web search remains optional and credentialed.

E2's separate SQLite model will retain briefs, identities, append-only
observation revisions/retrievals, map/evidence/claim pointers, query routes/cuts,
incompatibility links and watch definitions/runs/deltas. Import keys must make
repeated imports idempotent without rewriting prior evidence. Use transactional,
numbered schema migrations and backup-before-upgrade; refuse newer schemas.
FTS retrieval must handle Unicode/Cyrillic. Preserve exact v0 export bytes or
canonical v0 shape, with explicit backup/restore, retention and purge operations.

E3 comparisons will preserve both conflicting pointers and distinguish SAME,
CHANGED, UNAVAILABLE and INCONCLUSIVE. Coverage records include bounded routes,
variants, dates, language/region, counts, failures, pagination limits and cuts.
No automatic truth verification or unsupported comprehensive negative claims.

E4's durable watch records will include explicit allowlists, interval/timezone,
quotas/output directory, last-known-good cursor, runs and report-delivery state.
Manual one-shot operation must work while schedule is disabled. Persist report
keys for restart dedup; document delivery semantics and missed-run policy.
Registration/autostart requires a separate explicit owner action; no tests or
installation may create a scheduled task. Hash deltas are not contradictions.

## Storage, security and platform boundaries
E0 stores only explicitly public research fixtures in the checkout. No runtime
database/data directory exists yet. Planned E2 default is LOCALAPPDATA on Windows
or an explicit --data-dir; public fixtures and private runtime state stay apart.
Ignore databases/WAL files, environment files, local configuration and private
exports. Never export auth headers, credentials, account data or private sources.

E1 must enforce HTTPS/public-host allowlists, reject private/loopback/link-local
addresses after DNS and each redirect, cap responses/timeouts/concurrency and
honor provider throttling. It must not forward tokens across origins. Automatic
tests use local fixtures; opt-in public smoke is a distinct invocation.
E0 automated tests do no network I/O. Manual public retrieval used exact official
URLs; no third-party instructions/code were run, accounts created or paid APIs used.

## Integration, gates and rollback
Verified main: 31448c9c82b6c2a96dcfed160488148f63da3dea.
Docs PR #1 remains open at e02ba42bd2e6dab4e6e4514fcdef16c7feb630e1.
E0 branches from that docs ref; no existing PR branch is overwritten. Fetch,
clean status and baseline 14/14 tests were observed before edits. Draft E0 is
reviewable separately; later stages require their own incremental Draft PRs.

Automated fresh-process resume is proven only by actual test logs; independent
second-researcher review stays HOLD until a separate reviewer records it. No
reviewer approval, Linux execution or future driver verification is inferred.

Rollback: revert the stage commit or use the unchanged main v0 CLI. E0 adds only
tooling, public artifacts and offline CI; no installation/uninstallation step,
local service, database or scheduler is created. Delete copied bundles explicitly
if desired. Later SQLite upgrades must keep rollback backups; later WATCH removal
must disable the schedule before deleting its definition. Active WATCH state: OFF.
