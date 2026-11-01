# SEARCHER integration — operational boundary and first proof gate v0.1

**Date:** 2026-10-31  
**Status:** PROPOSED / DOCS ONLY / SOURCE-INSPECTED; runtime NOT RUN in this update.  
**Owner of SEARCHER role:** consuming role registry (outside this engine).  
**Owner of METHOD / MAP / EVIDENCE mechanics:** poisk-dvizhok.  
**Authority:** integration guide only. No agent startup, background research, web scraping, installation, source adapters, code import, or production approval.

## Why this document exists

A named SEARCHER agent needs an operational path to an existing research engine **without duplicating its method or pretending the engine can already search every website**. This guide is an integration contract for a replaceable executor, not a second role prompt and not a frozen engine architecture.

```text
assigned research brief
      ↓
SEARCHER role chooses search mode, scope, sources, STOP
      ↓
available executor tools (GitHub / web / authorized connectors)
      ↓
observed sources, revisions, dates, limitations
      ↓
poisk-dvizhok METHOD → map.json + evidence.jsonl
      ↓
human RESULT (cites claim_id) → review / handoff / STOP
```

Role / engine / executor / source capability are four separate things. The role cannot create new tool access by writing a prompt. The engine is not a currently running researcher.

## What can be used already

Read-only inspection of the repository at `31448c9c82b6c2a96dcfed160488148f63da3dea` confirms the following **source-level** pieces:

| Piece | Source | Known limit |
|---|---|---|
| Research brief shape | [RESEARCH-METHOD.md](../RESEARCH-METHOD.md) | Structure, not autonomous task scheduling |
| Stalactite Search | [METHOD-stalactite-search.md](METHOD-stalactite-search.md) | Working strategy, not a crawler or automated ranking |
| Map & Evidence v0 | [CONTRACT-research-map-evidence-v0.md](CONTRACT-research-map-evidence-v0.md) + [schema/](../schema/) | Frozen field shape; several semantic rules still require real probe |
| CLI source code | [research-map.mjs](../tools/research-map.mjs) | Validator / renderer / save, not search; **execution not tested in this docs update** |
| Source Harness | [harness/README.md](../harness/README.md) | Reserved layout, no bundled source adapters or credentials |
| Memory | [memory/README.md](../memory/README.md) | Reserved area, no persistent search-memory service or retention contract |
| Agent Reach review | [REVIEW-source-harness-agent-reach.md](REVIEW-source-harness-agent-reach.md) | Donor/candidate only; not installed/integrated by this guide |

**Known gap:** the existing README's early bootstrap wording can obscure the real CLI and contract. Do not infer from the existence of a CLI that live source access, automated verification, safe credential handling or monitoring is implemented.

## SEARCHER → engine input

A bounded assignment should carry:
- **Task ID / brief slug**, assigned question and decision it informs;
- research mode (a role decision), allowed scope, time/region, excluded areas;
- required evidence and explicit STOP condition;
- available source capabilities the executor *actually has*; denied/unavailable tools recorded as such;
- output destination and authorized write/execute scope.

The engine uses the existing Method and map/evidence schema; **no SEARCHER-specific fields are added** to the frozen JSON v0 contract. A donor's licensing/test/security details and a TRACE chronology belong in the human RESULT or evidence claim text/pointers, not invented map keys.

## SEARCHER → engine output

The minimum formal package is:

```text
research/<brief-slug>/
  brief.md           # Research Method question, limits, STOP
  map.json           # paths, cuts, survivors, reach and sources
  evidence.jsonl     # exact 6-field evidence objects
  RESULT.md          # human answer citing claim_ids
```

This directory layout is a **recommended integration convention**, not a modification to the frozen map schema. The v0 contract requires the map's `brief` to match the result-folder slug. Actual existing demo layouts may differ.

Map rules:
- `level = FIELD | CLUSTER | CANDIDATE | DEEP_DIVE`; WATCH is a status, not a level.
- `reach[]` logs actual source access in chronology. A candidate named from memory begins with `prior-knowledge`, not fictitious `gh`.
- `sources[]` and `reach[]` start at CANDIDATE.
- `DONE` is for a container with children. Deepest leaf status describes branch verdict.
- Cut branches remain in the map with reasons so a future researcher need not repeat them.

