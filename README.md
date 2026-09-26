# poisk-dvizhok

> Bootstrap repository for the Cloudberry / Structura Research Engine.

**STATUS:** EARLY / BOOTSTRAP

`poisk-dvizhok` is the shared Research department for interchangeable Research and News agents. It is not one researcher-agent. It is intended to become the common environment in which different agents can use the same research method, reach sources, preserve evidence, recover prior context, and hand work to the next researcher.

```text
DEPARTMENT = ENGINE

RESEARCH ENGINE
├── METHOD
├── SOURCE HARNESS
├── EVIDENCE
├── MEMORY
└── LEGEND
```

This repository currently contains only the bootstrap context and empty working areas. It does not yet provide a working research engine, source adapters, automated verification, or a frozen architecture.

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

The current architectural hypothesis is recorded in [Architecture notes](docs/ARCHITECTURE-NOTES.md).

## Upstream donor

[Agent Reach](https://github.com/Panniantong/Agent-Reach) is registered as a donor under review for source and platform access mechanisms.

No decision has been made to fork it, add it as a dependency, vendor it, or port parts of it. No upstream code has been imported into this repository. See [Upstreams](docs/UPSTREAMS.md).

## Next review

The next step is a source-first review of Agent Reach and the current Research / News workflow. That review should compare integration choices and maintenance cost before Research Engine v0 is designed.

```text
SOURCE REVIEW
      ↓
FORK vs DEPENDENCY vs SELECTIVE PORT
      ↓
ONE REAL RESEARCH TASK
      ↓
EVIDENCE FROM USE
      ↓
RESEARCH ENGINE v0
```

Until that review happens, this repository is a place to preserve the question and collect evidence—not an answer disguised as an architecture.
