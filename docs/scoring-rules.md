# Active scoring rules — GitHub + LeetCode v4

The active scorer is deterministic and uses schema/scoring version `4.0.0`. New evaluations use the six-category GitHub + LeetCode rubric and the fixed 20/20/15/10/10/25 weights in `config/role-weights.json`. This activation follows the explicit product direction for DevRank. The values are still evidence indexes, not validated measures of competence, engineering quality, or hiring suitability.

| Category | Weight | Source | Active deterministic formula |
| --- | ---: | --- | --- |
| Project Portfolio | 20% | GitHub | `100 × min(1, ln(1 + public repository count) / ln(11))`; complete public-repository snapshot required. Quantity proxy only. |
| Technical Skills | 20% | GitHub | `100 × min(1, distinct observed repository languages / 5)`; complete, untruncated language metadata required. Breadth proxy only. |
| Development Activity | 15% | GitHub | `100 × min(1, ln(1 + attributable commit contributions) / ln(251))`; complete activity data required. Volume proxy only. |
| Collaboration | 10% | GitHub | Mean of three `100 × min(1, ln(1 + count) / ln(51))` indexes for pull requests opened, issues opened, and reviews submitted. All three complete counts are required. |
| Current-Year Contributions | 10% | GitHub | `100 × active observed UTC weeks / observed UTC weeks`; complete calendar history is required. Total and contribution-type counts are context and are not added or scored again. |
| DSA & Problem-Solving | 25% | LeetCode | `100 × min(1, ln(1 + difficulty-weighted solved count) / ln(301))`, where easy=1, medium=2, hard=3. Provider total is used only when all difficulty fields are absent. |

Category indexes are rounded to two decimals. Each displayed weighted-points value is rounded individually to two decimals, while the overall score sums the full-precision products of those indexes and weights and rounds once at the end to match the deterministic scorer. The displayed weighted-points values can therefore sum to a value one cent different from the overall score. The DSA index caps at 100 once the weighted count reaches 300; this threshold needs future calibration. Contest metrics are displayed as context and do not enter the DSA formula. GitHub activity and LeetCode counts do not prove account ownership, reasoning process, or quality.

Evaluation creation reads the latest saved GitHub/LeetCode snapshots and persists the snapshot, category indexes, weights, and v4 result together. It does not make live provider calls. Missing, malformed, partial, or unavailable evidence stays unscored; no category receives an invented zero. The weighted overall score is withheld until all six categories have complete scoreable evidence. When available, it is the rounded weighted sum of category indexes.

Dashboard and evaluation-detail reports are built from the persisted evaluation snapshot. Later syncs do not rewrite old results; run a new evaluation to capture new evidence. Candidate-reported LeetCode values remain separate from provider-fetched values, and provider values are preferred when present for the DSA index. GitHub tokens remain server-side.

New evaluations are version `4.0.0`. Historical v1/v2/v3 results retain their stored categories, weights, scores, and explanations and are displayed read-only. They are never re-scored or converted. Existing owner-defined role profiles using historical category keys must be explicitly reconfigured to the six v4 keys before use; they are not silently transformed. Configured roles use the fixed v4 weights. No database migration is introduced by this scoring-version change because the current result and weight snapshots are stored in existing JSON fields. Production compatibility remains unverified until the separate production schema/migration-history audit and deployment plan are approved.
