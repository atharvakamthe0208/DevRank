# Final GitHub + LeetCode evaluation report · v4

The evaluation detail page and Insights dashboard show a final v4 report derived from the saved platform evidence snapshot. The report is persisted with each evaluation result and is never refreshed from providers while rendering. Later syncs require a new evaluation to affect a result.

## Deterministic formulas

These formulas create deterministic source-volume and breadth indexes. They are not calibrated competency, code-quality, identity, or hiring-suitability scores. Snapshot dates and evidence coverage matter when comparing values.

| Category | Active index | Required source coverage |
| --- | --- | --- |
| Project Portfolio | `100 × min(1, ln(1 + public repository count) / ln(11))` | Complete GitHub repository snapshot. Quantity proxy only; no role relevance or quality inference. Stars/forks excluded. |
| Technical Skills | `100 × min(1, distinct observed repository languages / 5)` | Complete, untruncated repository snapshot with language metadata. Breadth is not proficiency. |
| Development Activity | `100 × min(1, ln(1 + commit contributions) / ln(251))` | Complete attributable commit activity. Volume is not quality. |
| Collaboration | Mean of `100 × min(1, ln(1 + count) / ln(51))` for pull requests opened, issues opened, and reviews submitted | All three counts in a complete response. Counts stay separate; missing signals are not substituted. |
| Current-Year Contributions | `100 × active observed UTC weeks / observed UTC weeks` | Complete contribution-calendar snapshot with both week counts. Calendar/type totals are context, not extra scored volume. |
| DSA & Problem-Solving | `100 × min(1, ln(1 + difficulty-weighted solved count) / ln(301))`; easy=1, medium=2, hard=3 | Complete LeetCode solved snapshot. If all difficulty counts are absent, provider total is used and labeled as a fallback. Contest metrics are context only. |

Category indexes are rounded to two decimals. Each displayed weighted-points value is `index × category weight / 100`, rounded to two decimals. The overall score matches the active scorer: it sums the full-precision products of each rounded category index and its weight, then rounds the aggregate once to two decimals, only when all six categories have complete scoreable evidence. Because displayed category points are rounded individually, their displayed sum can differ from the overall score by a cent. A candidate with no LeetCode username and no saved LeetCode snapshot gets a policy-defined DSA index of zero without a fabricated evidence reference; a configured username with no saved snapshot remains unscored. A complete repository snapshot with zero observed languages also yields zero from the existing formula. Other missing and partial required values are never converted to zero, and remaining weights are never renormalized.

The DSA index reaches 100 at 300 difficulty-weighted solved problems and remains capped above that threshold (100 easy + 92 medium + 16 hard = 332 and yields 100). The 300-point cap requires future calibration. It is an evidence-volume index, not a competency score.

## Evidence shown beside the indexes

The report includes available source values such as repository names, languages, active commit days/weeks, active contribution weeks, contribution totals/types, LeetCode easy/medium/hard counts, and capture times. Contribution-calendar totals and the separate type totals overlap; they are never summed together. Development Activity uses commit-volume patterns while Current-Year Contributions scores active-week distribution, preventing a second calendar-volume score.

GitHub/LeetCode snapshots remain unverified and freshness is unassessed. Candidate-reported LeetCode values are separate from provider-fetched values; provider evidence is preferred for the DSA index when available. A mathematically complete report does not establish candidate identity, code quality, engineering competence, or hiring suitability.

Dashboard and saved-evaluation detail pages render the snapshot stored on that evaluation. Historical v1/v2/v3 evaluation results remain unchanged and use their historical categories. The active v4 rubric does not recalculate those records.
