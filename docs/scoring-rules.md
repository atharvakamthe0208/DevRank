# Scoring rules

The active scorer in `apps/api/src/modules/scoring` is deterministic. Schema and scoring version `3.0.0` use the canonical six categories defined in `packages/contracts/src/scoring.ts`; the exact active role weights live in `config/role-weights.json`. They match the original six-category Day 4 rubric and remain preliminary and unapproved. Five-category scoring v2 and original six-category v1 results remain immutable historical formats and are never recalculated as v3.

## Separate GitHub + LeetCode proposal (not active)

`github_leetcode_proposal_v1` defines Project Portfolio (20%), Technical Skills (20%), Development Activity (15%), Collaboration (10%), Current-Year Contributions (10%), and DSA & Problem-Solving (25%). These are proposals only. They do not replace the active v3 categories, modify checked-in role weights, change owner-defined role weights, or reinterpret saved v1/v2/v3 snapshots. See [the full proposal and data rules](proposed-github-leetcode-rubric.md).

GitHub current-year volume is observed in a UTC January 1–December 31 calendar window, with an `observedThrough` timestamp during an incomplete year. Its deterministic normalization reports total contributions per observed UTC week and active-week coverage, rounded to two decimal places. These descriptive rates are not category scores. The calendar total is not added to commit/PR/issue/review breakdowns. Missing or partial data remains unavailable/partial and never becomes zero. GitHub and LeetCode evidence stays unverified platform context and does not enter the active numerical scorer.

## Categories and admissible evidence

| Category | Direct score evidence | Platform context only |
| --- | --- | --- |
| Technical Skills | Rubric-scored technical screen or knowledge check | GitHub primary repository languages; LeetCode solved counts do not establish language proficiency |
| Problem-Solving / DSA | Rubric-scored coding or structured problem-solving assessment | LeetCode solved difficulty and contest snapshot fields; these do not demonstrate reasoning process |
| Relevant Project Experience | Reviewer-scored project or portfolio review | GitHub public repository descriptions, languages, and update timestamps; repository count/popularity are not skill scores |
| Practical Assessment Performance | Completed role-relevant work sample or practical assessment rubric | GitHub/LeetCode profiles are not practical assessments |
| Communication Skills | Structured interview or presentation rubric | GitHub/LeetCode profiles do not establish communication ability |
| Learning & Adaptability | Rubric-scored learning/adaptation example with evidence of a changed constraint or new concept | A single GitHub update timestamp or LeetCode snapshot cannot establish learning or improvement |

`config/evidence-category-mapping.json` is authoritative for direct evidence types. Structured interviews map to Communication Skills. Provider snapshots use a separate typed context contract and supporting category mappings; they do not enter numeric scoring. No GitHub or LeetCode threshold/normalization rule has been approved, so raw counts, popularity, and snapshot changes cannot satisfy a category's scoreable-evidence requirement.

## Calculation and evidence sufficiency

The processing pipeline accepts an already normalized `0–100` `normalizedValue` only after validating evidence and mapping its evidence type to a category. It does not transform provider counts into scores. For each category, the scorer takes the arithmetic mean of available evidence values with valid normalized values and rounds to two decimal places using nearest-hundredth rounding. It requires unique evidence IDs; distinct but correlated reviewer evidence may still receive equal weight, which is a known limitation requiring an approved evidence aggregation policy.

Overall score is calculated only when all six categories have scoreable evidence:

```text
overall = round2(sum(categoryScore × roleWeight) / 100)
```

The weighted calculation uses the rounded category scores and rounds the result to two decimals. If any category is insufficient, available category scores remain visible, missing category IDs are returned, status is `insufficient_evidence`, and `overallScore` is omitted. Missing, unavailable, stale, or unnormalized data is never converted to zero. The partial-evidence renormalization formula is not used.

## Role weights

The weights preserve the original documented six-category Day 4 table and sum to 100 for each role:

| Category | Software Developer | AI/ML Engineer | Data Analyst |
| --- | ---: | ---: | ---: |
| Technical Skills | 25% | 25% | 20% |
| Problem-Solving / DSA | 20% | 15% | 15% |
| Relevant Project Experience | 20% | 20% | 20% |
| Practical Assessment Performance | 15% | 15% | 15% |
| Communication Skills | 10% | 10% | 15% |
| Learning & Adaptability | 10% | 15% | 15% |

These weights are not scientifically validated or approved hiring criteria. The scorer enforces schema and scoring-version agreement, but a product owner still must review and approve the weights before decision use.

## Provider snapshots, AI, and compatibility

Evaluation results store `platformEvidence` separately from rubric-scored `evidence`. The snapshot includes source, evidence ID, candidate ID, observed time, normalized provider fields, verification status, provenance, freshness state, limitations, and supported category mappings. Freshness is marked `unassessed` because no maximum-age policy exists. Candidate-reported and provider-fetched LeetCode values remain distinct. GitHub and LeetCode signals are included as unverified context and passed to the optional AI explanation with explicit limitations; they never become numeric evidence automatically.

The AI receives validated scores and evidence plus bounded platform context. It can explain provided facts but cannot calculate or overwrite scores, weights, evidence, or status. Unsupported and historical scoring formats remain read-only. Role profiles with the previous five-category v2 weights are not silently amended; the API asks the owner to update them with all six v3 weights. No database migration is introduced for the additive JSON snapshot fields; production compatibility still depends on the separately blocked schema/history reconciliation audit.
