# ADR E2: file-backed local SQLite memory

2026-10-31. Written before storage implementation. Issue #6 only; base verified
E1 138f717685f489b9c02f9542e4b007c91df900b0. E1 remains Draft; its independent
source/CI review passed, independent runtime reexecution is not proven. E0's
separate independent CLI gate remains HOLD. No E3/E4 work or merge approval.

## Driver and platform decision

Pin better-sqlite3 12.11.1 (MIT). npm registry metadata explicitly includes Node
20/22/24. Prefer native file-backed SQLite with its transaction/locking guarantees
over a JavaScript snapshot of an in-memory DB. Do not rely on node:sqlite, which
would break Node 20. Preserve the existing Node minimum and frozen v0 contracts.
Windows x64 installation/restart proof and actual Windows/Linux CI are mandatory;
if the driver cannot run without a runtime bump, stop rather than silently bump.

Install locked dependencies with lifecycle scripts disabled, then explicitly
rebuild only better-sqlite3. Its inspected install script uses prebuild-install
or node-gyp rebuild --release. Prebuilt native binaries are a dependency supply
chain tradeoff; source-build fallback needs Python/C++ tooling. No fetched
research source or arbitrary scripts from config are executed. Retain dependency
and SQLite notices. Test the actual installed SQLite version/FTS5 at runtime.
Actual CI found no Windows Node 20 prebuild and its bundled node-gyp 10 failed
VS2026 detection. Pin windows-2022/VS2022 and Python 3.12 for a reproducible native
source build; keep Node 20 and all tests enabled. Linux Node 20 source build passed.

## Layout and privacy

Default Windows root LOCALAPPDATA/poisk-dvizhok; elsewhere XDG_DATA_HOME or
~/.local/share/poisk-dvizhok; explicit --data-dir supported. Public/private scopes
use separate subdirectories and databases; private is the default. No read-only
command creates a database/directory. init/import/ingest/restore are explicit
writes. Local DB/WAL/SHM/backups/exports/config stay ignored and uncommitted.
POSIX files use owner-only modes; Windows relies on the user's directory ACLs.
This is local storage, not encryption or automatic personal-data recognition.

Reject unknown credential-bearing fields, URL credentials, known token patterns,
current environment secrets and raw auth headers in input. Reject rather than
silently changing imported artifact bytes. Do not log SQL, raw driver exceptions,
source body errors or credentials. Private export requires an explicit flag;
restore verifies scope. A database does not expand E1 source permissions.

## Model and durability

Schema v1: briefs, immutable bundle versions/artifacts/map nodes/claims, source
identities, immutable observation revisions, separate retrieval/check events,
acquisition runs/attempt metadata, source-run associations and append-only route
CUT/REVISIT events. FTS5 indexes local text with Unicode support; no truth scoring
or semantic comparison. No watch tables are needed at this stage.

Stable hash keys and transactional imports make duplicate artifact/observation
imports idempotent. A new hash/revision preserves the older one. 304 references
the last known good revision but records a separate check; errors are run events,
not deletion evidence. Publication/update/retrieval time remain separate.
Store original bundle bytes and validated paths for exact v0 roundtrip, including
sidecar/snapshots when present. No new Evidence v0 keys.

Use SQLite WAL, synchronous FULL, foreign keys, bounded busy timeout and immediate
write transactions. Separate processes serialize writers through SQLite locks;
test a held lock and crash rollback. No claim of concurrent writes without tests.
Default logical DB cap 256 MiB, per-file import 4 MiB, bundle/run input caps and
record-count bounds. No automatic retention deletion. Explicit date/source/brief
purge operations must preserve referenced evidence or reject the purge.

## Migrations, backup and recovery

The first real migration creates v1 transactionally and records user_version,
application ID and migration checksum. Verify expected schema on open; refuse
future versions, incomplete/unknown schema and integrity failures. Do not invent
v2 just to test it. Malformed migration/transaction tests must leave existing
data unchanged. Read-only doctor reports version/integrity/prerequisites offline.

Consistent backup uses SQLite's online backup API into a staged file, validates it, fsyncs and
publishes it without overwriting any existing destination. Restore validates a
standalone backup/scope/schema and publishes into a NEW database only; existing
live databases are never blindly replaced. Test restored historical bytes and
failed restores. Reject symlinks/traversal and use same-directory staging for
publication. File publication is atomic; directory fsync is best effort on Windows.
OS/filesystem power-loss behavior is not claimed beyond SQLite FULL and fsync.
The native backup API keeps the source connection readonly and includes committed
WAL content. The copy is normalized to standalone DELETE journal mode. Backup
progress has a 30-second bound; callers must await backup before closing the store.

Corrupt databases are reported and preserved, never reset automatically. Recover
by restoring a known-good backup into a fresh data directory, then validate before
using it. Reverting E2 leaves local state intact; E1 never opens these databases.
Uninstalling does not purge data. Delete local state only on an explicit operator
action. No scheduler/service registration, network autostart, deploy or WATCH.

## Required proof

Run all 69 E0/E1 expectations, fresh-process CLI import/ingest/find/history/export,
Cyrillic FTS, v0 validators/inspector, 304/error preservation, dedup, transactions,
locks/crash recovery, future/incomplete schema rejection, malicious imports,
consistent backup/restore and privacy boundaries. Submit actual Windows/Linux ×
Node 20/22/24 results on the final head; unrun gates remain PARTIAL/HOLD.

References inspected: [driver API at v12.11.1](https://github.com/WiseLibs/better-sqlite3/blob/v12.11.1/docs/api.md),
[driver upstream](https://github.com/WiseLibs/better-sqlite3), npm version/engines/
license/install metadata observed directly. Runtime/installation claims await tests.
