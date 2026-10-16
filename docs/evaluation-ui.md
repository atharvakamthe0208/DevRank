# Evaluation UI

## What the UI does

Open a candidate profile and select **Evaluate candidate**. The setup page loads that candidate and the signed-in recruiter's saved role profiles. Only profiles whose name is a supported role ID and whose five weights validate to exactly 100 can be selected. The UI displays the saved weights and the preliminary/approval warning before submitting an evaluation. The candidate page also lists its recent saved evaluations so prior results can be reopened.

The evaluation request calls `POST /api/candidates/:candidateId/evaluations` with the selected `roleProfileId`. The backend reads the candidate's evidence rows, admits only evidence that matches the normalized evidence contract, applies the configured evidence mappings, uses the selected role profile's actual stored weights, runs the deterministic scorer, adds optional AI analysis separately, and persists the versioned result. The UI redirects to `/evaluations/:evaluationId`, which reloads both the persisted result and candidate profile from the API.

The result view renders the five shared category contracts in order: Technical Skills, Problem-Solving / DSA, Relevant Project Experience, Practical Assessment Performance, and Learning & Adaptability. It displays scores and progress bars only when the API result includes a valid category score. Insufficient categories show their explanation and are listed as missing. The overall score appears only if the deterministic response contains one; the UI never supplies a fallback score. AI findings render only from the validated `aiAnalysis` field, with its independent status and evidence references. AI unavailability does not alter the deterministic result.

## API routes

- `GET /api/evaluations/role-profiles` returns owner-scoped saved role profiles and marks each usable only when both its role name and five weights pass the shared contracts. It does not create or modify weights.
- `GET /api/candidates/:id/evaluations` returns up to 20 latest saved evaluations for an owned candidate.
- `POST /api/candidates/:id/evaluations` calculates and persists an evaluation using existing candidate evidence and the selected saved role profile.
- `GET /api/evaluations/:id` retrieves a saved evaluation. The UI also loads its candidate through `GET /api/candidates/:candidateId`.

All routes require an authenticated, approved recruiter. Access remains owner-scoped. Historical v1 results are accepted by the read API for compatibility but the current five-category page explains that it cannot render an older scoring format as a current result.

## Evidence and weight limitations

The scorer requires valid normalized, mapped evidence in all five categories before it calculates an overall score. Missing evidence is not changed to zero and available weights are not renormalized. LeetCode/HackerRank summary imports and GitHub profile snapshots are provenance data; they are not automatically normalized to a rubric or scored.

The repository contains no SRS. Its three JSON weight sets are explicitly preliminary, and the database migration seeds no role profiles. The UI uses only role profiles already saved for the recruiter. A reviewer must approve the weights and ensure a valid profile exists before evaluation can be calculated. There is no role-profile management UI in this change. Supabase migrations must be applied separately; live database configuration and stored rows cannot be confirmed from source alone.

## Verification coverage

Web rendering tests verify all five labels, actual backend score values and progress indicators, AI unavailable state, absence of Communication Skills, and insufficient-evidence behavior with no overall score. API tests verify role-profile listing, evaluation creation/retrieval/list routes, and the owner-scoped repository's handling of saved role names/weights without manufacturing defaults. Existing scoring and evidence-processing tests remain the source of truth for calculation behavior.
