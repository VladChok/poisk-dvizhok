# poisk-dvizhok

> Bootstrap repository for the Cloudberry / Structura Research Engine.

**STATUS:** EARLY / BOOTSTRAP

`poisk-dvizhok` is shared Research Engine infrastructure used by interchangeable Research and News roles. It is not one researcher-agent. It is intended to become the common environment in which different agents can use the same research method, reach sources, preserve evidence, recover prior context, and hand work to the next researcher.

```text
ROLE ≠ ENGINE ≠ EXECUTOR

RESEARCH / NEWS roles
        ↓ use
RESEARCH ENGINE
├── METHOD
├── SOURCE HARNESS
├── EVIDENCE
├── MEMORY
└── LEGEND
```

This repository contains bootstrap context **plus a Map/Evidence v0 contract, JSON schemas and a source-level CLI implementation** for validating, rendering and saving research maps. It does **not** yet provide a complete operational research engine: no bundled source adapters, automatic source verification, durable memory service, background monitoring, or frozen full architecture. The CLI's presence does not by itself prove runtime success in an arbitrary executor environment.

## Why it exists

Research agents change, but they repeatedly need the same foundations:

- a scoped question and an explicit stop condition;
- access to relevant primary sources;
- source identity, citations, dates, and limitations;
- a distinction between evidence and interpretation;
- memory of previous findings and open questions;
- a handoff that another researcher can continue.

The purpose of the engine is to make those foundations shared and durable instead of rebuilding them for every agent.

## Bootstrap parts

- **METHOD** — the structure of a research assignment and its result. See [RESEARCH-METHOD.md](RESEARCH-METHOD.md).
- **SOURCE HARNESS** — mechanisms that let an agent reach and inspect sources. See [harness/README.md](harness/README.md).
- **EVIDENCE** — material and provenance supporting a research conclusion. See [research/README.md](research/README.md).
- **MEMORY** — prior findings, known sources, limitations, and open questions. See [memory/README.md](memory/README.md).
- **LEGEND** — shared research terms when real work establishes a need for them. See [LEGEND.md](LEGEND.md).
- **MAP / EVIDENCE CONTRACT v0** — frozen shape of `map.json` and `evidence.jsonl`: [contract](docs/CONTRACT-research-map-evidence-v0.md), [schemas](schema/), CLI `node tools/research-map.mjs validate | validate-evidence | render | save`.
- **SEARCHER INTEGRATION v0 (proposed, docs only)** — [operating boundary and E0 proof gate](docs/SEARCHER-INTEGRATION-v0.md). SEARCHER is a **role consuming** the engine; this document does not install a skill, run a worker or add source adapters.

The current architectural hypothesis is recorded in [Architecture notes](docs/ARCHITECTURE-NOTES.md).

## Upstream donor

[Agent Reach](https://github.com/Panniantong/Agent-Reach) has completed an initial source-first donor review for source and platform access mechanisms.

No upstream code has been imported. The current direction is to treat Agent Reach as an external source capability and pattern donor rather than a Research Engine base; this is not yet a frozen integration decision. See [Source Harness review](docs/REVIEW-source-harness-agent-reach.md) and [Upstreams](docs/UPSTREAMS.md).

## Next review

The Agent Reach source-first review and Map/Evidence contract work are documented. The next operational gate is a **real bounded research probe with a second-executor handoff** using the existing contract and CLI, as described in [SEARCHER integration](docs/SEARCHER-INTEGRATION-v0.md). Do not describe source adapters, automated access, memory or monitoring as working until independently tested and reviewed.

```text
SOURCE REVIEW (documented)
      ↓
MAP / EVIDENCE CONTRACT v0 (source exists)
      ↓
SEARCHER ROLE / ENGINE BOUNDARY (documented)
      ↓
ONE AUTHORIZED REAL RESEARCH TASK + CLI EVIDENCE
      ↓
SECOND-EXECUTOR RESUME + REVIEW
      ↓
RESEARCH ENGINE OPERATIONAL CLAIM (only if proven)
```

Until that bounded review and real probe happen, this repository remains evidence and scaffolding—not an answer disguised as a frozen architecture.
