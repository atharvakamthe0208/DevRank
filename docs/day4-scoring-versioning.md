# Day 4 scoring versioning

> **Historical v1 record:** This document describes the original six-category `1.0.0` policy. Day 5 removes Communication Skills from active scoring and introduces schema/scoring version `2.0.0`. Its old category and weights are retained here only to explain historical snapshots; see `docs/day5-ai-analysis.md` for current behavior.

## Summary and approval status

The six Day 1 category IDs and display names are unchanged. No team approval is recorded for the role weights, category definitions, or scoring policies. The existing weights therefore remain marked preliminary and pending review in `config/role-weights.json`; this implementation does not describe them as finalized hiring criteria.

Category definitions were reviewed for overlap and clarified below without changing IDs, names, or evidence contracts. The formula and Day 3 missing-evidence behavior are retained and assigned scoring version `1.0.0`.

## Categories and evidence boundaries

| Category ID and name | Purpose | Evidence used |
| --- | --- | --- |
| `technical_skills` — Technical Skills | Job-relevant language, tool, and engineering knowledge. | Technical screens or knowledge checks with an agreed rubric. A project's impact belongs under project experience; a completed job-like work sample belongs under practical assessment. |
| `problem_solving_dsa` — Problem-Solving and DSA | Algorithmic reasoning, decomposition, and complexity/trade-off analysis. | Coding or structured problem-solving assessment. This category is distinct from completing a realistic job task. |
| `relevant_project_experience` — Relevant Project Experience | Relevance, depth, and evidenced impact of related projects. | Project or portfolio review. Do not infer skill from project count alone. |
| `practical_assessment_performance` — Practical Assessment Performance | Performance on a completed, role-relevant task. | Work sample or practical assessment rubric. This does not automatically count as a technical screen too. |
| `communication_skills` — Communication Skills | Clarity and structure in technical explanation and collaboration. | Structured interview or presentation rubric. |
| `learning_adaptability` — Learning Ability and Adaptability | Evidence of learning a new concept/tool or adapting to changed constraints. | Specific learning/adaptation example with a rubric. |

These descriptions clarify intended separation; the team still needs to confirm that they match the assessment plan. Unsupported evidence-to-category assumptions remain excluded by the Day 3 explicit mapping.

## Preliminary role weights

The values in `config/role-weights.json` are unchanged from Day 1 and total 100 for every role:

| Category | Software Developer | AI/ML Engineer | Data Analyst |
| --- | ---: | ---: | ---: |
| Technical Skills | 25% | 25% | 20% |
| Problem-Solving and DSA | 20% | 15% | 15% |
| Relevant Project Experience | 20% | 20% | 20% |
| Practical Assessment Performance | 15% | 15% | 15% |
| Communication Skills | 10% | 10% | 15% |
| Learning Ability and Adaptability | 10% | 15% | 15% |

The rationale is a starting point only: technical knowledge, problem solving, and project evidence receive substantial weight across roles; AI/ML gives extra weight to learning/adaptation; data analysis increases communication; practical task performance remains meaningful for all roles. These are not scientifically validated or final hiring weights. Each team must review the values, role expectations, and assessment rubrics. No owner approval is recorded.

## Formula and missing evidence

For each category, Day 2 calculates the arithmetic mean of available, valid normalized evidence values and rounds that category result to two decimal places. For a complete evaluation:

```text
overall = round2(sum(categoryScore × roleWeight) / 100)
```

The calculation uses the already rounded category scores. `round2` rounds to the nearest hundredth. Scores and weights are validated before calculation; each role must have six non-negative weights totaling exactly 100.

The Day 3 strict completeness policy remains in force: if any category has no valid normalized evidence, return supported category scores and explicit missing category IDs, set `insufficient_evidence`, and omit the overall score. Missing categories are not treated as zero and the remaining weights are not renormalized. Changing this policy would change scores and requires a new scoring version and team review.

Worked example, synthetic candidate 001 (Software Developer):

