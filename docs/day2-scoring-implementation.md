# Day 2 scoring implementation

## Implemented

Added a deterministic scorer in `apps/api/src/modules/scoring/index.ts`. It consumes the Day 1 candidate and normalized evidence shape, reads and validates the shared `config/role-weights.json`, scores categories, calculates a complete weighted score where possible, and validates the final output with `evaluationResponseSchema`. The API routes and request/response contracts are unchanged. The scorer makes no AI or external API calls.

## Rules

- For each category, average all evidence items where `availability` is `available` and `normalizedValue` is present.
- Round each category average to two decimal places using nearest-hundredth rounding. Use those rounded category values in the overall calculation, then round the overall result to two decimal places.
- Evidence with `availability: "missing"`, or available evidence without a normalized value, is preserved in the response but is not scored. No missing value becomes zero.
- When any of the six categories is unscored, return the available category scores, list missing categories, set `evaluationStatus` to `insufficient_evidence`, and omit `overallScore`. This follows the strict Day 1 policy; available weights are not renormalized.
- When all six categories are scored, calculate `sum(category score × category weight) / 100` using the selected role's shared weights.
- Invalid candidate input, normalized values, evidence IDs, or role-weight configuration throws `ScoringValidationError`. Evidence IDs must be unique in a candidate input. Output is checked against the Day 1 response schema before it is returned.
- Deterministic scoring does not create confidence estimates or AI explanations. Confidence is omitted. The required explanation field explicitly says no AI-generated explanation was produced.

The arithmetic mean for multiple evidence items and nearest-hundredth rounding are simple MVP rules because Day 1 did not define aggregation or rounding. They are deterministic and documented, but require team review before production use.

## Example

Input: `synthetic-candidate-001` in `fixtures/dummy-candidates.json` has one normalized evidence item per category. For Software Developer, its category scores are 80, 75, 78, 82, 80, and 72. Applying the shared weights (25, 20, 20, 15, 10, 10) gives:

```text
(80×25 + 75×20 + 78×20 + 82×15 + 80×10 + 72×10) / 100 = 78.10
```

Its response has schema version `1.0.0`, six scored categories, evidence references for each, `evaluationStatus: "completed"`, and `overallScore: 78.1`. Candidate 004 has five scored categories and missing communication evidence, so its response has no overall score. Candidate 005 has all six categories missing and also has no overall score.

## Files

- Added `apps/api/src/modules/scoring/index.ts` for scoring and config loading/validation.
- Added `apps/api/test/scoring.test.ts` with normal, fixture, role weight, determinism, missing evidence, malformed input, score/weight boundaries, rounding, and response contract cases.
- Added `apps/api/test/api-compatibility.test.ts` to exercise the existing health and 404 responses over a local ephemeral HTTP server.
- Updated `apps/api/package.json` so the test command runs the scoring tests without pass-with-no-tests masking failures.
- Exported the `RoleWeightConfiguration` type from the shared contracts package.
- Updated `docs/scoring-rules.md`; no API routes or response schemas were changed.

## Verification results

Executed on 2026-10-10:

- `npm test --workspace @devrank/api` — passed, 15 tests (13 scoring, 2 API compatibility).
- `npm test --workspace @devrank/contracts` — passed, 8 tests.
- `npm run build --workspace @devrank/contracts` — passed.
- `npm run build --workspace @devrank/api` — passed.
- `npm run typecheck --workspace @devrank/api` — passed.
- `npm run typecheck --workspace @devrank/web` — passed.

Vitest required filesystem access outside the Windows sandbox because its source resolver returned `EPERM` inside the sandbox. The tests passed when run with that access. The runtime used Node 26.7.0, while the repository declares Node 20 through 24; npm printed an engine warning. Re-run on a supported Node version before integrating into CI.

Commands:

```sh
npm test --workspace @devrank/api
npm test --workspace @devrank/contracts
npm run build --workspace @devrank/contracts
npm run build --workspace @devrank/api
npm run typecheck --workspace @devrank/api
npm run typecheck --workspace @devrank/web
```

## Compatibility, limitations, and decisions

The only current API route remains `GET /health` with its existing response. No routes were modified. Frontend and backend consumers can continue importing the same Day 1 response schema and see deterministic results from the scorer once the backend owner chooses to integrate it. This task does not add an evaluation endpoint, persistence, source verification, a normalization rubric, or a live AI explanation provider.

The category mean treats each valid normalized item equally; evidence quality, recency, source reliability, and duplicate assessment handling are not weighted. Preliminary role weights and the strict requirement for all six categories need team agreement. The team should also review whether category averaging and two-decimal rounding are appropriate before production use. No teammate approval is claimed here.
