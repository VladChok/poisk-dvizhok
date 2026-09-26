# Stalactite Search Method — v0 working method

**Date:** 2026-09-26  
**Status:** accepted working method for the first Research Engine probe; intentionally minimal, expected to evolve from use.

## Core idea

Research should not begin by opening every source deeply.

It should narrow the search space in visible layers.

Useful analogy: a stalactite grows downward layer by layer. A research branch does the same:

```text
L0 — FIELD
broad external landscape
        ↓
L1 — CLUSTERS
major approaches / categories
        ↓
L2 — CANDIDATES
specific products / papers / repositories
        ↓
L3 — SURVIVORS
active / relevant / credible-enough candidates
        ↓
L4 — WATCH / DEEP DIVE
the few sources worth opening deeply or following over time
```

Many branches may grow in parallel.

The researcher descends only when the previous layer gives a reason to descend.

## Research Map

The output is not only a final answer.

Each project can retain a **Research Map / Search Map** that records how the search space narrowed.

```text
                FIELD
                  │
       ┌──────────┼──────────┐
       ↓          ↓          ↓
    cluster A  cluster B  cluster C
       │          │          │
    candidates  candidates  candidates
       │                     │
    survivor               survivor
       │                     │
     WATCH                 DEEP DIVE
```

A branch can be:

- continued later;
- stopped at the current depth;
- reopened if new evidence appears;
- expanded sideways from an earlier layer;
- refreshed without repeating the whole investigation.

The map is durable project context, not disposable search history.
Levels = the `level` field of the map (`FIELD | CLUSTER | CANDIDATE | DEEP_DIVE`; WATCH is a status), see [CONTRACT](CONTRACT-research-map-evidence-v0.md).

## Search progression

For a typical technology/repository question:

### Layer 0 — FIELD

Understand what the thing is and what vocabulary the outside world uses for it.

Goal: learn the search space, not solve the problem.

### Layer 1 — CLUSTERS

Group the space into recognizable approaches, product classes, techniques, or communities.

Goal: avoid comparing unrelated things as if they were equivalent.

### Layer 2 — CANDIDATES

Find concrete candidates.

Cheap triage signals may include:

- repository activity;
- stars/forks only as popularity signals, not proof of quality;
- release freshness;
- active maintainers;
- mentions in other sources;
- community discussion;
- whether people appear to use it in practice.

At this depth, do not read every codebase.

### Layer 3 — SURVIVORS

Remove obviously stale, irrelevant, abandoned, purely promotional, or unsuitable candidates.

Record why a branch was cut.

### Layer 4 — WATCH / DEEP DIVE

Only now open the few survivors deeply:

- source code;
- specific commits;
- architecture;
- tests;
- issues;
- detailed reviews;
- reproducible experiments.

Not every task needs this level.

## Stop at any layer

A research task may stop as soon as its question is answered.

```text
FIELD may be enough
CLUSTERS may be enough
CANDIDATES may be enough
DEEP DIVE only when justified
```

Depth is driven by the decision, not by a desire to inspect everything.

## Parallel agents

Parallel agents are useful when they cover different parts of the map rather than duplicating the same blind search.

Examples:

```text
agent A → GitHub / repositories
agent B → papers / technical writing
agent C → community / reviews
agent D → product / adoption signals
```

Their output should merge into the same Research Map.

The map should show **where each branch came from and why it survived**, not only produce a pile of links.

## Relationship to METHOD

A research brief still begins with:

```text
QUESTION
WHY IT MATTERS
SCOPE
EVIDENCE NEEDED
STOP CONDITION
```

Stalactite Search answers a different question:

> How should the researcher progressively narrow the source space?

It is therefore one working search strategy inside METHOD, not the whole Research role.

## Relationship to SOURCE HARNESS

Source tools remain external capabilities.

Examples:

- Agent Reach;
- GitHub tools;
- web search;
- browser/connectors;
- future source-specific tools.

The method chooses **where and how deeply to search**. The Source Harness provides **physical access**.

## Relationship to EVIDENCE

The Research Map records the search path.

EVIDENCE records what supports a conclusion.

They are related but not identical.

```text
RESEARCH MAP
why this branch exists / survived

EVIDENCE
what exact source supports this claim
```

A discarded candidate can remain in the Research Map without becoming evidence for the final result.

## Future slots — deliberately not designed yet

The architecture should leave room for future capabilities without implementing them now:

### SOURCE TRUST / SECURITY

A later source-safety layer may help agents avoid or quarantine:

- prompt injection in retrieved content;
- malicious repository instructions;
- poisoned or deceptive sources;
- unsafe downloads;
- untrusted scripts;
- compromised or suspicious domains.

It may also maintain known-good sources and source policies.

**No security subsystem is designed in v0.**

### SEARCH HEURISTICS

More sophisticated strategies may later be added:

- domain-specific query generation;
- better candidate scoring;
- source reputation;
- historical success of a search route;
- automatic refresh/watch policies.

**No generic search intelligence framework is designed in v0.**

### ADDITIONAL SOURCE TOOLS

New source adapters/tools should fit beside existing ones rather than expanding one monolithic tool.

## v0 rule

Keep the first prototype simple:

```text
QUESTION
   ↓
RESEARCH MAP
   ↓
progressive narrowing
   ↓
a few survivors
   ↓
EVIDENCE
   ↓
RESULT / STOP
```

The method should be improved from real research tasks, not completed in advance.
