# E1 delivery report

Issue #4. Base: impl/research-engine-e0-20261031 at
e9ef2b87cdb62ec8fa00d5774cd78a91b215915f, with a clean local checkout after fetch.
Main remained 31448c9 and docs branch e02ba42. E0 Draft #3 was open; E1 has its own
implementation branch and Draft PR targeting E0. Head SHA is recorded in the PR.

E0 review: independent source/hash check PASS; independent reviewer CLI execution
still HOLD. No E0 sign-off is implied by E1 implementation.

## Delivered

GitHub REST public repository discovery, pinned commits/exact UTF-8 files,
pagination, conditional requests, throttling/backoff, provenance and public-only
auth handling. RSS 2.0/Atom 1.0 declared feeds, stable IDs, date metadata, XML
validation, conditional reads, malformed-item/duplicate summaries and no crawling.
Deterministic offline fixtures with fake clock/failures, doctor, enable/disable,
explicit fallback, human/JSON CLI and network/response/request bounds.

The added observation contract is separate from v0. Original schemas, map CLI,
original tests and E0 bundle artifacts are unchanged. No E2 database, E3 semantic
comparison or E4 scheduler is present.

## Verification

- Baseline Windows Node v24.19.0: `node tools/run-offline.mjs`, 22/22 PASS, exit 0.
- Clean Windows `npm ci --ignore-scripts --no-audit --no-fund`: exit 0, three
  locked packages installed; [installation log](INSTALL.txt).
- Final offline execution and exact stdout/stderr/exit codes: [EXECUTION.json](EXECUTION.json).
- Public smoke: [LIVE-SMOKE.json](LIVE-SMOKE.json), explicitly unauthenticated,
  2026-10-31T02:55:21Z–02:55:29Z, 8275 ms, 9 HTTP requests, exit 0.
- Smoke reached public GitHub search, pinned E0 commit and README; conditional
  README returned 304. github.blog RSS returned 200, 10 source items bounded to
  3 results, then a conditional feed request returned 304. No feed content is
  republished in the log. Live Atom and authenticated-token smoke were not run;
  those behavior paths are covered by offline fixtures.
- CI is configured for Windows/Linux × Node 20/22/24; only the actual PR check
  results may be called PASS. See the PR for run links and exact tested head.

The suite includes success/empty, malformed input/XML/DTD, 304, 401/403/404/429,
throttling/backoff/reset, pagination and duplicates, partial-route failures,
DNS/URL/redirect protections and rebinding, pinned connection lookup, stream byte
limits, timeout/cancellation, fake clock, CLI statuses and E0 regressions.
No automatic test uses the network; package installation precedes offline tests.

## Dependencies, limitations and rollback

Node >=20 retained. Locked ipaddr.js 2.2.0 MIT, saxes 6.0.0 ISC and xmlchars 2.2.0
MIT; notices retained. Installation disables lifecycle scripts. See
[ADR](../ADR-E1-SOURCE-HARNESS.md) and [operator guide](../../harness/README.md)
for choices and boundaries.

Public file/commit retrieval intentionally uses unauthenticated limits even with
a token; tokens only support public discovery/doctor. Search is bounded and is
not comprehensive absence proof. No automatic truth verification, persistence,
private sources, general web provider, RSS 1.0, binary files or automatic refresh.
Source item links are not fetched. v0 evidence creation remains a research step.

Runtime data path: none. WATCH: OFF. No service/task registration, merge, deploy,
other-repository writes, credential acquisition or private-account source access.
Rollback by reverting E1/switching to E0; remove node_modules to uninstall packages.
STOP after E1 Draft delivery for OWNER/FRIDAY review.
