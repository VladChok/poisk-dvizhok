# ADR E3: bounded comparison, coverage and manual competing-evidence ledger

2026-10-31. Prepared before implementation, issue #8 only. Verified E2 base
807c14870bfb1ce098ef0295e3f817ba6d02a39d; clean checkout, all refs fetched, clean
install/native rebuild and 86 baseline expectations passed on Windows Node
v24.19.0. Independent E2 source/CI review passed; independent reexecution and
OWNER acceptance remain separate. Committed interim E2 local proof is not final
head proof; only head-pinned CI artifacts establish final-head automated runtime.

## Identity and comparison

Manual offline comparisons reference actual SQLite revision/check/run IDs or an
actual bundle+claim ID. Preserve both anchored sides and original data; no fetched
instructions, LLM verdict or automatic truth verification. SAME/CHANGED concern
identified recorded representations only. Missing identity/type/hash/content or
ambiguous baseline is INCONCLUSIVE; failed retrieval is UNAVAILABLE, never deletion.
304 uses only the E2 validated historical baseline, not future content. A missing
candidate in a bounded search is INCONCLUSIVE, not an unavailable/deleted source.

Same stored source identity/type is comparable. GitHub exact files at two pinned
commits may share a verified repository/path identity; aliases, similar names,
different feeds and different actors are not merged. Equal hashes across different
identities are possible syndication, not independent corroboration. Independence
defaults UNKNOWN; explicit common-origin hints remain attributed manual input.

Store both source pointers/revisions/check/run references, observed vs publisher
dates, method version, field-level reasons and coverage limitations. Keep full
observations in E2; E3 reports reference them and carry bounded metadata/digests,
not duplicate multi-MiB source bodies. Optional previews are tightly capped and
subject to the same secret/private-output gates. Different bytes do not establish
factual contradiction, including translations or semantically equivalent text.

Run comparison aligns recorded item identities and preserves unmatched items.
Partial pagination, caps or incompatible routes make overall coverage inconclusive
even when an individual pair can be compared. No empty search establishes absence.
IDs derive from stable ordered inputs/method version, not process time or locale.
Different pinned versions with identical payload bytes remain CHANGED (revision
field); SAME requires both byte digest and recorded revision identity to agree.
E3 requires a recorded ETag/Last-Modified on conditional checks even if a legacy
E2 check points to a historical revision without validators. Missing validators
remain INCONCLUSIVE; no E2 record is rewritten.

## Coverage and query history

Persist explicit query families/question/variants/planned routes/language/region/
date windows with links to real E2 acquisition runs. Used requests/statuses/attempts
come only from stored E1/E2 data. Operator labels are not backend-applied filters.
Record actual page/item/duplicate/invalid/filter counters on new E1 acquisitions
through an optional separate coverage metadata object. Preserve unknown counters
for legacy E2 runs; never estimate pages from HTTP counts or invent accesses.
New fallback attempts each retain their own counters; final-result counters cover
only the last attempt. Empty failed fallbacks retain the final attempted adapter
and request so they can be stored. A failed explicit web request with no observations
can record NO_CREDENTIALS; this adds no web backend or credential discovery.

Coverage records carry reasons for CUT/SURVIVED/WATCH/OPEN and actual source IDs.
WATCH here is only an existing v0 verdict label, not a scheduler. Explicit fallback
attempts and missing providers/private scope/disconnection remain visible. Decisions
and proposed negative conclusions are manual; this engine never marks absence
PROVEN from search coverage. Plans and facts stay separate. No popularity ranking.

## Manual links and reports

SUPPORTS / DISPUTES / NOT_COMPARABLE / REQUIRES_REVIEW links require two actual
anchors, subject disambiguation, rationale, actor label and statements typed as
fact / author_claim / interpretation. Stored v0 claim text/kind/pointer is copied
from the real claim, not overridden. A reviewer may attach competing values/dates
to observation statements as explicitly attributed editorial input.

Review decisions (OPEN/ACCEPTED/DISMISSED/WITHDRAWN) append separate records with
actor/rationale/time. They do not edit the link or source, and ACCEPTED is a manual
ledger decision, not proof of truth or authenticated OWNER identity. Reports retain
all decisions, both statements and old/unavailable pointers. No claim of independent
corroboration from duplicate outlets or a shared publisher.

Provide analysis compare/coverage/link/review/list/report and explicit migrate
operations with help, exposed as `research-engine analysis <command>` and the equivalent
`tools/research-analysis.mjs <command>`. Human reports use inert Markdown; console
output is bounded structured JSON (pretty-printed with --json). Read commands
never create/migrate a DB or use the network. Saved objects dedup and survive
restart. Report Markdown renders source text inertly; JSON/Markdown exports require
private opt-in, guarded new directories, caps and no overwrite.

## Schema v1 → v2

Keep original v1 DDL/checksum unchanged in the existing schema.mjs v1 module. Add an
explicit forward-only v2 migration with comparisons, anchored references/members,
query families/run membership/decisions, manual links and append-only reviews.
FK restrictions protect referenced E2 runs/checks/revisions/claims against purge.
E2 artifacts and evidence v0 bytes/validators remain unchanged.

Migration requires an explicit backup destination. Hold an immediate writer lock,
take a consistent v1 backup through a separate readonly connection, apply v2 DDL+
checksum/user_version in one transaction, verify schema/integrity, commit. Failure
rolls back and preserves the backup. Refuse future versions and schema drift;
never silently recreate a database. Migration is explicit, not a side effect of reads.

New CLIs support v1/v2 and can read/export/backup either version; E3 operations
require an explicitly migrated v2 store. The existing openMemory API defaults to
v1 compatibility for old callers, with explicit supportedVersion=2 for new callers.
Initial E2 init still creates v1; this preserves all 86 existing expectations,
including refusal by legacy callers to open a purported unsupported v2 database.
Doctor reports actual schema version. Restore validates the corresponding schema.

Rollback: use the pre-migration v1 backup restored into a NEW root and E2 code.
E2 code refuses v2; do not downgrade in place or delete E3 history. No new npm
dependency/runtime bump. Preserve the tested Windows Node20 VS2022/Python3.12
build path and Node 20/22/24 Windows/Linux matrix. No E4 tables or scheduled work.

## Proof and safety

Test original 86 expectations plus real migration/backup/failed migration/future
schema, v0 byte export, 304/unknown validators/out-of-order data, same/new dates,
changed bytes, partial routes/errors, names/syndication, competing publisher dates,
manual inference/negative refusal, malformed refs/links, secret/private boundaries,
bounded reports, concurrent migration and fresh-process persistence. CI runs the
E2 and E3 proofs on exact submitted head and uploads runtime JSON artifacts.
Only synthetic/public fixtures and logs enter Git; local state remains ignored.
WATCH OFF. No merge, deploy, external posting or E4 work.
