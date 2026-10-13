# Scoring rules

The active scorer is in `apps/api/src/modules/scoring`. It uses the five categories in `packages/contracts` and versioned role weights from `config/role-weights.json`. Current contract schema and scoring versions are `2.0.0`. Role weights and rubrics remain preliminary; no team approval or scientific validation is recorded.

The active category IDs are `technical_skills`, `problem_solving_dsa`, `relevant_project_experience`, `practical_assessment_performance`, and `learning_adaptability`. Communication Skills is not an active category. Structured interview evidence is retained in the Day 3 processing report as unmapped and does not get reassigned to another category.

For a category with multiple evidence items, score is the arithmetic mean of available evidence items with valid normalized values. Each category mean is rounded to two decimal places using nearest-hundredth rounding. Missing evidence or an available item without a normalized value does not participate and is never converted to zero. An invalid item or weight configuration causes a clear `ScoringValidationError`.

Overall score is calculated only when all five category scores exist: `sum(category score × role weight) / 100`. It is rounded to two decimal places after weighting the already rounded category scores. If any category is missing, the response includes available category scores and missing category IDs, sets `insufficient_evidence`, and omits `overallScore`. The scorer does not infer performance from missing information.

When Communication Skills was removed, the previous preliminary role weights no longer totaled 100. The current configuration rescales each remaining role's weights proportionally: each weight is `old weight ÷ sum of that role's remaining weights × 100`, rounded to the nearest 0.01 percentage point using the largest-remainder method, with scoring-category order as the tie-break. This preserves the relative weights among remaining categories and yields exactly 100. The values remain explicitly preliminary; this mathematical normalization is not team approval of hiring policy.

Every new deterministic result reports scoring version `2.0.0` and response schema version `2.0.0`. Unsupported or mismatched scoring versions fail. Persisted v1 response snapshots can still be read through a separate historical validator; v1 is not supported for new scoring, and the repository has no historical scoring implementation/configuration archive to reproduce scores.

The deterministic scorer does not call AI. Optional AI analysis is added separately by the evaluation repository and cannot supply or change scores, weights, evidence, or deterministic evaluation status. AI failure is represented by a separate analysis status while the deterministic result is retained. See [Day 5 AI analysis](day5-ai-analysis.md) for its grounding and failure rules.
