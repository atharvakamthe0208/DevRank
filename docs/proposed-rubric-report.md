# Proposed GitHub + LeetCode report

The evaluation detail page and Insights dashboard can show a **draft evidence index** derived from the platform evidence saved with each evaluation. The proposed category weights are applied only to this separately labeled report. This report does not change active v3 scoring, saved v1/v2/v3 snapshots, comparisons, rankings, or hiring decisions.

Each report is generated from that evaluation's immutable evidence snapshot. Syncing a platform later does not rewrite an existing evaluation; run a new evaluation to capture newly synced values.

The dashboard reads only the latest ten evaluation rows already scoped to the authenticated owner. The additional snapshot lookup is also filtered by that owner and those evaluation IDs. If the result column is unavailable in a local deployment, the regular dashboard remains usable and proposal values are labeled unavailable.

## Deterministic draft formulas

These formulas are transparent draft normalizations of evidence volume or metadata. They are not calibrated competency scores, have no benchmark validation, and must not be used to infer code quality, engineering competence, candidate identity, or hiring suitability. Snapshots from different dates or with different coverage are not comparable.

| Proposed category | Draft evidence index | Required source coverage |
| --- | --- | --- |
| Project Portfolio | `100 × min(1, ln(1 + public repository count) / ln(11))` | Complete GitHub repository snapshot. This measures quantity only; it does not judge role relevance or quality. Stars/forks are excluded. |
| Technical Skills | `100 × min(1, distinct observed repository languages / 5)` | Complete repository snapshot with at least one language. Language breadth is not proficiency. |
| Development Activity | `100 × min(1, ln(1 + commit contributions) / ln(251))` | Complete attributable commit activity. Commit volume is not quality. |
| Collaboration | Mean of the three indexes `100 × min(1, ln(1 + count) / ln(51))` for pull requests opened, issues opened, and reviews submitted | All three activity counts must be present in a complete response. The counts remain separate; none is substituted for missing data. |
| Current-Year Contributions | `100 × active observed UTC weeks / observed UTC weeks` | Complete contribution-calendar snapshot with both week counts. This scores distribution only; the calendar total and type breakdowns are displayed as context, never added or scored here, avoiding a second score for commit volume already used by Development Activity. |
| DSA & Problem-Solving | `100 × min(1, ln(1 + difficulty-weighted solved count) / ln(301))`; easy=1, medium=2, hard=3. If the provider gives only a total, that total is used as the fallback count. | Complete LeetCode solved snapshot. Contest metrics are shown as context and are not included in the formula. |

Category index values are rounded to two decimals. Weighted points are `index × proposed weight / 100`. The draft weighted total is the sum of weighted points only when all six categories have complete, scoreable evidence. A missing or partial category is never converted to zero, and the remaining weights are never renormalized.

The report also displays available source values such as repository names, active commit days/weeks, active contribution weeks, per-week average, and contribution-type totals. Calendar totals and type totals overlap: they are kept as separate fields and never summed into another metric. Development Activity scores commit volume; Current-Year Contributions scores active-week distribution, so the commit total is not scored twice.

Platform snapshots remain unverified and have unassessed freshness. The report shows source values and category coverage beside the formula. A complete mathematical result does not validate these draft thresholds as hiring policy; approval and empirical validation would be required before any product or policy activation.
