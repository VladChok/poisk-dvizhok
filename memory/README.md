# Research Memory E2

Local file-backed SQLite, Node >=20, better-sqlite3 12.11.1, schema v1. The v0
schemas and CLI remain unchanged. No truth scoring, semantic comparison, WATCH,
network autostart, scheduler, cloud or browser UI.

## Install / operator path

PowerShell on Windows (use `npm` instead of `npm.cmd` on Linux):

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd rebuild better-sqlite3 --ignore-scripts=false
node tools/run-offline.mjs
node tools/research-memory.mjs --help
node tools/research-memory.mjs init --data-dir .research-engine/local
node tools/research-memory.mjs import research/e0-node-sqlite --data-dir .research-engine/local
node tools/research-memory.mjs ingest --source fixture --fixture tests/fixtures/harness.json --data-dir .research-engine/local
node tools/research-memory.mjs find --query Проверка --data-dir .research-engine/local --json
node tools/research-memory.mjs history --source fixture:fixture-russian --data-dir .research-engine/local --json
node tools/research-memory.mjs history --brief e0-node-sqlite --data-dir .research-engine/local --json
node tools/research-memory.mjs doctor --data-dir .research-engine/local --json
```

Install disables all lifecycle scripts; explicitly rebuild only the native driver.
The inspected driver installer downloads an upstream prebuilt binary or uses
node-gyp (source-build fallback needs C++/Python tooling). Missing native bindings
return DRIVER_UNAVAILABLE; the CLI never installs packages itself. Node 20 is
retained; the E0 node:sqlite source probe is not used as driver/runtime proof.

The equivalent alias is `node tools/research-engine.mjs memory <command> ...`.
Reads, search, export, doctor and backup never initialize a missing database.
Run init explicitly; import/ingest require the initialized store. Human/JSON modes
and status codes: 0 success, 1 storage/driver/acquisition failure or partial,
2 bad CLI shape, 130 cancelled. SIGINT cancels manual E1 acquisition; any resulting
cancel event can be recorded locally. No later retry/polling is registered.

## Data location and privacy

Default root: `%LOCALAPPDATA%/poisk-dvizhok` on Windows, `$XDG_DATA_HOME/poisk-dvizhok`
or `~/.local/share/poisk-dvizhok` elsewhere. `--data-dir` overrides the root.
Each root has separate `private/memory.sqlite` and `public/memory.sqlite` stores;
private is the default. `--scope public` is an explicit classification decision,
not automatic detection that content is safe to publish. No runtime data is
committed. Ignore DB/WAL/SHM, backups, local configuration and exports. Export
directories get a `.gitignore` containing `*` as a local guard.

POSIX files/directories use owner-only modes. Windows uses inherited user-folder
ACLs; SQLite is not encrypted. Known env secrets/token patterns, credential fields
and credential-bearing URLs are rejected before persistence. Logs use error codes,
never raw SQL/driver errors, source failure bodies, auth headers or cookies.
This is not a general PII detector: keep personal material private and local.

## What survives restart

Briefs and immutable bundle versions contain original artifact bytes, map nodes,
claim IDs, source pointers and imported timestamps. Original map/evidence keys,
ordering and bytes are preserved. Optional sources.json and retained snapshots
must pass E0 integrity inspection. Unknown files, traversal/symlinks, oversized
input, malformed JSON, duplicate claim IDs or invalid v0 are rejected atomically.
An exported `.gitignore` is a guard, not a new research version; reimport dedups.

Source identities retain adapter/type/classification/canonical locator. Immutable
revisions retain content, hashes and complete E1 observation JSON. Retrieval checks
record observed UTC time, original publisher dates, validators/status/access route
and the selected baseline separately. A new hash is changed bytes, not falsehood.
304 creates a check referencing a previous revision, never an empty replacement.
It matches prior ETag/Last-Modified when supplied and never borrows a future event.
Unknown validators/no baseline are reported. Feed-level 304 reuses prior feed
membership; entry content and old revisions remain intact. Feed response metadata
is retained even when E1 did not supply the full XML response body.

Acquisition runs preserve bounded requests, statuses, attempts, gaps and metadata.
NETWORK_ERROR/403/404/429/TIMEOUT do not delete old source data. Route events may
record OPEN/CUT/REVISIT with explicit reasons; no automatic E3 decisions occur.
Duplicate observation/bundle imports are idempotent. Ingest uses a fresh run key
per invocation; `--key` makes deliberate replays idempotent. Reusing a key for
different content/status/request returns IDEMPOTENCY_CONFLICT instead of dropping
new evidence silently. Retrieval-time differences alone do not change content.

## Ingest, search, history and v0 export

Fixture ingestion above is offline. Manual public GitHub/RSS ingestion uses E1's
same config, allowlists, quotas and credential boundary:

```powershell
node tools/research-memory.mjs ingest --source github --operation retrieve --repo VladChok/poisk-dvizhok --ref 138f717685f489b9c02f9542e4b007c91df900b0 --file README.md --data-dir .research-engine/local
node tools/research-memory.mjs ingest --source rss --url https://github.blog/feed/ --config harness/config.example.json --data-dir .research-engine/local
node tools/research-memory.mjs ingest --input <saved-E1-result.json> --key <run-id> --data-dir .research-engine/local
```

No live ingest is part of automated tests/proof. Search supports `--query`,
`--source` (stable DB ID, identity or locator), `--brief`, `--claim`, `--from`, `--to`
and `--limit` (1–100). Dates are full UTC timestamps. FTS5 uses Unicode61 tokens
including Cyrillic; token matching is literal AND, without stemming or semantic
ranking. Results use stable insertion order and include historical records.
History exposes revisions, checks, original provenance and run associations.
Brief history exposes all versions and claims; no old conclusions are rewritten.

Export requires an existing parent and a NEW directory whose basename is the
brief slug. Public stores may export directly; private stores require
`--allow-private`. Choose an ignored/local destination:

```powershell
New-Item -ItemType Directory -Force .research-engine/exports | Out-Null
node tools/research-memory.mjs export e0-node-sqlite --out .research-engine/exports/e0-node-sqlite --allow-private --data-dir .research-engine/local
node tools/research-map.mjs validate .research-engine/exports/e0-node-sqlite/map.json
node tools/research-map.mjs validate-evidence .research-engine/exports/e0-node-sqlite/evidence.jsonl --map .research-engine/exports/e0-node-sqlite/map.json
node tools/research-bundle.mjs inspect .research-engine/exports/e0-node-sqlite
```

Default export is the latest imported version; `--bundle <id>` selects an older
one. Simple original v0 bundles need only brief/map/evidence. E0-style bundles
also preserve sidecar/snapshots for inspector compatibility. No conversion to a
new evidence shape and no automatic truth verification.

## Backup, restore, migration, retention

```powershell
node tools/research-memory.mjs backup --out .research-engine/research-backup.sqlite --data-dir .research-engine/local
node tools/research-memory.mjs restore --from .research-engine/research-backup.sqlite --data-dir .research-engine/recovered
node tools/research-memory.mjs doctor --data-dir .research-engine/recovered --json
```

Backup is a bounded SQLite online snapshot of committed data, including WAL.
Validate schema/full integrity, normalize the copy to standalone journal mode,
fsync and publish a no-clobber file. Existing destinations are rejected. Restore
validates a staged copy/scope/version/integrity and restores into a NEW store only.
It never overwrites an existing live DB. A failed restore preserves originals.
The backup input directory need only be readable; validation uses a private temp copy.
Corrupt DBs are reported and retained; recover from a known-good backup into a
fresh root. Restore input must be a standalone backup, not an active WAL database.

Schema v1 is created by a transactional initial migration with application_id,
user_version and checksum. Open verifies exact compiled schema/migration/scope,
foreign keys and quick integrity; future/incomplete/mutated schemas are refused.
`migrate` verifies the currently supported version and reports changed=false.
No real v2 exists, so no fake v1→v2 migration is claimed. Failed migration tests
exercise rollback; upgrades will need their own migration and rollback review.

WAL + synchronous FULL and immediate transactions serialize writers. A 5-second
busy timeout bounds contention (API allows a smaller bound); BUSY is retryable by
the caller. Three concurrent writer processes, a held lock and forced process
exit are tested. This is tested local filesystem behavior, not network-share or
arbitrary power-loss certification. Backup must be awaited before closing the API.

Defaults: 256 MiB logical DB cap (init `--max-bytes`, 1 MiB–1 GiB), 100,000 rows per
major table, 4 MiB per input artifact/observation, 32 MiB aggregate bundle/run,
100 directory entries, 50 source snapshots. WAL can temporarily add disk usage;
checkpoint every 100 pages, target journal retention 16 MiB. Quotas are not a
hard guarantee on combined DB+WAL/backup physical bytes under long-lived readers.
No automatic data deletion. Explicit purge needs `--confirm` and exactly one of
`--before`, `--brief`, `--source`. Date purge retains each latest/last-good check
and immutable source revisions. Brief purge removes that brief's artifacts and
claims; shared source history remains. Source purge is blocked while evidence
references it. DELETE frees reusable SQLite pages, not guaranteed disk shrinking
or forensic erasure. Backups are retained until explicitly removed by the operator.

## Verification and rollback

`node tools/run-offline.mjs` tests E0/E1 plus E2, with network APIs blocked.
`node tools/memory-proof.mjs` runs public fixtures through separate CLI processes,
checks byte-identical v0 exports and restored historical state, prints sanitized
JSON and removes only its own temp directory. CI executes both on Windows/Linux
× Node 20/22/24 and publishes per-platform durability JSON artifacts.
See [E2 report](../docs/e2/REPORT.md) and [ADR](../docs/ADR-E2-MEMORY.md).

Rollback: use E1's branch; it never opens SQLite memory. Leave DBs/backups intact
until recovery/retention is decided. Uninstalling dependencies does not delete
research data. No service or scheduled task exists. WATCH remains OFF.