```text
Category scores: 80, 75, 78, 82, 80, 72
Weights:         25, 20, 20, 15, 10, 10
(80×25 + 75×20 + 78×20 + 82×15 + 80×10 + 72×10) / 100 = 78.10
```

The output reports `overallScore: 78.1`. The category scores and weights are taken from the fixture and shared configuration, respectively.

## Scoring version policy

The role-weight configuration now records `scoringVersion: "1.0.0"`. Every result returned by the deterministic scorer includes that identifier. The response contract adds an optional `scoringVersion` field so legacy Day 1/Day 2 responses without the field continue to validate; new scorer output always provides it. Contract `schemaVersion` remains `1.0.0` and continues to describe the response structure, not the scoring formula.

Only `1.0.0` is supported. An unknown requested/configured version, or a requested version that does not match the supplied weight configuration, fails clearly. A formula, category-definition, or approved-weight change must use a new scoring version; never edit the behavior of an existing version in place. The current configuration file contains only the current version. Historical results retain the score, `scoringVersion`, and exact `roleWeightsUsed` snapshot, but this repo does not retain old formula implementations/configurations and cannot promise to reproduce them.

## Determinism and compatibility

The scoring core uses no randomness, clock, network, or AI call. It sorts normalized values before summing, rounds consistently, does not mutate input evidence or shared role-weight configuration, and preserves evidence references. Repeated calls with identical candidate evidence, configuration, and version return identical results. Reordering evidence does not change numeric scores; evidence arrays and references still preserve their source ordering.

The version field is an additive optional response property. Existing response parsers continue to accept payloads without it. Frontend consumers can optionally display or retain the field; the API route and candidate request are unchanged. Shared contracts and expected output fixtures have been updated, so frontend/backend owners should adopt the latest package before depending on `scoringVersion` as a required field.

## Files changed

- `config/role-weights.json`: add scoring version `1.0.0`; weights remain unchanged and preliminary.
- `packages/contracts/src/scoring.ts`: define scoring-version syntax and require the version in the shared weight configuration.
- `packages/contracts/src/evaluation-response.ts`: add an optional version field for backward-compatible validation.
- `apps/api/src/modules/scoring/index.ts`: validate supported/configured versions and include the version in every scorer result.
- `apps/api/src/modules/evidence-processing/index.ts`: allow the pipeline to select and pass through the scoring version.
- `apps/api/test/scoring.test.ts`: supported/unsupported version, weight-version match, no-mutation, ordering, normal, and boundary tests.
- `apps/api/test/evidence-processing.test.ts`, `packages/contracts/test/contracts.test.ts`, `fixtures/expected-evaluations.json`: version compatibility and fixture assertions.
- `docs/api-contract.md`, `docs/day1-scoring-contract.md`, `docs/day2-scoring-implementation.md`, `docs/day3-evidence-processing.md`, and `docs/scoring-rules.md`: document versioned output and policy.

## Verification results

All commands below passed on 2026-10-11. The API suite passed 34 tests across
three files, and the shared contracts suite passed 9 tests. Both package builds
and the web typecheck passed. `git diff --check` reported no whitespace errors.
Git emitted only its standard LF-to-CRLF working-copy notices for modified files.

Commands:

```sh
npm test --workspace @devrank/api
npm test --workspace @devrank/contracts
npm run build --workspace @devrank/contracts
npm run build --workspace @devrank/api
npm run typecheck --workspace @devrank/web
git diff --check
```

## Decisions awaiting team agreement

- Confirm the category boundaries and evidence rubrics above.
- Approve or revise the preliminary role weights.
- Confirm the category-mean aggregation, nearest-hundredth rounding, and strict all-six-categories completeness policy.
- Confirm that version `1.0.0` is the accepted initial scoring version before using scores for candidate decisions.
- Decide how historical formula/config snapshots will be retained if score reproduction becomes a requirement.

No teammate approval is claimed. Scores remain decision support, not an automatic hiring decision.
