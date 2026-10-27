# Unified candidate assessment scoring policy

**Scoring version:** `unified-1.0.0`

## Component weights

| Component | Weight | Source and eligibility |
| --- | ---: | --- |
| Resume / job match | 40% | Existing `resume-job-match-1.0.0` score, only when screening status is complete and its score is present. Provisional scores remain visible but do not contribute. |
| GitHub | 45% by default | Weighted mean of the five saved v4 GitHub category indexes using the weights captured in the matching platform evaluation. All five categories must be scored. The platform share is 60%; the GitHub allocation is that share multiplied by the selected role's five-category GitHub weight total. |
| LeetCode | 15% by default | Saved v4 DSA & Problem-Solving category score from the matching platform evaluation. The LeetCode allocation is 60% multiplied by the selected role's DSA weight. A policy-only zero for a missing profile is reported but is not treated as observed evidence and cannot complete the unified score. |

With the current v4 weights (20, 20, 15, 10, 10, 25), the formula is 40% resume, 45% GitHub, and 15% LeetCode. If the saved role has a different valid six-category v4 weighting, the 60% platform share follows that role's category proportions; the five GitHub categories retain their relative configured weights. Resume receives 40% because it is the only source here assessed directly against job requirements, while public platform activity is contextual evidence. This is an explicit product default for resume versus platform evidence, not a claim that these weights are empirically calibrated.

## Score and ranking policy

A unified score is calculated only when all three components are validated for the same candidate and selected role. Missing or preliminary evidence is never converted to zero, and weights are never redistributed. Scores are rounded to two decimal places. An assessment with any missing, failed, preliminary, or policy-only component has `insufficient_evidence` status and no overall score. Only completed unified scores enter the role-specific ranking; insufficient assessments remain visible after ranked results without a rank.

Existing v4 evaluations and resume screening records remain immutable source reports. Unified scoring stores a separate versioned assessment snapshot with the source IDs and preserves each source score. Provider-reported GitHub and LeetCode data remain unverified evidence indexes, not calibrated competence or hiring-suitability measurements. A recruiter must explicitly link a resume to a candidate; names, emails, upload order, or profile handles are never used to associate records.

The recruiter-facing final ranking is a single table with the candidate's saved GitHub and LeetCode handles, their validated source scores, the validated resume score, and the final score. The API obtains handles from the same owner-scoped candidate row referenced by `candidate_id`; it does not match candidates by username or display name. A present provisional resume score is labeled preliminary and excluded from the final formula. A source score of `0` is displayed as a valid score only when that component has validated evidence.

## Evidence identity and freshness

The platform component uses only the saved active v4 evaluation (`4.0.1`) whose candidate ID and role ID match the unified assessment request. Every GitHub score and an observed LeetCode score must have evidence references that resolve to available, normalized evidence in that saved evaluation. A genuine observed zero remains valid; the policy-only missing-profile DSA zero does not. Resume input must be a recruiter-linked resume record owned by the same recruiter and candidate. Its screening status and saved score object are validated against the shared screening contracts before scoring. A full resume score contributes only when the screening is completed and its score status is `complete`; provisional and separate preliminary matches remain visible but do not contribute.

Saved category evidence source labels are persisted as `<platform> · <provenance>` (for example, `github · github_api` and `leetcode · alfa_leetcode_api`). Unified evidence validation recognizes only the matching platform prefix and approved provenance values. The assessment input fingerprint includes `unified-input-1.1.0`, so assessments generated before this source-label correction are not returned as idempotent duplicates; **Assess All Candidates** can persist a corrected snapshot from the same saved evaluations without rerunning provider requests. The calculation scoring version and its documented weights are unchanged.

Screening sessions store a free-text job title, not a role ID, so compatibility is restricted to the exact title aliases in `isResumeRoleCompatible` (including recognized seniority prefixes) for the selected built-in role. Arbitrary or cross-domain titles are excluded from the unified score and reported as insufficient evidence. The assessment retains the linked resume source ID even when the role is incompatible, so the exclusion is auditable. Each generated assessment records source IDs and a content fingerprint. A new source evaluation or resume result creates a new assessment snapshot; earlier snapshots are retained for history.

## API and database

- `POST /api/candidates/:id/unified-report/assessment` generates or reuses an immutable assessment for `{ "roleId": "software_developer", "resumeId": null }`. A null resume ID uses the candidate's explicitly linked screening result, if present.
- `GET /api/candidates/:id/unified-report/assessment?roleId=software_developer` retrieves the latest saved assessment for that candidate and role.
- `GET /api/rankings/unified?roleId=software_developer` returns latest per-candidate snapshots. Completed scores are ordered descending and get sequential ranks; insufficient assessments follow without a rank.
- `GET /api/candidates/:id/unified-report` adds the latest assessment for the candidate's most recent evaluated role when available.

Apply `supabase/migrations/20261025000200_unified_assessments.sql` to the intended Supabase project after review. From the repository root, link the Supabase CLI to the intended project and run `npx supabase db push`, or apply the SQL in the Supabase SQL Editor. Migrations are not applied by the application. The API uses the caller's authenticated JWT and owner filters; it does not use a service-role credential for assessment reads or writes.
