# Day 6 — Scoring consistency, ties, and QA

## Current implementation boundary

The repository has a deterministic scoring module, an evidence validation/normalization/mapping pipeline, an optional AI analyzer, evaluation persistence/API routes, and `candidateRankingSchema`. It does **not** have a ranking comparator, ranking service, ranking endpoint, or ranking UI. `candidateRankingSchema` validates a single `{ candidateId, rank, score }` object; it does not establish how ranks are assigned, enforce unique IDs across a group, or define tie handling.

No ranking policy is approved in the repository. This QA does not invent one. Equal numeric scores remain equal; no score is perturbed. A future ranking display must get a product decision on competition ranking (e.g. shared rank), dense ranking, or score-group presentation. Candidate ID may be approved as display ordering only, never as evidence of qualification. Incomplete evaluations have no overall score and therefore cannot be placed in a numeric order until the team defines a separate presentation policy.

## Tied scores

`apps/api/test/day6-qa.test.ts` exercises two and three candidate score ties, including equal overall results with different category scores, identical category scores, unequal evidence record availability, and values that round to the same two-decimal score. It verifies candidate input permutation does not alter the per-candidate score map. It also confirms the existing single-item ranking schema can represent equal rank values; this is schema capability only, not an implemented ranking behavior.

The existing scorer never uses candidate ID or evidence count to adjust numeric scores. Candidates must share the same role/configuration/version for meaningful comparison. The absent ranking layer currently performs no compatibility check, de-duplication, ordering, or invalid-entry exclusion.

## Incomplete evidence

The v2 scorer reports each missing category ID, keeps category scores that do have valid normalized evidence, omits `overallScore` whenever one or more categories are insufficient, and retains the configured weights without renormalizing them. All five missing categories produce an insufficient-evidence evaluation and no score. Evidence with missing availability or without normalized values does not contribute. Invalid evidence is rejected by the evidence-processing layer; usable evidence from other sources remains available.

A missing score is not zero and is not a low rank. There is no rank result for incomplete candidates because no ranking function exists. AI unavailability/failure is tested separately by `apps/api/test/ai-analysis.test.ts`; its result is attached separately and does not replace deterministic scores.

## Consistency guarantees and limits

The scorer uses the established v2 formula: average each category's available normalized values, round category values to two decimals, and calculate the weighted sum only when all five categories have scores, rounded to two decimals. Tests cover repeatability, evidence-order independence of numeric scores, unique evidence IDs, score boundaries, weight validation, version rejection, response-schema validity, and five active categories. Day 6 tests add equal-score and incomplete-evidence cases. `communication_skills` is not an active category; legacy read-only validation remains separate.

These checks establish deterministic behavior for the current code, not validity/fairness of the preliminary rubrics or role weights. The SRS and team approval are still missing.

## End-to-end coverage actually achieved

The deepest newly exercised path is in-process `processCandidateEvidence` through validation, mapping, scoring, and evaluation-response validation. Tests use synthetic fixtures and no provider credentials. AI analysis is separately tested with mocked fetch. Repository tests cover persistence and API routes, but in this environment API route tests that create loopback listeners are blocked by sandbox TCP access. No browser-to-database-to-ranking flow can be claimed: ranking UI/service does not exist, and no live Supabase/provider call was made.

## Shared contract/API coordination

No shared contract or API shape was changed for Day 6. Before implementing ranking, coordinate with API, web, and product owners on:

- Ranking response shape and whether tied candidates share ranks or appear in score groups.
- Whether candidate ID is permitted solely for deterministic display order.
- How incomplete evaluations appear and whether they are omitted, grouped separately, or reported as unranked.
- Rejection/exclusion behavior for duplicate candidates, invalid evaluations, role mismatch, and scoring-version mismatch.
- Whether ranking is a persisted resource or derived response and how it is authorized.

The existing `candidateRankingSchema` is insufficient to answer these policy questions; do not treat it as team approval.

## Verification

- New `apps/api/test/day6-qa.test.ts`: 8 focused tests pass.
- Focused rerun of Day 6, scoring (18), evidence-processing (16), and AI analysis (11) suites: 53/53 passed. Contract tests: 10/10 passed.
- On 2026-10-13, full `npm test` produced web 32/32 and contracts 10/10; API 101/153 passed. The other 52 API route tests failed to start local HTTP listeners with sandbox `EACCES` to `127.0.0.1`.
- `npm run typecheck` passed after the Day 6 additions.
- `npm run build`: contract and API builds passed, but Vite could not resolve a Supabase dependency due to sandbox `EPERM`. No live services were contacted.

## Blockers and next steps

1. Product/team approval is needed for ranking ties, display-only tie-breaks, and incomplete-evaluation presentation.
2. Define compatibility rules for role/scoring-version mismatches and invalid/duplicate ranking entries before implementing ranking.
3. Provide the approved SRS and approve scoring categories, normalization policy, and preliminary weights.
4. Run API HTTP integration tests in an environment permitting loopback listeners, then test browser-to-database flows against a controlled Supabase project.
5. Implement ranking only after policy and API contract decisions; this Day 6 task intentionally did not add a ranking endpoint or dashboard.
