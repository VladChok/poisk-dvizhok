# Architecture Notes

**Status:** current hypothesis; not frozen

The bootstrap hypothesis is:

```text
RESEARCH ENGINE
├── METHOD
├── SOURCE HARNESS
├── EVIDENCE
├── MEMORY
└── LEGEND
```

- **Method** scopes the question, required evidence, and stop condition.
- **Source Harness** provides mechanisms for reaching and inspecting sources.
- **Evidence** preserves source identity, citations, dates or versions, and limitations.
- **Memory** lets later researchers recover relevant findings, known sources, rejected ideas, and open questions.
- **Legend** provides shared research language when validated terms emerge from use.

## Boundaries

The Source Harness is not the Research Engine. Access to a platform does not establish that a result is trustworthy, relevant, remembered, or ready for handoff.

Agent Reach is being considered only as a donor for source-access mechanisms and patterns. No integration mode has been selected, and its architecture is not automatically the architecture of this project.

The full Research Engine architecture is not frozen. It should be shaped by source inspection, the current Research / News workflow, and evidence from at least one real research task.


## Reviewed direction — 2026-09-26

The initial Agent Reach source review supports the following boundary:

```text
RESEARCH / NEWS ROLE
        ↓ uses
RESEARCH ENGINE
        ↓
SOURCE HARNESS
        ↓ may use
Agent Reach / native connectors / future adapters
```

Agent Reach is currently a SOURCE HARNESS donor/capability candidate, not the base architecture of the Research Engine.

The current integration candidate is **external capability + selective adoption of stable patterns**, not a fork.

Stable donor patterns observed:

- channel registry;
- ordered backend candidates;
- active backend;
- real health probe;
- doctor/status;
- fallback routing.

The Research Engine must retain ownership of METHOD, EVIDENCE and MEMORY semantics even when source access is delegated externally.

See [REVIEW-source-harness-agent-reach.md](./REVIEW-source-harness-agent-reach.md).

This is still not Research Engine v0.
