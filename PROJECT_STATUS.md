# DevRank Project Status

**Inspected:** 2026-10-14
**Purpose:** Current code-based handover. Feature status describes repository implementation; it does not imply production deployment, approved hiring validity, or live external services.

## 1. Overview

DevRank is a TypeScript/npm-workspace application for recruiter candidate management and evidence-based evaluation. It has a React/Vite frontend, Express API, shared Zod contracts, Supabase Auth/PostgreSQL integration, SQL migrations, GitHub public-profile lookup/sync, deterministic scoring, and an optional Groq-backed AI analysis service. Comparison and ranking remain unimplemented. The AI narrative is separate from deterministic scores and is not a hiring decision.

No SRS was present in the repository during inspection. Consequently this report cannot confirm SRS compliance or product approval. Supabase migrations and external provider calls were not exercised against live services.

## 2. Repository map

| Area | Current contents |
|---|---|
| `apps/web` | React app, router, auth pages, admin recruiter-approval page, recruiter dashboard, candidate list/create/details, platform-data forms and GitHub sync, evaluation setup and persisted-result pages. Reports remain a placeholder. |
| `apps/api` | Express API, Supabase token verification, recruiter/admin authorization, candidate/evaluation/admin routes and repositories, GitHub integration, evidence/scoring pipeline, optional AI module. |
| `packages/contracts` | Shared schemas/types for auth, candidates, evidence, platform data, scoring, evaluations, AI analysis, comparison/ranking, and API errors. Current scoring contract is v2; a separate read-only v1 evaluation schema supports old snapshots. |
| `supabase/migrations` | SQL migrations for base data model, candidate fields, recruiter auth, admin approval, and evaluation-result snapshots. These must be applied to a target Supabase project; application state is unknown. |
| `config` and `fixtures` | Preliminary role weights, evidence mapping, synthetic candidates and expected v2 scores. |
| `docs` | Setup, auth, API, database, scoring, AI and Day 1–6 implementation notes. Some day notes are historical. |

## 3. Feature status

| Feature | Status | Evidence / limitation |
|---|---|---|
| Health/API error conventions | Implemented | `/api/health`, compatibility `/health`, structured API errors and 404. |
| Authentication and approval | Implemented in code | Supabase Auth token verification; confirmed email; recruiter/admin profile and approval gates. Live Supabase configuration not verified. |
| Candidate CRUD | Implemented in API and UI | Owner-scoped create/list/read/update/archive; candidate screens use authenticated API. |
| Admin recruiter approval | Implemented in API and UI | Admin list/decision flow, migration RPCs and audit records. Live policy behavior unverified. |
| GitHub profile lookup | Implemented | Official GitHub REST API, bounded public profile/repository response; optional backend token. Live provider not tested here. |
| LeetCode/HackerRank evidence intake | Implemented as recruiter-provided data | Validated, append-only entries with provenance; no scraping or provider integration; not currently scoreable. |
| Evidence validation/mapping | Implemented | Validates normalized evidence, rejects duplicate IDs, tracks invalid/unmapped items; `structured_interview` is deliberately unmapped. |
| Deterministic evaluation | Implemented | Five-category v2 scorer; requires scoreable values for an overall score; missing categories are not treated as zero. |
| Weights and role configuration | Partially implemented | Three preliminary role configurations; no role-profile CRUD. Stored six-category profiles need explicit update before v2 evaluation. |
| AI evidence analysis | Implemented as optional API-side service | Groq-compatible structured output, evidence ID validation, data minimization, redaction, timeout/failure handling; validated analysis is shown separately in the evaluation result UI. No live provider call was made. |
| Evaluation persistence/retrieval | Implemented in API | Persists result/scoring version/effective weights; authenticated create/get and candidate-scoped recent evaluation listing. Requires migrations and valid stored role profile. |
| Evaluation creation/results UI | Implemented in web | Candidate profile starts evaluation using an existing valid owner-scoped role profile and lists recent saved results; result page reloads the persisted deterministic result, five categories, missing-evidence status, and validated optional AI analysis. Requires API connectivity, applied migrations, a valid saved role profile, and scoreable normalized evidence for an overall score. |
| Comparison/ranking/reports | Not implemented | Schemas and/or placeholder route/page only; no comparison/ranking workflow. |
| SRS/product approval | Unknown | No SRS found; categories, weights, privacy/provider policy need owner review. |

## 4. Routes and user flow

The API mounts health/auth/admin, candidates, GitHub lookup and evaluation routes under `/api`. Recruiters must have confirmed email and approved status. Candidate/evaluation access is owner-scoped. Admin recruiter decisions require approved admin status. Candidate platform entries are explicitly marked candidate-provided; GitHub sync uses the official API.

