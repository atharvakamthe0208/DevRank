# Insights: GitHub + LeetCode ranking contract

The Insights API exposes `/rankings/github-leetcode` as a separate ranking mode. The existing `/rankings` endpoint remains the official six-category evaluation ranking and is unchanged.

## Authoritative inputs

The API reads the latest saved evaluation row for each active, recruiter-owned candidate and selected role. It accepts only a structurally valid active v4 evaluation snapshot whose candidate ID, role, scoring version, and role-weight snapshot match the persisted row. Provider scores are recomputed from that row's validated `platformEvidence`; request parameters cannot supply scores.

Evidence must belong to the same candidate and include a supporting mapping for the active `github_leetcode_v4` rubric. GitHub evidence must use `github_api` provenance and the expected category evidence type. LeetCode scoring uses only `solved_statistics` with `alfa_leetcode_api` provenance. Recruiter-entered LeetCode statistics and the active rubric's optional-missing DSA zero do not count as a LeetCode provider score. The existing v4 report builder provides the normalized category scores and score formulas; this mode does not create new category formulas.

## Aggregation

The five GitHub categories retain weights 20, 20, 15, 10, and 10. For each category with a valid scored index, the API calculates:

`GitHub score = sum(category weight × category score) / sum(weights of scored categories)`

Thus available GitHub category weights normalize to 100, and coverage reports the number scored out of five. A true zero is included. Missing or invalid category scores are excluded; zero available categories means GitHub is unavailable.

The LeetCode score is the existing v4 DSA & Problem-Solving index (weight 25 in the original rubric), directly from valid provider-synced solved statistics. Its existing normalization is preserved.

When both source scores are available:

`Combined score = (GitHub score × 0.5) + (LeetCode score × 0.5)`

The combined score is kept at full numeric precision for ordering and serialized output; the UI formats it to two decimal places. Missing either provider score yields no combined score or rank. Resume scores and resume-processing status are not read by this endpoint.

## Ordering and interpretation

Eligible candidates sort by combined score descending, then evaluation timestamp ascending, candidate ID ascending, and evaluation ID ascending. Incomplete candidates remain visible after ranked candidates and have no rank or combined score. GitHub partial coverage is eligible when at least one GitHub category is scored and a provider-synced LeetCode score is available; its coverage is shown explicitly.

These are deterministic indexes over saved public provider snapshots. Snapshot freshness and account identity are not independently verified; the ranking is decision support, not a measure of engineering competence or hiring suitability.
