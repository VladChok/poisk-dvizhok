# E1 decision: manual public Source Harness

2026-10-31; scope: issue #4 only, stacked on E0 e9ef2b8. E2–E4 excluded.
E0's independent [source review](https://github.com/VladChok/poisk-dvizhok/pull/3#pullrequestreview-5720651536)
confirmed c1–c6 and snapshot hashes. Its independent CLI-execution gate remains
HOLD; this stage does not promote that review to full acceptance.

## Runtime and dependencies

Keep Node >=20 ESM and node:test. Existing v0 tools and schemas are unchanged.
No SQLite/driver/runtime bump. Add exact dependencies ipaddr.js 2.2.0 (MIT) for
address classification and saxes 6.0.0 (ISC) for strict namespace-aware XML;
transitive xmlchars is locked at 2.2.0 (MIT). npm lockfile carries integrity hashes;
retained notices are in docs/licenses. No lifecycle scripts run during installation.
Clean Windows `npm ci --ignore-scripts --no-audit --no-fund` is recorded separately
from tests; CI covers Windows/Linux × Node 20/22/24.

Saxes upstream is archived; choose its small, pinned, strict parser rather than
writing an ad-hoc XML parser. DTDs are rejected and no external entities are loaded.
Node/depth/byte bounds reduce exposure. ipaddr.js is pinned to a tested version;
the network layer additionally restricts IPv6 to global unicast and excludes
transition/translation/special-use ranges. Updating either package needs fixture
regression tests and a lockfile change, not an automatic dependency update.

## Interfaces and state

`createHarness` exposes doctor/discover/retrieve and explicit bounded fallback.
RSS discover/retrieve are intentionally equivalent: fetch exactly the configured
feed and normalize its entries, never crawl linked pages. Fixture data is inert
JSON with an injectable fake clock; no dynamic modules/scripts from configuration.
The CLI provides human and JSON output, explicit statuses and Ctrl+C cancellation.

Observation v1 is in harness/observation.schema.json, outside frozen evidence v0.
Do not automatically turn search leads into claims. Keep observed/retrieval time,
publisher publication/update times, immutable commit/hash and HTTP validators
separate. 304 is no new content and must not erase a caller's previous baseline.
E1 stores no data and creates no directory by default. Output redirection is an
explicit operator choice; private output belongs outside this public repository.
Migrations and rollback of stored data are therefore not applicable to E1.

## Network and authentication decision

Use Node HTTPS GET with a public-address DNS check on every hop. All DNS answers
must pass. Feed endpoints must be explicitly configured, hosts exactly allowlisted,
and only HTTPS/default port allowed. A custom connection lookup returns only the
checked addresses; no reused agent, implicit proxy or second DNS lookup. TLS
certificate/hostname validation remains enabled. Revalidate all redirects and cap
count/bytes/time/requests. Reject compression. Strip validators across origins;
GitHub operations reject cross-origin redirects outright.

GITHUB_TOKEN is env-only, used for public-only search and /rate_limit doctor.
Search input accepts plain terms so callers cannot replace is:public. GitHub
metadata/commit/file requests deliberately remain unauthenticated, even when a
token is configured: this is a conservative public-only boundary, at the cost of
unauthenticated retrieval rate limits. Tokens are not assumed read-only merely
because this client uses GET. No private-account source access or cookie reading.

Operations and HTTP requests serialize (concurrency 1). Shared session quotas count
retries, redirects, pagination and fallback routes. Transient errors back off
exponentially; rate hints take precedence and waits beyond budget return the
throttled status. No retry in the background. A future watch cannot inherit any
implicit scheduling from this client.

Provider error bodies, cookies, auth headers and native error strings never appear
in summaries. Output source content is inert and the CLI masks the known env token.
General web is UNAVAILABLE / NO_CREDENTIALS, with an explicit note that no optional
provider is implemented. Fallback requires explicit caller routes and retains
failed-attempt summaries; sources are never represented as equivalent evidence.

## Verification and limits

Offline tests run with E0's network-blocking preload. Injected DNS/wire fixtures
exercise rebinding, redirects, pinned lookup, body limits, auth/throttling,
timeouts/cancellation, XML/XXE, pagination/duplicates and partial availability.
Live smoke is a distinct `node tools/harness-smoke.mjs --live` command, never
invoked by CI/tests/install/doctor without --live. It uses no token and emits only
public-source metadata/hashes, not source text or account details.

Known boundaries: no RSS 1.0/RDF, arbitrary web retrieval, binary files, private
repos, enterprise/custom GitHub API origins, hidden cache, database or scheduler.
GitHub contents API may return symlink-target representation. Public URLs in feed
items are references only; no DNS/reachability claim is made for unvisited links.
Rate limits or partial pagination never establish absence. Hashes verify content
identity, not truth, independence, or legal entitlement to republish whole feeds.

Rollback/uninstall: revert E1 or switch back to E0; remove installed node_modules
if desired. No runtime state, scheduled task, service or database needs removal.
WATCH is OFF. No merge or deployment is part of this delivery.

## Primary references inspected before implementation

- [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
  for conditional reads, pagination and bounded rate-limit retry handling.
- [Repository contents API](https://docs.github.com/en/rest/repos/contents?apiversion=2022-11-28)
  for pinned contents, Base64 and documented API representation/size limits.
- [Saxes upstream](https://github.com/lddubeau/saxes) for strict XML, DTD behavior
  and archival status; license retrieved at tag v6.0.0.
- [ipaddr.js upstream](https://github.com/whitequark/ipaddr.js) for IP range handling.
