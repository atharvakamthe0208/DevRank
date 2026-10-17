# Active v4 evaluation evidence mapping

## Active rubric and historical versions

New evaluations use six active GitHub/LeetCode categories: Project Portfolio (20%), Technical Skills (20%), Development Activity (15%), Collaboration (10%), Current-Year Contributions (10%), and DSA & Problem-Solving (25%). The shared scoring contract and checked-in role weights use version `4.0.0`. The former v3 Communication Skills and Practical Assessment Performance results remain valid historical records and are displayed without conversion. Historical v1/v2/v3 snapshots are never padded, recomputed, or rewritten.

The earlier `github_leetcode_proposal_v1` ID is retained only to read evidence snapshots written while the taxonomy was a proposal. New evaluation evidence maps to `github_leetcode_v4`.

## Category-to-signal matrix

| Active category | Source and available signal | Deterministic use | Limitation |
| --- | --- | --- | --- |
| Project Portfolio | GitHub public repository count and returned repository metadata | `100 × min(1, ln(1 + count) / ln(11))` | Quantity proxy only; no repository quality or role relevance judgment. |
| Technical Skills | GitHub repository primary-language metadata | Distinct observed languages divided by five, capped at 100 | Language breadth is not proficiency; complete, untruncated repository coverage is required. |
| Development Activity | GitHub contribution GraphQL commit totals and attributable activity patterns | `100 × min(1, ln(1 + commits) / ln(251))` | Commit volume/patterns are not code quality. Partial/truncated history is not scored. |
| Collaboration | GitHub contribution totals for PRs opened, issues opened, reviews submitted | Mean of three separate `100 × min(1, ln(1 + count) / ln(51))` indexes | All counts are required; counts are not quality or outcomes. |
| Current-Year Contributions | GitHub contribution calendar, UTC January 1–December 31 window | Active observed UTC weeks divided by observed UTC weeks | Calendar total and type breakdown are displayed but not added or scored again. |
| DSA & Problem-Solving | LeetCode solved counts by difficulty; total-only fallback; contest context | `100 × min(1, ln(1 + weighted solved) / ln(301))`, easy=1, medium=2, hard=3 | Capped at 300 weighted solved; not a reasoning or competency measure. GitHub is not used. |

GitHub profile/repository REST and bounded contribution GraphQL data are fetched by server-only adapters. LeetCode profile, solved, and optional contest endpoints are fetched by its server-only adapter. The application does not fetch GitHub issue/PR/review objects or code diffs, nor LeetCode language/skill/history data. See [platform evidence inventory](platform-evidence-inventory.md) for exact provider fields.

## Persistence and scoring boundary

Evaluation creation reads the latest saved platform rows scoped by candidate and owner. It creates a snapshot for that evaluation and runs the deterministic formulas against those values. The report uses this persisted snapshot; it never fetches live data when rendering. A subsequent sync does not change earlier results.

`platformEvidence` retains provider, provenance, timestamp, availability, normalized source fields, limitations, and category mapping. Candidate-reported LeetCode evidence (`candidate_provided`) remains distinct from provider data (`alfa_leetcode_api`); provider solved evidence is preferred when available for the DSA index. GitHub/LeetCode identity remains unverified, and freshness has no approved maximum age. Missing/malformed/partial/unavailable evidence is not converted to zero. The overall weighted result is withheld until every category has complete scoreable evidence.

Legacy `processCandidateEvidence` and historical rubric configuration references are not used by the API evaluation repository. The API persists synthetic, unverified v4 category-index evidence from the saved source snapshot so the common v4 response, AI references, and rankings use the same deterministic result. The AI service may explain values but cannot calculate or override scores.

## Weights and role profiles

Configured roles use the fixed v4 20/20/15/10/10/25 weight set. Existing owner-defined profiles with former v1/v2/v3 category keys are not transformed or inferred; their owner must explicitly configure all six current keys before they can be used. No weight approval workflow is created by this implementation. The v4 activation was explicitly requested for this product task; further governance policy remains a product-owner decision.

No migration is introduced: the existing JSON result and weight snapshot columns hold v4 values. Production schema/history compatibility is not established by this local implementation and remains blocked on the separate read-only production audit, backup/restore readiness, and deployment approval.
