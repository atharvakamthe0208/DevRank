# Day 7 — Scoring, partial evidence, AI, and recruiter workflow QA

**QA date:** 2026-10-15  
**Scope:** Existing implementation and automated checks. No scoring policy, role weights, API contracts, or application code were changed for this QA pass.

## Project and requirements inspection

Reviewed `PROJECT_STATUS.md`, Day 5 AI/scoring notes, Day 6 QA notes, evaluation UI and scoring documentation, AI design, shared Zod contracts, API repositories/routes, frontend result rendering, scoring/evidence-processing/AI modules, role weights, evidence mappings, and tests. No SRS file exists in the repository, so SRS compliance and product approval cannot be established.

The working tree had one pre-existing edit in `apps/web/src/features/candidates/mockCandidates.ts` (`candidates` array opening changed from `[5` to `[`); it was preserved. No other user changes were present at initial inspection.

## Implementation status and policy checks

| Area | Result | Evidence / limitation |
|---|---|---|
| Active scoring categories | Verified | Exactly five: Technical Skills, Problem-Solving / DSA, Relevant Project Experience, Practical Assessment Performance, Learning & Adaptability. Communication Skills is not active. |
| Deterministic scoring | Verified in unit tests | Category means and weighted overall score use the documented v2 formula and two-decimal rounding. Repeated/order-varied evidence remains deterministic. Invalid candidate data, evidence IDs, versions, and weights are rejected. |
| Role weights | Verified, not approved | Three configured role weight sets validate and total 100. They are marked preliminary; this QA did not change or endorse them. Existing saved role profiles must independently pass the five-weight API validation. |
| Partial evidence | Verified in unit tests | Available category scores remain visible; missing categories are reported; missing is not zero; weights are not renormalized; overall score is omitted unless all five categories are scored. |
| Evidence validation and mapping | Verified in unit tests | Malformed records are rejected individually, all duplicate-ID occurrences are rejected, invalid normalization is rejected, unsupported/unmapped types are reported, and retained valid evidence still proceeds. LeetCode/HackerRank imported summaries and GitHub snapshots are not automatically scoreable. |
| AI analysis | Implemented and verified with mocks | Groq-compatible provider client exists. Schema/grounding, unknown evidence references, empty/malformed output, missing config, timeout, rate limit/provider errors, insufficient evidence, and preservation of deterministic scores on AI failure are tested. No paid/live provider call was made. |
| Evaluation result UI | Verified by component tests | Displays all five categories and API-provided values, missing-evidence state and no overall score when incomplete, and AI-unavailable state without altering scores. It does not calculate replacement scores. |
| Candidate/API/database workflow | Partially verified | API routes, auth/approval guards, repository logic, evaluation persistence, and response contracts exist and have unit/mocked tests. Live browser-to-Supabase behavior, actual recruiter permissions, migrations, and saved role-profile availability were not verified. |
| Ranking | Not implemented | No ranking comparator, service, endpoint, or UI exists. Day 6 documents that ties remain equal and ranking policy is undecided. |

## Scoring and failure test coverage

Existing focused suites cover the Day 7 cases; no redundant tests or product behavior changes were added:

- `apps/api/test/scoring.test.ts`: valid scores, deterministic output, weighted score, rounding/bounds, role weights, invalid input/configuration, duplicate identifiers, and incomplete category scores.
- `apps/api/test/evidence-processing.test.ts`: single-source and partial evidence, missing/empty/unavailable values, malformed and invalid records, duplicate identifiers, unsupported/unmapped/conflicting mappings, and retained evidence after rejects.
- `apps/api/test/day6-qa.test.ts`: ties, equal scores, input-order stability, and incomplete evaluations.
- `apps/api/test/ai-analysis.test.ts`: grounded output, invalid/unknown evidence references, malformed/empty output, missing configuration, timeout, rate limiting, provider failures, insufficient evidence, and preservation of deterministic results.
- `apps/web/src/features/evaluations/EvaluationResults.test.tsx`: five labels, displayed backend scores, progress indicators, insufficient-evidence display, no overall score when prohibited, absence of Communication Skills, and AI unavailable rendering.
- `packages/contracts/test/contracts.test.ts`: shared contracts, role weights, categories, fixtures, and expected evaluation consistency.

## Defects and blockers

No new reproducible application logic defect was established during this QA pass. Two environment limitations prevented complete verification:

### D7-B1 — API HTTP integration tests cannot bind/connect to loopback

- **Priority:** Verification blocker.
- **Reproduction:** Run `npm test`. API suites that start ephemeral local HTTP listeners fail at `fetch()` with `connect EACCES 127.0.0.1:<ephemeral-port>`.
- **Expected:** HTTP route tests exercise health, auth, candidates, platform data, and evaluation routes through a local listener.
- **Actual:** 55 API route tests cannot reach the listener under the current sandbox policy; this is not evidence of an application assertion failure.
- **Root cause:** Process-level TCP loopback access is denied in this execution environment.
- **Fix/test:** No application change made. Run these route suites in a permitted local CI/development environment.
- **Retest:** Blocked here; route behavior remains covered by source review and previously authored tests, not claimed as passed in this run.

### D7-B2 — Vite production build cannot resolve a source file under sandbox filesystem rules

- **Priority:** Verification blocker.
- **Reproduction:** Run `npm run build`.
- **Expected:** Vite resolves frontend imports and emits the production bundle.
- **Actual:** Contract and API builds plus web TypeScript build pass; Vite then fails with `EPERM: operation not permitted, realpath ... apps/web/src/features/auth/AuthProvider.tsx`.
- **Root cause:** Vite/Rollup is denied a filesystem `realpath` operation by the current sandbox; this run does not establish whether an unrestricted build succeeds.
- **Fix/test:** No application change made. Retry the production build in a permitted local environment.
- **Retest:** Blocked here.

`npm run lint` exits successfully, but no workspace defines a lint script, so no linter actually ran. No live Supabase, recruiter session, GitHub, or Groq request was used. The SRS, product approval for scoring criteria/weights, applied migration state, and live stored role profiles remain unknown or unverified.

## Commands and actual results

| Command | Result |
|---|---|
| `npm test` | Web 33/33 passed; API 116 passed and 55 route tests failed to connect due to loopback `EACCES`; contracts 10/10 passed. Overall: 159 passed, 55 blocked/failing at the network boundary. |
| `npm run typecheck` | Passed (contracts build and API/web TypeScript checks). |
| `npm run lint` | Exit 0; no configured workspace lint scripts, so lint was not performed. |
| `npm run build` | Contracts/API builds and web TypeScript build passed; Vite bundle step blocked by filesystem `EPERM` on `AuthProvider.tsx`. |
| `git diff --check` | Passed. |

## Follow-up

1. Run the API HTTP suites and Vite production build outside the restrictive sandbox.
2. Locate and review the approved SRS; obtain explicit product/assessment-owner approval for category definitions and preliminary role weights.
3. Apply migrations and verify recruiter authentication, RLS/ownership, and role-profile records in a controlled Supabase project.
4. Add or run browser-level authenticated workflow verification in that controlled environment. Do not claim ranking or external-platform evidence retrieval; those features are not implemented.
