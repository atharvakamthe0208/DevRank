# Evaluation UI

Open a candidate profile and select **Evaluate candidate**. The setup page loads the candidate and the signed-in recruiter's saved role profiles. Profiles are usable only when their name is a supported role ID and their six v3 weights total 100. Previous five-category v2 profiles are preserved but require an explicit update; the UI does not invent a Communication Skills weight.

The candidate profile's **Platform data** area also shows the separate **Proposed GitHub + LeetCode Rubric**. Its six draft categories and weights are explicitly marked as unapproved and inactive. The panel describes intended sources/signals independently from active scoring; it does not change role profiles or persisted results.

The evaluation request calls `POST /api/candidates/:candidateId/evaluations` with the selected `roleProfileId`. The backend validates owner-scoped candidate evidence, applies the configured evidence-type mapping, scores deterministically, adds saved platform snapshots as separate unscored context, and persists the versioned result. The page displays all six canonical categories: Technical Skills, Problem-Solving / DSA, Relevant Project Experience, Practical Assessment Performance, Communication Skills, and Learning & Adaptability.

Scores and progress bars appear only when supplied by the validated API result. Insufficient categories show their explanations and are listed as missing; missing evidence is not zero. The overall score appears only when all six categories have scoreable evidence. The client never supplies a fallback score.

## Platform evidence context

The result can show the latest saved GitHub snapshot, provider-fetched LeetCode snapshot, and candidate-reported LeetCode snapshot as separate cards. Each shows provenance, retrieval/submission time, availability, the values retrieved, and limitations. All are unverified; snapshot age is marked unassessed until a freshness policy is approved. Their category mappings are contextual only. Raw platform fields do not enter numeric scoring without reviewed normalization rules. A failed refresh returns an error and leaves the previously saved evidence visible.

The candidate profile's GitHub section displays the saved UTC calendar year, capture time, calendar contribution total, available commit/pull-request/issue/review totals, active-week coverage, average contributions per observed UTC week, and expandable weekly counts. It labels available, partial, and unavailable data separately; omitted values remain unavailable. An old snapshot without the optional insights fields is identified as predating contribution-history capture. Calendar totals and type totals overlap and are never added together.

The optional AI explanation receives the deterministic result and bounded unverified platform context, which it may describe with source IDs. It cannot change scores or apply the separate proposed GitHub/LeetCode weights. The UI labels proposed platform context as unverified and unscored; current-year measures show UTC scope and availability. Historical v1/v2 results are rendered from their saved category arrays and are read-only; v3 results continue to show the active six-category page, including Communication Skills. The distinct GitHub/LeetCode proposal is documented in [the rubric proposal](proposed-github-leetcode-rubric.md).

## API routes and compatibility

- `GET /api/evaluations/role-profiles` returns owner-scoped profiles and marks only valid six-weight v3 profiles usable.
- `GET /api/candidates/:id/evaluations` returns up to 20 latest saved results in supported v1/v2/v3 formats.
- `POST /api/candidates/:id/evaluations` calculates and persists an evaluation from rubric evidence and the selected six-weight v3 profile.
- `GET /api/evaluations/:id` retrieves a saved result without recalculating historical values.

All routes require authenticated, approved recruiter access and remain owner-scoped. Historical result formats are never converted into current scores.

## Remaining limits

GitHub contribution history depends on a separate server-side contribution token and provider response; no token is sent to the browser. The query can return UTC contribution-calendar totals and weekly counts, plus aggregate commit, pull-request, issue, and review totals. It does not fetch issue/PR/review detail, review quality, or prove account identity. LeetCode language/skill categories and submission time series are not retrieved. No platform-to-score thresholds exist; these snapshots do not satisfy a numeric category requirement. Proposed weights require product-owner approval and remain inactive. The production schema and migration ledger remain subject to their separate readiness audit.

Automated UI tests verify the six active labels, scoreless missing states, history rendering, proposal visibility, and partial/unavailable contribution presentation. They do not establish a real-provider or production end-to-end result.
