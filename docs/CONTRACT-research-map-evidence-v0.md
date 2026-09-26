# Research Map & Evidence contract — v0

> **v0 — frozen 2026-09-26; not yet proven live: reach[] as array, leaf-status rule, negative-claim convention.**
>
> Machine form: [`schema/map.schema.json`](../schema/map.schema.json), [`schema/evidence.schema.json`](../schema/evidence.schema.json). Cross-field rules that JSON Schema cannot express are checked by [`tools/research-map.mjs`](../tools/research-map.mjs) (`validate`, `validate-evidence`). Demo: [`research/demo-agent-harness/`](../research/demo-agent-harness/).

What is frozen was exercised in the first live research probe: the six evidence fields, the `pointer` shape, the nine map-node fields plus `brief`, the `level` and `status` vocabularies, the rule "the map is the path, evidence is the support", and the handoff property (a second researcher continues from the map). Three rules — A (`reach[]` as an array with `prior-knowledge`), B (branch verdict = leaf status), C (negative-claim convention) — are accepted by decision and wait for the first probe run on v0.

A research result has three artifacts, all committed:

```text
brief           RESEARCH-METHOD.md shape + id (slug) = name of the result folder
map.json        the search path: how the space narrowed and why
evidence.jsonl  the support: one line per claim, each with a resolvable pointer
```

The RESULT refers to `map.json` / `evidence.jsonl`; every fact in it cites a `claim_id`.

---

## MAP CONTRACT — v0

One `map.json` per brief.

```text
root    { brief: <brief id = slug of the result folder>, nodes: [ … ] }

node    field      req.   value
        id         yes    unique in the map; a prefix by level (F0, CL1, CA-*, DD-*) is a convention, not a rule
        level      yes    FIELD | CLUSTER | CANDIDATE | DEEP_DIVE   (WATCH is a status, not a level; Stalactite layers = level)
        title      yes    string
        parent     yes    node id | null (FIELD only)
        status     yes    OPEN | CUT | SURVIVED | WATCH | DEEP_DIVE | DONE   — semantics by rule B (leaf / container)
        reason     yes*   string; * required for every status except OPEN (for OPEN: "" or null)
        sources[]  yes**  ≥ 1 from level CANDIDATE; item = pointer {locator, position?, version} (same shape as in evidence)
        reach[]    yes**  ≥ 1 from level CANDIDATE; item {tool, at}; order = chronology; reach[0] = discovery   ← rule A
        notes      yes    string ("" allowed); free text, NOT a place for claims or pointers
```

Invariants (validator): every `parent` resolves; exactly one node has `parent: null` and it is the `FIELD`; `reason` is non-empty outside `OPEN`; `DONE` only on nodes with children; a `DEEP_DIVE` node is never `DONE`; `id` values are unique; `save → reopen` is byte-for-byte (key order as above). There are no fields beyond these ten (9 per node + `brief` at the root). The map carries no `claim`.

## EVIDENCE CONTRACT — v0

```text
evidence.jsonl — one line = one confirmation of one claim; 6 fields, fixed key order
  claim_id    "c1", "c2"…  unique in the file; every fact of the RESULT refers to one
  claim       one line
  kind        fact | author_claim | interpretation
  pointer     { locator: URL | repository path, position?: line / § / anchor, version: commit | tag | "retrieved <ISO date>" }
  limitation  string | null  (null is explicit)
  map_node    id of a map node
```

Conventions (contract text, not fields): a negative claim follows rule C; `position` is absent only on scope pointers; a web source without a version gets `version = "retrieved <date>"` and a `limitation` that says so. A `quote` (verbatim) layer is **not** part of v0. Evidence carries no `status` / `reason`.

## REACH CONTRACT — v0 (accepted, not yet proven live)

`reach[]` is a log of actual access to sources — measure first, build later. Required from `CANDIDATE`. The `tool` vocabulary is open; reserved values: `gh`, `web-search`, `web-fetch`, `npm`, `browser`, `prior-knowledge`, `agent-reach:<channel>`. `at` is an ISO date (a day is enough). A reach table in a report = "tool → in how many nodes it appears" (a node with two tools counts for both). The engine does **not** provide access — access is a capability of the executor.

---

## Rule A — `reach` is an array

```text
reach: [ {tool, at}, {tool, at}, … ]      array, order = chronology
  reach[0]  — how the node ENTERED the map (discovery)
  reach[1…] — what it was checked with (verification)
  "prior-knowledge" — the node was named from the researcher's prior knowledge; at = date it was named
  required from level CANDIDATE: ≥ 1 item
```

Why: a single `{tool, at}` object cannot say "found with X, checked with Y", and "named from memory" is not a tool at all. The array keeps both facts, and the reach table stays computable. Rejected: a separate `origin` / `found_by` field (a second name for the same thing); `role: discovery|verification` inside an item (array order already carries the role).

## Rule B — status belongs to the node's level; branch verdict = leaf status

```text
a node's status refers to ITS level:
  CANDIDATE SURVIVED = passed triage, provisional; the branch continues (DEEP_DIVE / WATCH)
  branch verdict     = status of its DEEPEST node (the leaf)
  a leaf ends as     CUT | SURVIVED | WATCH   (OPEN — if not finished)
  DONE               = only for nodes with children (FIELD / CLUSTER): "all children resolved"
  brief survivor     = a leaf with status SURVIVED
```

Why: "passed triage" and "survivor of the brief" were one word; a deep dive that fails the brief's criterion must read as `CUT`, not `DONE`. Rejected: new statuses (`PARTIAL`, `CONFIRMED`), a `criteria[]` field on the node (that is evidence, not map). The validator checks: `DONE` only when the node has children; a `DEEP_DIVE` node is never `DONE`.

## Rule C — negative claims

A negative claim is verifiable when the pointer names a **scope** (file or repository @ version) and `limitation` says **how** it was searched.

```text
negative claim ("X is absent from S"):
  kind       = fact, if the absence was established by a reproducible procedure over the whole scope (grep / search over S@version);
               interpretation — if over part of the scope, or from knowledge
  pointer    = { locator: S (file | repository | endpoint), version } — no position: the scope is the position
  limitation = REQUIRED, not null: what was searched and how (e.g. "grep 'collapse|cluster' over src/graph.ts@<commit>"),
               so that a reviewer can repeat it
```

Rejected: `kind: absence` (a third sort of truth for two lines), a `method` field (duplicates `limitation`). The validator checks the mechanical half: an evidence line without `position` must have a non-null `limitation`.

---

## Handoff property

A second researcher with brief + map + evidence (without the report) can answer: where a survivor came from, why a branch was cut, where to resume. This is the reason the map exists; `tools/research-map.mjs render --node <id>` prints exactly that path.

## Not in v0

MEMORY, LEGEND entries, source adapters, registry, source trust / security, WATCH refresh, a map UI. See [METHOD-stalactite-search.md](METHOD-stalactite-search.md) § Future slots.
