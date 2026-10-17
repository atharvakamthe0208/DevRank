# DevRank Project Status

**Inspected:** 2026-10-17
**Purpose:** Code-based handover. Feature status describes repository implementation and automated tests separately from end-to-end verification and live deployment. It does not imply production deployment, approved hiring validity, or live external services.

## 1. Overview

DevRank is a TypeScript/npm-workspace application for recruiter candidate management and evidence-based evaluation. It has a React/Vite frontend, Express API, shared Zod contracts, Supabase Auth/PostgreSQL integration, SQL migrations, GitHub public-profile lookup/sync, LeetCode public-statistics sync through a separately managed alfa-leetcode-api provider, deterministic scoring, and an optional Groq-backed AI analysis service. Dashboard, comparison, and ranking APIs and the recruiter insights page are implemented in code. Automated tests cover their API/repository behavior, but this does not establish a complete authenticated browser-to-database end-to-end workflow or production deployment. The AI narrative is separate from deterministic scores and is not a hiring decision.

No SRS was present in the repository during inspection. Consequently this report cannot confirm SRS compliance or product approval. Supabase migrations and external provider calls were not exercised against live services.

## 2. Repository map

| Area | Current contents |
|---|---|
| `apps/web` | React app, router, auth pages, admin recruiter-approval page, recruiter dashboard, candidate list/create/details, platform-data forms and GitHub/LeetCode sync, evaluation setup/history/results, and recruiter insights page for dashboard, comparison, and ranking. |
| `apps/api` | Express API, Supabase token verification, recruiter/admin authorization, candidate/evaluation/admin/insights routes and repositories, GitHub and LeetCode provider integrations, evidence/scoring pipeline, optional AI module. |
| `packages/contracts` | Shared schemas/types for auth, candidates, evidence, platform data, scoring, evaluations, AI analysis, comparison/ranking, and API errors. Current scoring contract is v4; read-only v1/v2/v3 schemas support historical snapshots. |
| `supabase/migrations` | SQL migrations for base data model, candidate fields, recruiter auth, admin approval, and evaluation-result snapshots. These must be applied to a target Supabase project; application state is unknown. |
| `config` and `fixtures` | Active six-category v4 role weights, evidence mapping, synthetic candidates and expected v4 scores. |
| `docs` | Setup, auth, API, database, scoring, AI and Day 1–7 QA notes. Some day notes are historical. |

## 3. Feature status

| Feature | Implemented in code | Automated tests | End-to-end verified | Verified against real deployment |
|---|---|---|---|---|
| Health and API error conventions | Yes | Yes; local HTTP tests | Partial local HTTP only | No |
| Authentication and recruiter/admin approval | Yes | Yes; mocked token/auth paths | No authenticated browser-to-Supabase workflow | No |
| Candidate CRUD and ownership | Yes | Yes; API/repository mocks and UI state tests | No live database path | No |
| Admin recruiter approval | Yes | Yes; mocked API/auth paths | No | No |
| GitHub lookup and profile sync | Yes | Yes; provider and repository mocked | No real provider/database round-trip | No |
| LeetCode evidence intake/sync | Yes; manual data and alfa-leetcode-api sync | Yes; provider and persistence mocked | No real provider/database round-trip | No |
| HackerRank evidence intake | Yes, as candidate/recruiter-provided data | Yes | No hosted persistence verification | No |
| Evidence validation and mapping | Yes | Yes | Local fixtures only | No |
| Deterministic six-category v4 GitHub + LeetCode evaluation | Yes; fixed formulas use saved provider snapshots | Yes; scoring, repository, API-contract and UI fixtures | Local mocked API flow only | No |
| Configured-role and owner-defined-role evaluation | Yes | Yes; repository/API tests; migration inserts in PGlite | No authenticated live database flow | No |
| Evaluation history and supported legacy v1/v2/v3 display | Yes | Yes; repository/API/UI fixtures | No current production-row verification | No |
| Optional AI evidence analysis | Yes, optional | Yes; provider mocked | No live provider flow | No |
| Dashboard, comparison, and ranking | Yes; API routes/repositories and recruiter insights page | Yes; API/repository and presentation tests | No full authenticated browser-to-database workflow | No |
| Evaluation persistence migration | Yes; forward migration and isolated PGlite harness | Yes; see `npm run test:migration:integration` | Disposable PGlite only | No; production schema/ledger remain unverified |
| Role-profile management | No create/update API or UI | N/A | No | No |
| SRS/product approval | Unknown | N/A | N/A | N/A |

## 4. Routes and user flow

The API mounts health/auth/admin, candidates, GitHub lookup and evaluation routes under `/api`. Recruiters must have confirmed email and approved status. Candidate/evaluation access is owner-scoped. Admin recruiter decisions require approved admin status. Candidate platform entries distinguish recruiter-provided evidence from provider snapshots; GitHub sync uses the official API and LeetCode sync uses the configured alfa-leetcode-api provider.

