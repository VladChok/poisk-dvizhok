# E2 delivery: durable local SQLite Research Memory

Issue #6 only. Implementation branch: impl/research-engine-e2-20261031.
Verified base: open E1 Draft #5, 138f717685f489b9c02f9542e4b007c91df900b0.
Main 31448c9, docs e02ba42 and E0 e9ef2b8 were unchanged after fetch. Starting
worktree was clean. Exact submitted head is in the E2 Draft PR and in every CI
durability artifact's `commit` field (the artifact also records dirty/clean state).

E1 independent source/CI review PASS; independent runtime reexecution NOT RUN.
E0 independent reviewer CLI gate remains HOLD. Neither is promoted by this worker.

## Delivered and compatible

Real file-backed SQLite, scoped local public/private stores, briefs and immutable
v0 bundle versions/artifacts/claims, source identities and observation revisions,
separate 304/error checks, acquisition runs/attempts and CUT/REVISIT history.
Unicode FTS search, filters/history, strict idempotent imports, original-byte v0
export, initial transactional migration/checksum/schema validation, consistent
backup, scope-checked restore into new stores, explicit retention/purge and CLI.

69 existing E0/E1 expectations and frozen schemas/map CLI are preserved. E1 gets
only a delegation alias to the memory CLI; its source behavior is unchanged. No
E3 semantic ranking or E4 watch definitions/scheduler are implemented. WATCH OFF.

## Observed execution

- Baseline: clean `npm ci --ignore-scripts --no-audit --no-fund`, then
  `node tools/run-offline.mjs` on Windows Node v24.19.0: 69/69 PASS, exit 0.
- Driver: better-sqlite3 12.11.1, installed Windows x64 prebuild loaded; SQLite
  3.53.2 and FTS5 observed. Node >=20 minimum retained, not inferred from E0 docs.
- Clean E2 installation/native rebuild and exact exit codes: [INSTALL.txt](INSTALL.txt).
- Full offline tests and repeated E0/E1 baseline: [EXECUTION.json](EXECUTION.json).
- Real Windows fresh-process proof: [DURABILITY-WINDOWS.json](DURABILITY-WINDOWS.json).
  It creates/closes/reopens SQLite through 19 separate processes, queries Cyrillic,
  verifies stable history, restores backup and compares v0/snapshot byte hashes.
  Temporary DBs/exports are removed; no live source data is committed.
- CI executes the full suite AND the same fresh-process proof on Windows/Linux
  × Node 20/22/24, then uploads per-job memory-proof JSON with exact commit/runtime.
  Final observed run links/status are recorded in the E2 PR; configured CI alone
  is not a claim that Linux or any matrix combination passed.
- Initial head d61ca6a passed five matrix combinations but Windows Node 20 failed
  native installation: no prebuilt binary and bundled node-gyp 10 could not detect
  VS2026 on windows-latest. [Failed job](https://github.com/VladChok/poisk-dvizhok/actions/runs/41166569262/job/124435315202).
  CI now pins windows-2022/VS2022 and Python 3.12 for that source-build path;
  Node 20 and all assertions remain enabled. Final acceptance uses the new head's
  complete matrix results in the PR.

Tests cover actual native SQLite I/O, idempotency and key conflicts, history/new
revision/stale and unknown ETag/304 membership, failed/partial acquisitions,
invalid dates, exact v0 export/validators/inspector, transactional rollback,
logical quotas, schema migration rollback/incomplete/future/tampered schema,
WAL-consistent backup/read-only source/restore/no overwrite, corruption preservation,
private export/restore boundaries, rejected credentials, symlinks/traversal/large
or garbled inputs, inert instruction text, explicit purge, three simultaneous
writer processes, bounded BUSY and process-exit rollback. Tests/proof have network
APIs blocked. E2 performs no new live source smoke; E1's public smoke is separate.

## Dependencies, limits and operator safety

New driver better-sqlite3 12.11.1 (MIT), SQLite public-domain code. All 41 locked
packages, versions, declared licenses and integrity hashes appear in
[DEPENDENCIES.json](DEPENDENCIES.json); retained [notices](THIRD-PARTY-NOTICES.txt).
prebuild-install is a deprecated transitive installer; install scripts stay disabled
except the explicitly rebuilt native driver. Source-build fallback needs external
Python/C++ tools. No driver/build/update/install is performed by the memory CLI.

Default Windows path: LOCALAPPDATA/poisk-dvizhok/{private|public}/memory.sqlite;
explicit --data-dir used in every test. Linux follows XDG/local per-user data.
Private default, separate physical DBs, explicit private export flag, no encryption
or claim of generic PII detection. Reject known secrets/credential fields instead
of altering evidence bytes. Logs contain codes and synthetic/public fixture data.

Schema v1 only: actual initial migration and rollback are tested; no fictional v2
migration. Future/unknown schema refuses writes. Restore accepts only a valid
standalone backup and NEW destination, preserving existing data. Read-only commands
never initialize missing databases/directories. Quotas bound logical DB and rows;
WAL/backups can add temporary physical disk usage. No automatic deletion, network
polling or sharing. File publication/fsync is tested locally; network filesystems
and arbitrary power loss are outside this proof.

See [operator instructions](../../memory/README.md) and [ADR](../ADR-E2-MEMORY.md).
Rollback: return to E1 without touching DBs, or restore a validated backup into a
fresh data root. Uninstalling dependencies does not delete research data. No
service/task registration needs removal. No merge, deploy, other-repository writes,
E3/E4 work, credential acquisition or WATCH activation.

## Changed paths

Storage: memory/{store,schema,bundle,safety}.mjs, memory/README.md.
CLI/proof: tools/research-memory.mjs, tools/memory-proof.mjs, one delegation line
in tools/research-engine.mjs. Tests: tests/memory.test.mjs and
tests/helpers/memory-worker.mjs. Build: package.json, package-lock.json,
.github/workflows/offline.yml, .gitignore. Documentation: README.md,
docs/ADR-E2-MEMORY.md, docs/ADR-ENGINE-E0-E4.md and docs/e2/* (report, recorded
execution/install/durability and dependency/license evidence only).

STOP after E2 Draft PR and OWNER/FRIDAY handoff; acceptance/merge remains separate.
