# Source Harness E1

Manual, bounded source access for Node >=20. No database, semantic comparison,
scheduler, browser agent or source execution. Frozen Map/Evidence v0 is unchanged.
Observations are leads or publisher statements, not automatically verified facts.

## Install and run (Windows 10/11 PowerShell; Linux equivalent)

```powershell
node --version
npm ci --ignore-scripts --no-audit --no-fund
node tools/run-offline.mjs
node tools/research-engine.mjs --help
node tools/research-engine.mjs doctor --json
node tools/research-engine.mjs discover --source fixture --fixture tests/fixtures/harness.json --json
node tools/research-engine.mjs discover --source github --query "poisk-dvizhok" --json
node tools/research-engine.mjs retrieve --source github --repo VladChok/poisk-dvizhok --ref e9ef2b87cdb62ec8fa00d5774cd78a91b215915f --file README.md --json
node tools/research-engine.mjs discover --source rss --url https://github.blog/feed/ --config harness/config.example.json --json
```

Discovery/retrieval is always an explicit manual operation. `doctor` without
`--live` validates config and reports CONFIGURED/UNCONFIGURED/DISABLED, without
claiming reachability. `doctor --live` probes GitHub /rate_limit and declared
feeds serially under shared quotas. Set individual `adapters` to false to disable.
General web search is UNAVAILABLE / NO_CREDENTIALS: no provider is implemented,
no API access assumed, no SERP scraping, purchases or account creation.

Optional GITHUB_TOKEN comes only from the process environment. Supply a read-only
token yourself; the harness cannot reduce its granted scopes. Token use is limited
to public-only plain-term discovery and doctor. Repo metadata, pinned commits and
exact files stay unauthenticated, preventing token-authorized private retrieval.
Private repos return NOT_FOUND/NOT_PUBLIC. No session/cookie access. Never put
tokens in flags, config, fixtures or public logs.

## Protocol and provenance

`createHarness(config, dependencies)` exposes async `doctor`, `discover(source,
options)`, `retrieve(source, options)` and explicit `fallback(routes, options)`.
Dependencies are a code-only test seam for clock/sleep/DNS/wire fixtures; JSON
config cannot install transports, run scripts or change the GitHub API origin.
[Observation v1](observation.schema.json) is separate from Evidence v0.