The web app provides login/signup and recruiter application flow, admin approvals, recruiter dashboard, candidate list/create/detail, GitHub/platform-data forms, evaluation setup/results at `/candidates/:id/evaluate` and `/evaluations/:id`, and insights at `/dashboard/reports`. The API exposes `GET /api/dashboard`, `POST /api/comparisons`, and `GET /api/rankings`. Comparison and ranking require compatible persisted evaluation snapshots. Evaluation result scores are read from persisted API responses; the web client does not calculate or fabricate them. These paths have automated tests but have not been verified end-to-end against a live deployment.

Consult [API contract](docs/api-contract.md), [authentication guide](docs/authentication.md), and [setup guide](docs/setup.md) for request details.

## 5. Active scoring contract (v4)

There are exactly six active categories: Project Portfolio, Technical Skills, Development Activity, Collaboration, Current-Year Contributions, and DSA & Problem-Solving. Weights are 20/20/15/10/10/25. Previous v1/v2/v3 categories and saved scores use separate read-only validators and are never recalculated under v4.

Version `4.0.0` identifies this contract. Deterministic indexes are derived from the latest saved GitHub and LeetCode snapshot included in that evaluation; missing or partial inputs remain unscored and overall weighted score is withheld unless all six indexes are available. These volume/breadth measures are not calibrated competence, quality, identity, or hiring-suitability scores. Historical results remain immutable. See [the active formula and compatibility specification](docs/scoring-rules.md).

See [scoring rules](docs/scoring-rules.md), [evaluation UI](docs/evaluation-ui.md), and [Day 5 implementation note](docs/day5-ai-analysis.md).

### GitHub + LeetCode active rubric

The Project Portfolio / Technical Skills / Development Activity / Collaboration / Current-Year Contributions / DSA & Problem-Solving taxonomy is active as v4, with deterministic evidence-index formulas. GitHub current-year context uses the UTC calendar and a dedicated backend token. Candidate-reported and provider-fetched evidence remain distinct. The AI explanation cannot change scores. See [the active rubric and limits](docs/proposed-github-leetcode-rubric.md).

## 6. AI analysis and safeguards

AI analysis is a separate optional narrative attached by the evaluation repository. It may return strengths, development areas, role suitability, evidence references, and limitations, or a controlled unavailable/failed result. The model cannot set category scores, overall score, ranking, or decision. Findings must cite evidence IDs from that evaluation; unknown IDs and malformed output are rejected. Empty scoreable evidence produces a deterministic insufficient-evidence analysis without a provider call.

The backend sends role, deterministic score/status summaries, bounded rubric evidence, and up to 12 latest platform-context items with provenance, timestamps, limitations, and restricted provider values. The prompt treats all evidence as untrusted; platform snapshots are explicitly unverified context and cannot establish identity or replace assessments. Candidate ID is omitted and provider errors are logged by sanitized category. Configure `GROQ_API_KEY`, optional `GROQ_MODEL`, and `AI_ANALYSIS_TIMEOUT_MS` in the API environment. No live key/provider request was used for verification; provider behavior is mocked. Schema validation cannot guarantee that model claims are accurate.

## 7. Database and operational state

Migrations exist for Supabase/PostgreSQL tables, ownership/RLS and evaluation snapshots. Their existence does not prove they have been applied. Current API uses request-scoped public/anon key plus verified user JWT; no service-role key is required. Configure API and web environment using the checked-in example files; never commit populated `.env` files. Do not place Groq or Supabase secrets in the web bundle.

The API `.env.example` names `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GITHUB_TOKEN`, `GROQ_API_KEY`, `GROQ_MODEL`, and `AI_ANALYSIS_TIMEOUT_MS`.

## 8. Verification on 2026-10-14

- `npm test` — web: 34/34 passed (9 files); API: 165/165 passed (17 files); contracts: 10/10 passed (1 file), 209 total.
- `npm run typecheck` — passed.
- `npm run build` — contracts, API, and web production bundles passed. Vite reports the main JavaScript bundle is 692.33 kB minified (above its 500 kB advisory threshold).
- `git diff --check` — passed. AI/provider tests use mocked calls; no live Groq, GitHub, or Supabase request was made. Live Supabase migration/configuration state remains unverified.

## 8a. Day 7 QA verification on 2026-10-15

- `npm test` — web 33/33 and contracts 10/10 passed; API 116 tests passed, while 55 HTTP-route tests could not connect to ephemeral `127.0.0.1` listeners because the sandbox returned `EACCES`.
- `npm run typecheck` — passed for contracts, API, and web.
- `npm run lint` — exited 0, but no workspace lint scripts are configured, so no linter ran.
- `npm run build` — contracts/API builds and web TypeScript build passed; Vite bundling was blocked by sandbox `EPERM` while resolving `apps/web/src/features/auth/AuthProvider.tsx` with `realpath`.
- `git diff --check` — passed. No live Supabase, recruiter session, GitHub, or Groq request was made.

## LeetCode provider integration follow-up (2026-10-16)

