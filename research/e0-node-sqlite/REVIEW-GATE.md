# Separate independent researcher gate — HOLD

No independent second-agent review has been performed or simulated as approval.
The implementation worker's automated fresh-process test is not this review.

Give a separate reviewer only brief.md, map.json, evidence.jsonl, sources.json
and sources/. Withhold RESULT.md, EXECUTION.json and the original conversation.
Provide the CLI checkout as tooling, not prior research context.

1. Run `node tools/research-bundle.mjs inspect <bundle> --json` from a fresh process.
2. Identify both surviving routes, the license cut and the CA-platform resume
   point; explain their reasons from the saved artifacts.
3. Independently reopen the immutable source URLs and inspect c1–c6, line ranges,
   distinctions between author claims/facts/interpretation and the retained MIT notice.
4. Record reviewer identity, UTC time, checkout SHA, commands/exit codes, source
   checks, discrepancies and PASS/PARTIAL/HOLD in the PR review.
5. OWNER/FRIDAY decides acceptance. No merge or WATCH startup is implied.

If a source is unreachable, preserve that limitation and keep this gate HOLD.
CA-platform is further engineering work, not a promise of runtime portability.
