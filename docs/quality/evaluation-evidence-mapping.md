# Evaluation evidence mapping

## Canonical rubric and discrepancy resolution

The canonical six-category rubric is the original Day 4 definition in `docs/day4-scoring-versioning.md`; its sixth category is **Communication Skills** (`communication_skills`), based on structured interview or presentation evidence. The active v3 shared contract, role weights, evidence mapping, API response, and evaluation UI now use that same six-category set. The prior active v2 contract intentionally dropped Communication Skills and used five categories. That decision is retained as an immutable historical v2 format; those results are not padded, recomputed, or converted. Historical v1 results retain their six-category snapshot. This version boundary resolves the five-card/six-required discrepancy without changing saved scores.

The original six-category role weight table is documented in Day 4 and preserved unchanged in the v3 role configuration. The weights remain preliminary and unapproved. Restoring the original values is not approval to use them for hiring decisions.

The separate `github_leetcode_proposal_v1` is also six categories, but is not the active canonical rubric: Project Portfolio 20%, Technical Skills 20%, Development Activity 15%, Collaboration 10%, Current-Year Contributions 10%, and DSA & Problem-Solving 25%. It replaces Documentation only in this proposed taxonomy. It does not replace Communication Skills in active v3 or change active/owner-defined weights. Its mappings are tagged with a proposal ID and cannot satisfy active scoring evidence. Historical v1/v2/v3 category definitions remain unchanged. See [the proposal's source, normalization, and limitations](../proposed-github-leetcode-rubric.md).

## Category-to-signal matrix

`Direct` means the evidence type is accepted as rubric-scored evidence only after a reviewer/assessment supplies a normalized score. `Supporting` means the signal may be shown to reviewers/AI as contextual observation, but it cannot satisfy score sufficiency or contribute a number. `Not appropriate` means the signal does not measure the category.

| Category | Definition and direct evidence | GitHub profile/repositories | LeetCode solved/contest | Separate evidence required |
| --- | --- | --- | --- | --- |
| Technical Skills | Role-relevant languages, tools, engineering knowledge; direct `technical_screen` with agreed rubric | **Supporting:** repository primary languages and descriptions. No skills inferred from repo count or stars. | **Not appropriate as fetched:** current adapter does not request language or skill endpoints; solved counts do not establish language proficiency. | Rubric-scored technical screen/knowledge check |
| Problem-Solving / DSA | Algorithmic reasoning, decomposition, complexity and trade-offs; direct `coding_assessment` | **Not appropriate:** public repositories do not reveal an assessed reasoning process. | **Supporting:** solved-by-difficulty and contest aggregate counts/rating/ranking, when present. These do not establish process, correctness quality, speed, consistency, or improvement. | Rubric-scored coding/structured problem-solving assessment |
| Relevant Project Experience | Relevance, depth, and evidenced impact of related projects; direct `project` or `portfolio` review | **Supporting:** returned public repository descriptions, languages, and update timestamps. No score from number/popularity of repositories. | **Not appropriate:** LeetCode platform aggregates are not project-review evidence. | Reviewer-scored project/portfolio review with role relevance and impact evidence |
| Practical Assessment Performance | Performance on a completed role-relevant task; direct `work_sample` | **Not appropriate:** a public repository snapshot is not a completed, controlled work sample. | **Not appropriate:** solved totals/contest profile are not a practical work sample. | Completed role-relevant assessment and rubric |
| Communication Skills | Clarity/structure in technical explanation and collaboration; direct `structured_interview` | **Not appropriate:** profile/repository metadata does not measure communication. | **Not appropriate:** problem counts/contest ranks do not measure communication. | Structured interview or presentation rubric |
| Learning & Adaptability | Evidence of learning a new concept/tool or responding to changed constraints; direct `learning_record` | **Not appropriate for scoring:** a lone `updatedAt` cannot prove learning or improvement. | **Not appropriate for scoring:** a single snapshot cannot prove learning trend/adaptation. | A specific learning/adaptation example scored under rubric |

GitHub calendar totals and aggregate commit/PR/issue/review counts are available as proposal-only context via the official GraphQL `ContributionsCollection`, subject to the separate public-only token configuration, attribution match, response completeness, provider availability, and documented bounds. Detailed issue/PR/review objects and code are not fetched. LeetCode language counts, skill tags, contest history, and submission history are not fetched. The matrix does not treat these as available merely because providers could expose related endpoints.

## Mapping and normalization behavior

`config/evidence-category-mapping.json` is the direct evidence-type map:

| Evidence type | Category | Direct scoring status |
| --- | --- | --- |
| `technical_screen` | Technical Skills | Direct after explicit `normalizedValue` supplied |
| `coding_assessment` | Problem-Solving / DSA | Direct after explicit `normalizedValue` supplied |
| `project` | Relevant Project Experience | Direct after explicit `normalizedValue` supplied |
| `work_sample` | Practical Assessment Performance | Direct after explicit `normalizedValue` supplied |
| `structured_interview` | Communication Skills | Direct after explicit `normalizedValue` supplied |
| `learning_record` | Learning & Adaptability | Direct after explicit `normalizedValue` supplied |
| `portfolio` | Relevant Project Experience | Direct after explicit `normalizedValue` supplied |
| `other` | Unmapped | No category score |

The deterministic evidence processor accepts an explicit 0–100 normalized value; it does not derive a score from a raw field. Each category score is the arithmetic mean of its available normalized values, rounded to two decimals. Unique evidence IDs are enforced. Overall score is the weighted sum divided by 100 only when every category has at least one scoreable evidence item. Partial weights are not rescaled; missing values are not zero. The role-specific weight sets are exact v1/Day 4 values retained under scoring v3 and remain preliminary.

Provider snapshots use a separate `platformEvidence` contract. Their category mappings are labeled `supporting`; normalized provider values are not `Evidence.normalizedValue` scores, are not included in category `evidenceRefs`, and do not satisfy overall-score completeness. Missing optional fields remain absent. Provider unavailability is not negative evidence. Freshness is `unassessed` because no maximum age has been approved. Candidate-reported LeetCode values remain separately marked `candidate_provided` and unverified.

## Duplicate and correlated signals

Only the most recent persisted snapshot per platform/provenance is attached to one evaluation, avoiding repeated-refresh inflation. GitHub popularity/repository counts are context only; the current top-ten repository subset is not assigned score values. Provider LeetCode solved and contest statistics are shown as separate contextual items from the same saved snapshot for clarity; neither is separately averaged or scored. A reviewer must not create multiple normalized score items for the same underlying assessment/project without an independent-evidence rationale; the current schema rejects duplicate IDs but does not infer correlations across distinct IDs. A future formal deduplication policy requires rubric owner review and a new scoring version if it changes calculation results.

## Overall-score and explanation limits

Practical assessment and Communication Skills require their own direct evidence sources. GitHub/LeetCode cannot manufacture these categories. If any category lacks a normalized direct evidence item, its score is omitted, `missingEvidence` lists it, the evaluation is `insufficient_evidence`, and there is no overall score. AI receives validated deterministic result data and bounded platform context with limitations. It may explain the context but cannot calculate/alter scores, weights, or status, and it must not present public profile data as identity verification.

## Approval and production boundary

No team approval is recorded for category policy, weights, score thresholds, staleness policy, or platform normalization. The six-category contract is implemented and tested locally; that does not approve the weights or establish production schema compatibility. The production migration audit and ledger reconciliation remain independent deployment blockers.