Observations contain canonical identity/locator, adapter/type/access route,
observed UTC time, publisher publication/update times, revision/ETag/Last-Modified,
hash, status and limitations. File SHA-256 covers decoded UTF-8 bytes (also checked
against Git's blob SHA). Commit/discovery hashes cover the bounded API response.
Feed entry hashes cover normalized id/title/content/dates/locator; feed metadata
contains a full response hash. HTML/XHTML stays inert source text. Publisher dates
are not independently verified event time and are distinct from retrieval time.

GitHub accepts plain query terms, appends is:public, keeps only explicitly public
items, follows validated Link pagination, deduplicates repo IDs and reports
incomplete/pagination/result limits. Empty results never prove comprehensive
absence. Retrieval requires a 40-hex commit. Directories, submodules and binary/
non-UTF8 files are unsupported. The contents API may represent a symlink target;
the harness does not dereference arbitrary download URLs or recursively crawl.

RSS 2.0/Atom 1.0 feeds must be exact configured `feeds` URLs with allowlisted hosts.
Redirect hosts need explicit allowlisting. Entries use guid/Atom id or link
fallback for stable feed-scoped identity. Missing identities are skipped with
limitations; duplicates keep first occurrence. Invalid dates become null plus a
limitation. Feed update times, Atom xml:base and relative links are supported;
relative links resolve against the final response URL. Linked pages are references
and are never fetched or claimed independently reachable. RSS 1.0/RDF, arbitrary
HTML and external DTD/entities are unsupported. Broken XML fails the whole feed;
malformed individual entries preserve usable items with PARTIAL. XML node/depth
limits bound parsing.

Pass `--etag`/`--last-modified` from a previous response for conditional fetching.
NOT_MODIFIED returns validators with no content/hash: retain your prior good data.
E1 has no hidden persistent cache. It never writes map.json or evidence.jsonl;
a researcher must inspect observations and construct v0 evidence separately.

## Quotas, failure and explicit fallback

Defaults: 10 s wall-clock per HTTP operation including DNS/body/retries/redirects,
1 MiB response, 20 results, 12 HTTP requests per harness session, 3 pages,
3 redirects, 2 retries, concurrency 1, 1 s request spacing. Values have hard
ceilings. Redirect/retry/doctor/fallback requests share the session budget; each
CLI invocation creates a new session. Ctrl+C cancels pending/current work.

401 AUTH_ERROR; ordinary 403 FORBIDDEN; rate-limit 403/429 THROTTLED; 404 NOT_FOUND;
TIMEOUT, CANCELLED, NETWORK_ERROR and safety/size/quota errors are explicit.
Partial pagination retains earlier observations. Provider error bodies, native
exceptions, cookies and auth headers are never logged. CLI also masks the env
token and strips terminal controls from human output; JSON escapes source text.

Transient network/5xx retries use exponential backoff. Retry-After or UTC rate-reset
times take precedence. Waits beyond budget return THROTTLED instead of retrying
early. A rate limit without a hint requires at least 60 s, above default maxWaitMs;
ordinary forbidden responses are not retried. An in-session origin cooldown blocks
other routes from immediately bypassing a throttle. Nothing schedules a later retry.

Fallback routes must be explicitly declared, e.g. routes.example.json:

```powershell
node tools/research-engine.mjs discover --routes harness/routes.example.json --config harness/config.example.json --json
```

Try routes in order under shared quotas until usable observations appear. Retain
each attempt/status/count; using a later route reports PARTIAL. GitHub and RSS
results are not equivalent evidence. Fixtures are used only when explicitly named
and always labeled synthetic. No usable route means UNAVAILABLE, not absence.
Exit codes: 0 OK/NOT_MODIFIED/config report, 1 PARTIAL/unavailable/failure,
2 invalid CLI/config, 130 cancelled.

## Network boundary and verification

HTTPS only, port 443, exact DNS host allowlists; no URL credentials or IP literals.
Resolve all addresses for each hop, rejecting the whole answer if any address is
private/loopback/link-local/multicast/reserved or a disallowed IPv6 transition.
Pin checked addresses into the agent-free HTTPS connection lookup; normal TLS
hostname/certificate checks stay enabled. Each redirect repeats URL/DNS checks.
Validators are scoped to the exact URI and stripped after every redirect,
including same-origin path/query changes; GitHub rejects cross-origin redirects.
Acquisition result `representation` records the request/final URI and conditions
actually sent. Unsolicited or mismatched 304 is UNVALIDATED_NOT_MODIFIED, with no
invented content. Observation and Evidence v0 fields stay unchanged.
Compressed responses are rejected to bound size. No proxy environment, private-LAN
mode, cookies, shell scripts or source execution.

`node tools/run-offline.mjs` blocks Node network APIs in tests and subprocesses.
Fixtures cover success/empty/partial, rebinding, unsafe redirects, streaming bounds,
304, auth/rate errors, retry, timeout/cancel, duplicates and XML/DTD failures.
CI installs locked dependencies first, then runs offline on Windows/Linux and
Node 20/22/24. Separate public smoke, never run by tests/install/CI/plain doctor:

```powershell
node tools/harness-smoke.mjs --live
```

Smoke uses no token, only this public repository and declared github.blog feed;
records measured status/bytes/time/conditionals and does no polling. See
[report](../docs/e1/REPORT.md). Rollback: return to E0 or revert E1; remove
node_modules if uninstalling dependencies. No service, database, runtime data
directory or scheduled task is created. WATCH remains OFF.
