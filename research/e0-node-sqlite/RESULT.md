# Bounded source result: Node SQLite at v22.13.0

The pinned API documentation describes SQLite as Stability 1.1 / Active
development [c1], exposes synchronous DatabaseSync operations [c2], and describes
both file-backed and in-memory locations [c3]. The pinned implementation entry
point calls the experimental-warning helper [c4]. These are historical source
findings, not execution results for Node v22.13.0 or claims about current Node.

Interpretation: retain the built-in driver as a candidate, and leave CA-platform
OPEN for actual cross-platform storage validation before choosing E2's runtime
[c5]. The license permits retaining the documentation sample with its notice
[c6]; the license branch was cut as evidence of storage capability, not rejected
for reuse. The original notice is retained in sources/NODE-LICENSE.txt.

STOP: source scope exhausted. No comprehensive package survey, independent
publisher corroboration, storage implementation or runtime SQLite test was
performed. Documentation and implementation are two paths from one publisher.

The map, evidence and source manifest are saved; every claim above points to
an evidence ID. EXECUTION.json records actual CLI outputs and exit codes.
Automated resume succeeds without this file; independent researcher review is
still HOLD under REVIEW-GATE.md. Validators check shape and integrity, not truth.
