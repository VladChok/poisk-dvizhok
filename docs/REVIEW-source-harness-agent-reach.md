# Source Harness Review — Agent Reach

**Date:** 2026-09-26  
**Status:** reviewed direction; not a frozen Research Engine v0 architecture

## Question

What is Agent Reach actually useful for inside the Cloudberry / Structura Research Engine, and should it become a fork, dependency/capability, or selective code donor?

## Source-first findings

Reviewed upstream: [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach), default branch `main`.

Observed mechanisms include:

- a channel registry with one platform/capability per channel;
- ordered backend candidates with an `active_backend`;
- user override without hiding fallback backends;
- real lightweight probes rather than `which()` alone;
- doctor/status aggregation where one broken channel does not collapse the whole report;
- skill instructions that route agents to the active upstream tool;
- direct use of upstream tools for actual reads/searches rather than forcing all source data through one Agent Reach API;
- platform-specific installation, login, browser/CDP and recovery logic.

Upstream license was verified from `LICENSE` and `pyproject.toml` as MIT.

No upstream code has been copied into this repository.

## Boundary

Agent Reach is a good donor for the **SOURCE HARNESS** layer.

It is not a complete Research Engine.

It primarily answers:

> How can the agent reach this source now, and which backend is actually usable?

The Research Engine still needs to own the surrounding concerns:

```text
QUESTION / METHOD
       ↓
SOURCE HARNESS
       ↓
source access
       ↓
EVIDENCE
source identity / version / limitations
       ↓
MEMORY
       ↓
handoff / reuse
```

Agent Reach deliberately leaves actual reads/searches to upstream tools such as `gh`, `yt-dlp`, `mcporter`, OpenCLI and platform-specific CLIs. Therefore it does not provide one canonical provenance/evidence contract for the Research Engine.

## Integration direction

### Forked base

**Not recommended at this stage.**

Reason: the upstream owns a fast-changing platform-integration surface: cookies, browser/CDP behavior, anti-bot failures, CLI/API renames, dependency pins, install flows and per-platform recovery logic. Forking would transfer that maintenance burden to this project.

### External capability / dependency

**Current candidate.**

Keep Agent Reach outside the Research Engine as a maintained source-capability provider where it is useful.

### Selective pattern adoption

**Current candidate.**

Stable patterns worth considering independently of the upstream implementation:

```text
CHANNEL
ordered backends
active backend
real health probe
doctor
fallback
```

Do not copy platform implementations merely to own them.

## Role / engine boundary

Do not use:

```text
DEPARTMENT = ENGINE
```

Use:

```text
ROLE ≠ ENGINE ≠ EXECUTOR

RESEARCH / NEWS roles
        ↓ use
RESEARCH ENGINE
        ↓ may use
SOURCE CAPABILITIES / Agent Reach
```

Structura owns the stable role contracts. This repository may implement shared operational infrastructure used by those roles.

## Method boundary

`Structura/docs/roles/RESEARCH.md` defines **how the Research role is responsible for working**.

`RESEARCH-METHOD.md` in this repository should define the **operational brief/result shape implemented by the Research Engine**.

The engine must not silently create a second conflicting definition of the Research profession.

## What remains open

Not yet designed or frozen:

- Research Engine v0;
- EVIDENCE schema/contract;
- MEMORY format and retention rules;
- a normalized source result object, if one is needed at all;
- the exact Agent Reach installation/integration mechanism;
- which existing Structura News/Research archive responsibilities should remain there;
- source adapter interfaces.

## Next evidence

Before v0 is designed:

1. review the existing Structura Research / News workflow against these boundaries;
2. inspect the layered-context research once its evidence package is published;
3. choose one real research task as a probe;
4. derive the minimum v0 contract only from what the probe actually requires.