Evidence rules:
- Exactly `claim_id, claim, kind, pointer, limitation, map_node` in the contract's order.
- `kind`: `fact | author_claim | interpretation`.
- `pointer`: `locator`, optional `position`, `version` for reproducible location and source revision/date.
- Absence/negative claim as `fact` only after a bounded reproducible **whole-scope** search; otherwise an interpretation. Scope-only pointers must describe the method in `limitation`.
- A test file is not a passed test, a release note is not our runtime proof, and an automated validator does not establish the factual truth of a claim.

**Execution requires separate scope authorization.** The CLI supports these source-inspected commands:

```bash
node tools/research-map.mjs validate research/<brief-slug>/map.json
node tools/research-map.mjs validate-evidence research/<brief-slug>/evidence.jsonl --map research/<brief-slug>/map.json
node tools/research-map.mjs render research/<brief-slug>/map.json
node tools/research-map.mjs save research/<brief-slug>/map.json --out /approved/output/map.json
```

These are instructions for an authorized local execution session, **not a claim that they have been executed in this update**. A validator pass checks contract validity; a separate reviewer must inspect evidence, coverage, licenses and conclusions.

## Capability routing: real access only

Search source priority depends on question and available access.

- **GitHub:** repository metadata, exact commits, files, issues, tests and licenses with connector/CLI access granted to the executor. Public search snippets may omit private or non-default-branch files.
- **Web / official documents:** publisher, product, standard, government, court or academic original with observed date, event date and version. Search engines aid discovery; the cited primary source carries the claim.
- **Browser:** for permitted pages/visual or dynamic-source checks when needed, never as a license to bypass paywalls, login, anti-bot barriers or rate limits.
- **External source tool (including Agent Reach):** optional only if present, configured and permitted; the current engine does not bundle or test it.
- **Unavailable tool/source:** report `UNAVAILABLE`, fall back to another authorized route, or mark result PARTIAL. Never invent a backend or claim full coverage.

Credentials and private source content must not be written to this public repository, research evidence, or any publicly accessible logs.

## First executable proof (E0) — PROPOSED, NOT RUN

Before saying SEARCHER is operational *through* this engine, require one real bounded user question with:
1. A frozen brief containing stop/evidence criteria and tool permissions.
2. At least two independently sourced paths or a documented reason one path is unavailable.
3. Map branches with recorded cut and survivor reasons, real `reach[]` chronology and pinned/datetagged `sources[]`.
4. Six-field evidence lines tied to map nodes; all key claims in RESULT refer to a claim ID.
5. CLI validate / validate-evidence / render observed logs and exit codes in an approved environment.
6. One **second researcher** resumes using only brief/map/evidence (not prior chat) and produces a bounded source check.
7. Review records what is SOURCE VERIFIED, what is merely REPORTED, whether any runtime was proven, and unresolved security/license/coverage risks.
8. Artifacts saved to an approved private or public destination according to data classification, never indiscriminately to this public repo.

**E0 acceptance:** at least one real task demonstrates reproducible navigation and evidence handoff, independently reviewed. `CLI PASS` alone is only a schema gate. No automatic code adoption or live scheduling.

## Follow-up engineering backlog — NOT IMPLEMENTED

Only after E0 is reviewed, separate scope and approval for:
- **E1 / capability doctor:** actual per-source availability, health and ordered fallback, without copying user tokens, cookies or secret sessions.
- **E2 / source and query coverage:** reproducible queries, source version freshness, inaccessible sources, negative-claim methods, and basic untrusted-content handling.
- **E3 / contradiction/compare:** independent evidence for incompatible claims, auditable candidate pruning, heuristics used only as prioritization.
- **E4 / resume + WATCH:** stored delta comparisons with explicit freshness, privacy boundaries and a memory retention policy. Automatic monitoring would require separate scheduling/permissions.

No new v0 schema keys, broad adapter infrastructure, license bypass, aggressive scraping, long-running worker, or Agent Reach fork is approved by this document. These are **backlog candidates**, not a locked implementation plan.

## Review / STOP

This guide is ready for bounded review when it can answer: what exists in source, what was actually run, what a replacement executor can do today, what remains unimplemented, and how to prove the first real end-to-end SEARCHER pass.

**DOCS ONLY / VALIDATION NOT RUN / ENGINE NOT DEPLOYED / NO AUTONOMOUS AGENT.**
