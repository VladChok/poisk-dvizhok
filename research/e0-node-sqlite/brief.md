# e0-node-sqlite

## QUESTION
At the historical Node.js v22.13.0 source revision, what lifecycle and storage
interface does built-in SQLite declare, and is that source inspection sufficient
to accept it as Research Engine E2's cross-platform durable store?

## WHY IT MATTERS
E2 needs file-backed memory while the existing v0 CLI should remain usable on
Node >=20. A module mentioned in documentation is not a tested storage driver.

## SCOPE
Exactly nodejs/node@48726ac59b20fe3a64eb68e9e15134a65f10e120 (v22.13.0):
doc/api/sqlite.md lines 1–120, lib/sqlite.js lines 1–5, LICENSE lines 1–23.
Historical API and implementation inspection only. No package installation,
cloning Node, benchmarks, current-version claims, or execution of source text.

## WHAT TO STUDY / SOURCE ACCESS
Named from prior knowledge on 2026-10-31. Documentation inspected using the
GitHub connector; tag resolved with git ls-remote; pinned public files retrieved
over HTTPS from raw.githubusercontent.com on 2026-10-31 UTC. Full-file hashes and
retained line ranges are in sources.json. No credentials used by the downloads.
Two routes within the same publisher: API documentation and implementation
entry point. These are not independent corroborating publishers. An independent
cross-platform runtime investigator is outside this source-only scope.

## EVIDENCE NEEDED
Exact lifecycle declaration, synchronous interface, file vs memory location,
implementation warning, license notice; real v0 validation/render/save logs.
Preserve map cuts and an OPEN platform-verification branch for the next worker.

## STOP CONDITION
Stop after these bounded source checks and offline artifact verification.
Do not choose the E2 runtime from this probe alone. Resume at CA-platform for
Windows/Linux runtime, restart, concurrency, migration and driver evaluation.
No WATCH definition, network polling, scheduling or deployment is authorized.

## RESULT / LIMITATIONS
Evidence c1–c6 distinguishes documented API, visible source and interpretation.
Use the inspect command for handoff without reading RESULT.md or chat.
Automated fresh-process resumption is a reproducibility check; a separate
researcher's source review remains pending (see REVIEW-GATE.md).