The candidate details page offers LeetCode synchronization through the server-configured `LEETCODE_API_BASE_URL` provider. It validates separate profile and solved endpoint responses and accepts contest data when available; missing fields remain absent. These public values are contextual and excluded from deterministic scores until approved normalization exists. Provider behavior and repository persistence are covered by mocked tests, while live provider/database round-trip and hosted deployment remain unverified. No migration was added or applied.
- Earlier v1/v2/v3 behavior is retained in historical notes and read-only parsers. Current v4 behavior and platform-source formulas are described in [scoring rules](docs/scoring-rules.md), [platform evidence inventory](docs/quality/platform-evidence-inventory.md), and [evaluation mapping](docs/quality/evaluation-evidence-mapping.md).

## Six-category evidence integration verification (2026-10-16)

- Historical verification note (2026-10-16): at that point the active contract was v3 with Communication Skills. It was superseded by the v4 rubric activation documented below.
- Provider snapshots are attached as separate unverified `platformEvidence` context. No raw GitHub/LeetCode count is normalized into a score; freshness remains unassessed; current numeric scoring still requires explicit rubric-backed normalized values.
- Historical v1/v2/v3 saved results are validated read-only. Profiles using any historical keys are preserved and rejected for new v4 runs until explicitly reconfigured.
- Local automated checks for this finalization are recorded after running in the task report. No live provider, hosted Supabase project, production migration, or deployment was exercised.

## 8b. Post-audit remediation verification on 2026-10-16

- `npm test` — web 43/43, API 187/187, contracts 10/10; 240 tests passed. API HTTP tests used local ephemeral loopback listeners; no external service was contacted.
- `npm run test:migration:acl` — passed isolated PGlite ACL regression scenarios.
- `npm run test:migration:integration` — passed the full reconciliation migration against legacy four-status and current five-status PGlite fixtures, including rerun, existing-row preservation, configured/owner-defined role paths, privilege/policy/FK checks, null-status and cross-owner rejection, and invalid JSON/target/status rollback.
- API startup regression — passed an `EADDRINUSE` test using an ephemeral port held by the test itself; the test verified an actionable message and that the holder remained running.
- `npm run typecheck` — passed. `npm run build` — passed; Vite emitted the >500 kB bundle advisory (717.65 kB minified main JS).
- `npm run lint` — exits 0, but no workspace lint scripts are configured, so no linter ran. `git diff --check` — passed.
- These checks are local/test evidence only. PGlite does not emulate hosted Supabase Auth/PostgREST, production extensions, live JWT/RLS sessions, or the real migration ledger. No live deployment or database workflow was verified.

## 8c. Active GitHub + LeetCode v4 implementation on 2026-10-17

- New evaluations use the six active categories and fixed weights 20/20/15/10/10/25. Deterministic source-specific indexes are calculated from saved GitHub and LeetCode evidence, included in the persisted v4 result, and rendered on both the immediate evaluation result and saved evaluation detail page. The dashboard/Insights report uses the saved snapshot as well.
- LeetCode DSA index preserves provider versus candidate-reported provenance, uses the documented total-only fallback, and caps at 100 at 300 difficulty-weighted solves. Missing or partial values remain unscored; historical v1/v2/v3 snapshots are read-only and custom role profiles are not silently translated.
- Focused API scoring/repository/AI tests passed: 59 tests. Focused web evaluation/report/dashboard tests passed: 14 tests. Contracts tests passed: 17 tests. `npm run typecheck` and `npm run build` passed; the web bundle remains above Vite's advisory size threshold.
- `npm test` ran all workspace suites. Web passed 54/54 and contracts passed 17/17. API's 68 HTTP tests could not connect to ephemeral loopback listeners because this environment returned `EACCES 127.0.0.1`; the remaining API tests passed. The overall command therefore exited non-zero.
- No hosted database, migration, provider, commit, push, or deployment was used for this activation. Production schema and migration-ledger compatibility remain unverified.

## 9. Priority follow-up

1. Locate/provide the approved SRS and review the v4 category definitions, index calibration limits, evidence coverage, and intended decision-use policy with product/assessment owners.
2. Reconfigure each existing custom role profile explicitly to the active v4 category keys and fixed weights before use; the API does not infer or silently write weights.
4. Complete privacy/provider review for Groq, select/configure a model, and verify live deployment settings and retention.
5. Add role-profile management only after role weights are approved; the evaluation UI currently consumes existing valid stored profiles. Review comparison/ranking product policy and role-weight approval before relying on those outputs operationally.
6. Complete production catalog/history reconciliation, backup/restore readiness, and deployment approval before applying any migration; then verify auth/RLS end-to-end in an approved environment.
7. Expand web interaction tests for loading, API failure, and retry states; address the Vite bundle-size advisory if appropriate.
8. Perform browser-authenticated verification against a verified non-production Supabase deployment.

## 10. Ownership notes

The README assigns API/Supabase operations to Atharva, web to Aryan, and scoring/AI/QA to Priya, with shared-contract coordination. Confirm current ownership with the team; the report does not assume approvals or live deployment access.
