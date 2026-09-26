# Upstreams

## Agent Reach

- **Repository:** [Panniantong/Agent-Reach](https://github.com/Panniantong/Agent-Reach)
- **Status:** donor / initial source review complete
- **Default branch observed at bootstrap:** `main`
- **Upstream license reported at bootstrap:** MIT
- **Local snapshot:** not cloned
- **Code imported here:** none

Agent Reach is being studied as a possible source of platform-access mechanisms and patterns: channel registration, source adapters, fallback backends, installation and configuration, health checks, and agent-skill integration.

Registration as a donor is not a frozen integration decision. Initial review currently favors using Agent Reach as an external capability while selectively adopting stable patterns. Forking is not recommended at this stage because it would transfer fast-changing platform/login/browser maintenance into this project.

## Reviewed direction

```text
Current candidate:

B. external dependency / capability donor,
plus selective adoption of stable patterns from C where justified by a real probe.

A forked base is not recommended at this stage.
```

This remains a candidate until a real Research Engine probe proves which capabilities are actually required. See `REVIEW-source-harness-agent-reach.md`.