The web app provides login/signup and recruiter application flow, admin approvals, recruiter dashboard, candidate list/create/detail, GitHub/platform-data forms, and evaluation setup/results at `/candidates/:id/evaluate` and `/evaluations/:id`. Evaluation result scores are read from persisted API responses; the web client does not calculate or fabricate them. Comparison/ranking remain unimplemented.

Consult [API contract](docs/api-contract.md), [authentication guide](docs/authentication.md), and [setup guide](docs/setup.md) for request details.

## 5. Active scoring contract (v2)

There are exactly five active categories: Technical Skills, Problem-Solving / DSA, Relevant Project Experience, Practical Assessment Performance, and Learning & Adaptability. Communication Skills is not active. Historical v1 snapshots retain a separate legacy schema for read-only compatibility; v1 results are not recalculated under v2.

Scoring uses normalized 0–100 evidence values, averages available values per category, and applies the role’s category weights only when all five categories have scoreable evidence. Otherwise the evaluation is `insufficient_evidence` and has no overall score. Weights are proportionally rescaled from the previous five retained category weights and sum to 100; the three role profiles remain preliminary and unapproved. A new schema/scoring version `2.0.0` identifies the contract. Structured interview evidence remains unmapped and excluded from the score.

See [scoring rules](docs/scoring-rules.md), [evaluation UI](docs/evaluation-ui.md), and [Day 5 implementation note](docs/day5-ai-analysis.md).

## 6. AI analysis and safeguards

AI analysis is a separate optional narrative attached by the evaluation repository. It may return strengths, development areas, role suitability, evidence references, and limitations, or a controlled unavailable/failed result. The model cannot set category scores, overall score, ranking, or decision. Findings must cite evidence IDs from that evaluation; unknown IDs and malformed output are rejected. Empty scoreable evidence produces a deterministic insufficient-evidence analysis without a provider call.

The backend sends only role, deterministic score/status summaries, and bounded evidence fields. It omits candidate ID, source/raw values/timestamps, applies pattern-based PII redaction, uses a separate prompt for untrusted evidence, and logs sanitized failure codes. Configure `GROQ_API_KEY`, optional `GROQ_MODEL`, and `AI_ANALYSIS_TIMEOUT_MS` in the API environment. No live key/provider request was used for verification; provider behavior is mocked. Pattern redaction is not complete PII detection, and schema validation cannot guarantee that model claims are accurate.

## 7. Database and operational state

Migrations exist for Supabase/PostgreSQL tables, ownership/RLS and evaluation snapshots. Their existence does not prove they have been applied. Current API uses request-scoped public/anon key plus verified user JWT; no service-role key is required. Configure API and web environment using the checked-in example files; never commit populated `.env` files. Do not place Groq or Supabase secrets in the web bundle.

The API `.env.example` names `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GITHUB_TOKEN`, `GROQ_API_KEY`, `GROQ_MODEL`, and `AI_ANALYSIS_TIMEOUT_MS`.

## 8. Verification on 2026-10-14

- `npm test` — web: 34/34 passed (9 files); API: 165/165 passed (17 files); contracts: 10/10 passed (1 file), 209 total.
- `npm run typecheck` — passed.
- `npm run build` — contracts, API, and web production bundles passed. Vite reports the main JavaScript bundle is 692.33 kB minified (above its 500 kB advisory threshold).
- `git diff --check` — passed. AI/provider tests use mocked calls; no live Groq, GitHub, or Supabase request was made. Live Supabase migration/configuration state remains unverified.

## 9. Priority follow-up

1. Locate/provide the approved SRS and reconcile the removal of Communication Skills.
2. Review and approve category definitions, normalization rules, and provisional role weights with product/assessment owners.
3. Decide how existing persisted role profiles with six weights will be migrated; do not silently rewrite user data.
4. Complete privacy/provider review for Groq, select/configure a model, and verify live deployment settings and retention.
5. Add role-profile management only after role weights are approved; the evaluation UI currently consumes existing valid stored profiles. Consider comparison/ranking only after policy decisions.
6. Apply migrations to a controlled Supabase project and verify auth/RLS end-to-end, including cross-tenant access.
7. Expand web interaction tests for loading, API failure, and retry states; address the Vite bundle-size advisory if appropriate.

## 10. Ownership notes

The README assigns API/Supabase operations to Atharva, web to Aryan, and scoring/AI/QA to Priya, with shared-contract coordination. Confirm current ownership with the team; the report does not assume approvals or live deployment access.
