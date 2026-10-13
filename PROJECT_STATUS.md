# DevRank Project Status

**Inspected:** 2026-10-12  
**Purpose:** Code-based handover snapshot. Status reflects files and checks observed in this repository, not a claim that the planned product is complete.

## A. Project overview

DevRank is intended to help recruiters evaluate technical candidates using platform or assessment evidence, deterministic category scores, role-specific weights, comparison/ranking, and separate AI-generated explanations. The repository is an early MVP scaffold. Its verified working product logic is currently concentrated in shared Zod contracts and an API-side evidence-processing and deterministic scoring library. It does not yet provide a candidate-management application or a connected evaluation workflow.

The implemented stack is TypeScript, npm workspaces, React 19/Vite, Express 4, Zod, and Vitest. Supabase client libraries are dependencies and Supabase/PostgreSQL is described as the intended data platform, but no database schema, migration, authentication flow, or persistence is implemented. LangChain/Groq is described as an intended AI stack, but no provider integration exists.

The app can render a minimal page; the API can answer a health check and return a structured 404; a caller can use the evidence pipeline and scorer as in-process functions. The shared tests and package checks pass (details in section J). The root README still describes scoring and the product UI as not implemented, which is out of date relative to the Day 2–4 scoring code and should be reconciled.

## B. Current project structure

| Path | What is present and what it does |
|---|---|
| `apps/web/` | React/Vite client scaffold. `src/App.tsx` renders only a title and scaffolding message. `src/main.tsx` mounts `App` directly. `src/app/router.tsx` declares a wildcard route but is not mounted by `main.tsx`; `providers.tsx` is an identity wrapper. Feature, component, hook, style, and test folders are placeholders. |
| `apps/web/src/lib/api/client.ts` | Generic `fetch` helper, JSON headers, and structured API error parsing. No current UI code calls it. Its default base URL ends in `/api`, while the API currently has no `/api` route. |
| `apps/web/src/lib/supabase/client.ts` | Creates a browser Supabase client only when the Vite URL and anonymous key exist. No current page uses it. The comment correctly says not to put a service-role key in the browser. |
| `apps/api/` | Express/TypeScript scaffold. `src/app.ts` configures CORS and JSON parsing, serves `GET /health`, then a structured 404. `src/server.ts` listens on the configured port. |
| `apps/api/src/config/env.ts` | Loads environment variables and validates/defaults API port and web origin; optional names cover Supabase, GitHub, and Groq. This validates settings but does not connect the integrations. |
| `apps/api/src/modules/scoring/index.ts` | Implemented deterministic scorer, version checks, role-weight loading/validation, and evaluation response validation. No HTTP route invokes it. |
| `apps/api/src/modules/evidence-processing/index.ts` | Implemented in-process evidence validation, optional caller-supplied normalization, category mapping, and scorer orchestration. No HTTP route invokes it. |
| `apps/api/src/{routes,controllers,repositories,middleware,services,integrations,modules/ai}/` | Placeholder directories (`.gitkeep` only, apart from scoring and evidence processing modules). No route/controller, auth middleware, repository, platform adapter, or AI service exists. |
| `packages/contracts/src/` | Shared Zod schemas and TypeScript types for candidate, evidence, platform evidence, evaluation, response, scoring, AI analysis, comparison, ranking, and API errors. These are data contracts, not feature implementations. |
| `config/role-weights.json` | Versioned preliminary weights for three roles. The `preliminary` flag is true. |
| `config/evidence-category-mapping.json` | Explicit evidence-type-to-category mapping; `other` is intentionally unmapped. |
| `fixtures/` | Five synthetic candidate/evaluation examples and expected deterministic scores. These are test/demo fixtures, not live candidate records. |
| `supabase/` | README and an empty `migrations/` placeholder. No SQL schema, migration, seed data, or access policy is present. |
| `docs/` | Architecture, database, API proposal, setup, scoring, AI, and Day 1–4 implementation notes. Several describe proposed future work; read the implementation status in this report before treating them as live features. |
| `apps/api/test/`, `packages/contracts/test/` | Scoring, evidence processing, API compatibility, and shared contract tests. The web test command is configured to pass when no tests exist; no web tests were found. |
| `.github/workflows/`, `scripts/` | Placeholder directories only; no CI workflow or project automation script was found. |

No SRS file was found in the repository. In particular, there is no file with an SRS/requirements name and no SRS content in the tracked `docs/` listing. Section K is therefore a gap checklist based on the user-provided task themes and repository docs; it is **not** a verified SRS compliance audit.

## C. Feature status

Status values follow the requested definitions. “Verified” means supported by the code and the checks named in section J; it does not mean production-ready or connected to stored application data.

| Feature | Implementation Details | Relevant Files | Status | Verification |
|---|---|---|---|---|
| API health check and 404 | Express app answers `GET /health` with `{ "status": "ok" }`; every unmatched route returns JSON `NOT_FOUND`. | `apps/api/src/app.ts`, `apps/api/test/api-compatibility.test.ts` | **Complete and Verified** | API compatibility tests exercise the health route and an unimplemented evaluation route returning 404. |
| Shared candidate/evaluation contracts | Zod validators/types describe evidence and evaluation request/response shapes, including opaque candidate input IDs in the scoring contract. | `packages/contracts/src/` | **Complete and Verified** | Contract suite passes; API scorer also validates returned payloads. There is no HTTP adoption of these contracts. |
| Six scoring categories | Six fixed IDs/names, each with descriptions, are shared by contracts and scorer. | `packages/contracts/src/scoring.ts`, `docs/day1-scoring-contract.md` | **Complete and Verified** | Tests assert category count and scorer outputs. Definitions are preliminary and need team review. |
| Deterministic scoring | Means of available normalized values per category, two-decimal rounding, role-weighted overall result only when all six categories are scored; missing categories omit overall score rather than becoming zero. | `apps/api/src/modules/scoring/index.ts`, `config/role-weights.json`, `apps/api/test/scoring.test.ts` | **Complete and Verified** | 17 scorer tests pass, including fixtures, multiple evidence values, missing data, boundaries, ordering, and version behavior. Formula and weights still need product/team approval. |
| Scoring version field and validation | Current scorer/config version is `1.0.0`; unsupported and mismatched versions are rejected. Response schema accepts the field optionally for compatibility. | `packages/contracts/src/scoring.ts`, `packages/contracts/src/evaluation-response.ts`, `apps/api/src/modules/scoring/index.ts`, `config/role-weights.json` | **Complete and Verified** | API and contract tests cover versioned output and legacy response validation. Only one version/configuration is implemented; there is no historical replay store. |
| Evidence validation and category mapping | Validates evidence per item, rejects malformed items and all copies of duplicate IDs, tracks unnormalized/unmapped evidence, applies explicit mapping. | `apps/api/src/modules/evidence-processing/index.ts`, `config/evidence-category-mapping.json`, `apps/api/test/evidence-processing.test.ts` | **Complete and Verified** | 15 evidence-processing tests pass. Function is not exposed through an API. |
| Raw evidence normalization | Accepts already-normalized 0–100 values, or invokes a deterministic callback supplied by the caller. No built-in raw-value conversions or approved normalization rubrics exist. | `apps/api/src/modules/evidence-processing/index.ts`, `docs/day3-evidence-processing.md` | **Partially Implemented** | Tests exercise custom rules and invalid rule results. Production-ready normalization policies are absent. |
| Role profiles and weights | Three role IDs and preliminary six-category weight sets, each totaling 100. There is no role-profile CRUD or persistence. | `packages/contracts/src/scoring.ts`, `config/role-weights.json` | **Partially Implemented** | Config schema and scorer tests validate totals/role selection. Weight values are explicitly preliminary. |
| Candidate management / CRUD | Candidate schemas exist, but no UI forms, API routes, service, repository, or database table exists. | `packages/contracts/src/candidate.ts`, `apps/api/src/services/candidates/`, `apps/web/src/features/candidates/` | **Not Implemented** | No feature code or endpoint found; placeholder directories are not functional implementation. |
| Authentication and access control | Supabase client library, optional environment settings, and architecture notes exist. No login, session handling, API token verification, authorization, or row-level policy exists. | `apps/web/src/lib/supabase/client.ts`, `apps/api/src/config/env.ts`, `apps/api/src/services/auth/`, `apps/api/src/middleware/` | **Not Implemented** | No auth flow, middleware, policy, or database schema found. |
| GitHub integration | `GITHUB_TOKEN` is an optional environment variable; a GitHub integration directory is only a placeholder. | `apps/api/src/integrations/github/`, `apps/api/src/config/env.ts` | **Not Implemented** | No GitHub client or API call found. |
| LeetCode/HackerRank integration | Platform names appear in a schema and placeholder folders. There is no collector, authorized API integration, candidate-provided import UI, or platform data persistence. | `packages/contracts/src/platform-data.ts`, `apps/api/src/integrations/leetcode/`, `apps/api/src/integrations/hackerrank/` | **Not Implemented** | No platform calls found. Do not add unauthorized scraping. |
| Candidate-provided manual platform data | Contract can represent `candidate_provided` evidence, but no upload/input form, source verification process, or storage exists. | `packages/contracts/src/platform-data.ts`, `apps/web/src/features/candidates/` | **Not Implemented** | Schema presence only; no data-entry workflow found. |
| AI analysis | AI-analysis schemas and an optional `GROQ_API_KEY` name/documented intended stack exist. No prompt, model client, provider call, timeout/error handling, or structured-output service exists. Current scorer explicitly emits a “no AI-generated explanation” message. | `packages/contracts/src/ai-analysis.ts`, `apps/api/src/modules/ai/`, `apps/api/src/config/env.ts`, `docs/ai-design.md` | **Not Implemented** | Source inspection confirms no provider implementation; no AI tests exist. |
| Dashboard | A placeholder feature directory exists. The rendered app shows only a title and scaffolding notice. | `apps/web/src/App.tsx`, `apps/web/src/features/dashboard/` | **Not Implemented** | Web build passes; there is no dashboard view or data connection. |
| Candidate detail and evaluation screens | No pages/forms exist; the web app does not call the scorer or API client. | `apps/web/src/features/evaluations/`, `apps/web/src/lib/api/client.ts`, `apps/web/src/App.tsx` | **Not Implemented** | Source inspection; no web tests. |
| Candidate comparison | A schema describes comparisons for 2–5 candidate/evaluation UUIDs. There is no comparison algorithm, API, persistence, or screen. | `packages/contracts/src/comparison.ts`, `apps/api/src/services/comparisons/`, `apps/web/src/features/comparisons/` | **Not Implemented** | Contract only. |
| Ranking | A schema describes candidate ID, rank, and score. No ranking function, route, query, or UI exists. | `packages/contracts/src/ranking.ts`, `apps/api/src/services/rankings/`, `apps/web/src/features/rankings/` | **Not Implemented** | Contract only. |
| Reports | A placeholder service and feature folder exist; no report generation/export exists. | `apps/api/src/services/reports/`, `apps/web/src/features/reports/` | **Not Implemented** | No implementation found. |
| Database persistence | Supabase packages/config and database design notes exist. No tables, migrations, repositories, or database operations exist. | `supabase/README.md`, `docs/database-schema.md`, `apps/api/src/repositories/` | **Not Implemented** | No migration/schema SQL found; Supabase is not invoked by API code. |

## D. Partially completed features and gaps

### Evidence normalization

1. **Exists:** Input validation, pass-through of supplied normalized values, optional caller-provided normalization callbacks, and item-specific error reporting.
2. **Missing:** Team-approved rubrics and mappings from actual platform/assessment values into 0–100 scores; provenance and calibration policy.
3. **Files:** `apps/api/src/modules/evidence-processing/index.ts`, `config/evidence-category-mapping.json`, `docs/day3-evidence-processing.md`.
4. **Finish:** Agree on evidence-specific rubrics, record their versions, define test cases, and only then connect authorized data sources.

### Role profiles and weights

1. **Exists:** Three role IDs and validated weight dictionaries totaling 100, consumed by the scorer.
2. **Missing:** Approved role criteria, CRUD/versioned storage, UI, audit history, and governance for changes.
3. **Files:** `config/role-weights.json`, `packages/contracts/src/scoring.ts`, `apps/api/src/modules/scoring/index.ts`.
4. **Finish:** Recruiter/team review and sign-off; then define how approved role profiles are stored and changed. Do not treat current preliminary values as hiring policy.

### Web API integration scaffold

1. **Exists:** A generic `apiRequest` helper and a `/health` API.
2. **Missing:** Any screen using the helper, API routes for business operations, and an agreed route prefix. The helper defaults to `http://localhost:3000/api`, but the only implemented route is `/health`; requests to `/api/...` currently receive 404.
3. **Files:** `apps/web/src/lib/api/client.ts`, `apps/api/src/app.ts`, `docs/api-contract.md`.
4. **Finish:** Agree on route prefix and request/response/auth contracts before implementing endpoints; add an integration test and a web/API call only after that contract exists.

### Versioning

1. **Exists:** Current `1.0.0` version is attached to scorer output and role-weight config; unsupported/mismatched requests fail.
2. **Missing:** Stored historical configurations and implementations, migration/replay procedures, and release governance.
3. **Files:** `packages/contracts/src/scoring.ts`, `config/role-weights.json`, `apps/api/src/modules/scoring/index.ts`, `docs/day4-scoring-versioning.md`.
4. **Finish:** Decide retention/version support and store immutable configuration snapshots before promising historical reproducibility.

## E. Backend and API status

Only the following routes are registered in `apps/api/src/app.ts`:

| Method and route | Purpose | Request/response | Auth | Database | Validation/errors | Status |
|---|---|---|---|---|---|---|
| `GET /health` | Basic process health response. It does not check database or integration health. | No request body; `200` JSON `{ "status": "ok" }`. | None. | None. | No input validation; fixed JSON response. | Implemented and exercised by API compatibility test. |
| Fallback for any unmatched method/path (including `GET /api/evaluations`) | Report that a route has not been implemented. This is not a business API endpoint. | `404` JSON `{ "error": { "code": "NOT_FOUND", "message": "Route not found" } }`. | None. | None. | Response parsed through `apiErrorSchema`. | Implemented and exercised by API compatibility test. |

There are no implemented candidate, evaluation, role profile, platform data, AI, comparison, ranking, or auth endpoints. `docs/api-contract.md` contains a proposal, explicitly not an active route or team approval. `scoreCandidate` and `processCandidateEvidence` are library functions; they are not controllers/endpoints.

## F. Database status

- **Technology intended:** Supabase PostgreSQL is named in the README and database notes. The Supabase JS package is installed. There is no evidence of an active project connection or working database from this codebase.
- **Existing tables/columns/relationships:** None found. There are no SQL migration files, schema files, or table declarations. Consequently there are no existing relationships to document.
- **Migrations/seeds:** `supabase/migrations/` contains only a placeholder. No migration or seed script exists.
- **Row-level security/access controls:** No RLS policy or database access control exists. API currently exposes no candidate data and has no auth middleware.
- **Persisted features:** None verifiable. Scoring and evidence processing operate on values passed into functions and return in-memory objects.
- **Planned model:** `docs/database-schema.md` suggests future auth-user references, candidates, platform evidence, role profiles/weights, evaluations/category scores, AI explanations, comparisons, and audit events. This is a design note, not a database schema.
- **Missing work:** Approve a data model, write and review migrations, establish RLS/authorization, create repositories, and test persistence without exposing privileged keys to the browser.

## G. Frontend status

- **Pages and components:** Only `App.tsx` is a visible product component; it renders “DevRank” and a scaffolding message. The component/layout/UI and feature directories contain placeholders.
- **Routes/navigation:** `router.tsx` declares a wildcard React Router route, but `main.tsx` renders `<App />` directly. The router is not mounted; there are no product routes or navigation controls.
- **Forms and validation:** None. Shared Zod contracts are not wired to forms.
- **API connection:** `apiRequest` is implemented as a generic helper, including parsing standard API errors, but no caller exists. Its default `/api` prefix does not match the existing `/health` route. It does not add auth tokens or validate successful response JSON against a schema.
- **Supabase:** Optional browser client creation exists, with URL and anon key; no login or query uses it. No service-role key is present in web example settings.
- **Loading/empty/success/error states:** None in the product UI. The API helper throws on HTTP error but is unused.
- **Dashboard, candidate detail, scoring, comparison, ranking:** Not implemented. The scoring result does not appear in the UI.
- **Mock data:** Synthetic JSON fixtures exist for tests/examples but are not imported by the current UI. There is no rendered mock dashboard.

## H. Scoring and evaluation logic

### Categories

The six fixed categories in `packages/contracts/src/scoring.ts` are:

1. `technical_skills` — Technical Skills
2. `problem_solving_dsa` — Problem-Solving and DSA
3. `relevant_project_experience` — Relevant Project Experience
4. `practical_assessment_performance` — Practical Assessment Performance
5. `communication_skills` — Communication Skills
6. `learning_adaptability` — Learning Ability and Adaptability

### Implemented calculation

- Input is validated against the candidate/evidence schemas. Evidence IDs must be unique in one scoring call.
- A category score is the arithmetic mean of that category's evidence items that are `available` and have a valid normalized value in the inclusive 0–100 range. Values are sorted before summation to make input ordering deterministic. The category mean is rounded to two decimal places.
- The overall score is calculated only when all six category scores exist: `sum(category score × role weight) / 100`, using the already rounded category scores; the result is rounded to two decimal places.
- If any category lacks a normalized score, the response lists the missing category IDs, returns available category scores, sets `evaluationStatus` to `insufficient_evidence`, and omits `overallScore`. Missing data is not treated as zero, and available weights are not renormalized.
- Scoring version is `1.0.0`. This is the only supported version/configuration. Output is checked against `evaluationResponseSchema`.
- No AI call influences numeric scoring. The scorer explicitly returns a placeholder explanatory AI section stating that no AI-generated explanation was produced.

### Preliminary weights

All rows are percentages and total 100 per role; none is approved as final criteria:

| Category | Software Developer | AI/ML Engineer | Data Analyst |
|---|---:|---:|---:|
| Technical Skills | 25 | 25 | 20 |
| Problem-Solving and DSA | 20 | 15 | 15 |
| Relevant Project Experience | 20 | 20 | 20 |
| Practical Assessment Performance | 15 | 15 | 15 |
| Communication Skills | 10 | 10 | 15 |
| Learning Ability and Adaptability | 10 | 15 | 15 |

### Missing data, evidence, and known limits

Evidence is returned in the evaluation object and category scores reference evidence IDs. The evidence-processing wrapper additionally reports rejected, unmapped, and unnormalized evidence. However, the current API has no route that returns those results, and no database or UI stores/displays them.

The type-to-category mapping is explicit: technical screen → technical skills; coding assessment → problem-solving/DSA; project and portfolio → project experience; work sample → practical performance; structured interview → communication; learning record → learning/adaptability; `other` → unmapped. A caller must supply normalization for raw values; no raw-score rules are configured by default.

Potential product risks/gaps include preliminary, uncalibrated criteria and weights; no team approval record; no protected-attribute or adverse-impact evaluation; and no recruiter-facing explanation or human workflow beyond a literal decision-support notice in the response contract. The notice does not itself ensure a human makes the decision. Treat output as a development artifact until the criteria, validation, governance, and intended-use controls are reviewed.

## I. AI/LLM integration

- **Provider/model/library:** `docs/ai-design.md` mentions an intended LangChain/Groq stack; `GROQ_API_KEY` is an optional API environment name. No model or model identifier is configured in executable code. The dependencies do not include a Groq or LangChain client.
- **Prompts/service:** `apps/api/src/modules/ai/` is a placeholder. There are no prompt files or provider calls.
- **Model input/output:** No data is sent to a model. `aiAnalysisSchema` and `aiExplanation` response shape are contracts only. The deterministic scorer creates a fixed non-AI explanation object.
- **Structured validation:** Zod schema exists for some AI output types, but no AI output is currently generated or passed through it.
- **Timeouts/errors/unavailable service:** Not implemented because no AI service exists.
- **Status:** AI analysis is **Not Implemented**, not real or mocked model analysis. Do not infer it from `GROQ_API_KEY`, contracts, or docs.

## J. Testing and current errors

### Checks run for this report

On 2026-10-12, the following existing workspace commands completed successfully:

| Check | Result |
|---|---|
| `npm test` | Passed. API: 34 tests across 3 files; shared contracts: 9 tests across 1 file; web: no test files found, exits successfully because `--passWithNoTests` is configured. Total executed assertions reported by Vitest: 43 tests passed. |
| `npm run build` | Passed for contracts, API, and web/Vite production bundle. |
| `npm run typecheck` | Passed for contracts build plus API and web TypeScript checks. |

No source files were edited as part of this status inspection. Build commands may refresh generated/ignored `dist` output. `npm run lint` was not run; no workspace defines a lint script, so the root command has no configured linter to execute.

### Test coverage and unverified areas

- API tests cover scorer behavior, evidence pipeline behavior, health response, and fallback 404. Contract tests cover shared Zod contracts.
- No web unit, component, or end-to-end tests exist. The web test command passing with no test files is not product coverage.
- No live database, Supabase auth, GitHub, LeetCode, HackerRank, Groq, browser-based user flow, or deployment test was performed. These integrations are not implemented; their runtime behavior is **Unverified**.
- No environment values or credentials were inspected or included in this report. Environment variable names were taken from example files and source schema only.
- No package install was run. Build/test success indicates the current local dependency tree sufficed for these checks; reproducibility on a clean install was not tested.

### Issues and risks found

1. **Stale top-level documentation:** `README.md` says scoring and business UI are not implemented; scoring is now implemented as a library with tests. The UI still is not implemented. Update the README to distinguish these.
2. **API base path mismatch:** web helper defaults to `/api`, while the only live route is `/health`. The helper is currently unused, so this is a known integration gap rather than a failing existing screen.
3. **No business route/auth/persistence:** business operations cannot be used through HTTP and no user/data access controls exist.
4. **Weights and rubrics remain preliminary:** code-level validation proves shape and arithmetic, not job relevance, fairness, or predictive validity.
5. **No configured linter or CI:** package scripts have no lint task; `.github/workflows/` has no workflow file.
6. **Git worktree note:** `.env.example` was already modified when this inspection began (`git status --short`). It was not edited or reverted here. Its values are not reproduced in this report.

No broken imports or compilation failures were observed in the checks above.

## K. SRS compliance checklist

**SRS not found.** The checklist below is a provisional gap list based on topics named in the task and repository architecture/API/scoring docs. It must not be represented as a requirement-by-requirement SRS audit.

| SRS requirement/theme (provisional) | Current status | Evidence | Missing work | Priority |
|---|---|---|---|---|
| Authentication and access control | **Not Implemented** | Optional Supabase client/config only; no auth service or middleware. | Define roles/tenant boundaries, implement login/session validation and API authorization; add RLS policies with migrations. | High |
| Candidate CRUD | **Not Implemented** | Candidate schemas and placeholder folders only. | Database model, repository/API validation, authorized UI forms, ownership rules, and tests. | High |
| Authorized GitHub API integration | **Not Implemented** | Optional token name and empty integration folder. | Define permission/consent, scope, retrieval and failure behavior; implement official authorized access and tests. | Medium |
| LeetCode/HackerRank authorized or candidate-provided data | **Not Implemented** | Platform enum/schema only. | Select permitted official/authorized import or user-provided workflow. Do not scrape without authorization. | Medium |
| Input validation and data normalization | **Partially Implemented** | Zod contracts, per-item evidence validation and callback-based normalization. | Team-approved platform/assessment rubrics; integrate with authenticated inputs and persist provenance. | High |
| Six technical scoring categories | **Complete and Verified in scorer** | Six IDs/descriptions and scorer tests. | Recruiter/team acceptance of definitions and assessment rubrics. | High |
| Role-based weights | **Partially Implemented** | Three preliminary configs validated to total 100. | Team approval, role profile lifecycle, audit/version management. | High |
| Deterministic scoring | **Complete and Verified in library** | Versioned scorer and tests for fixtures/order/boundaries/missing data. | Integrate through API and review formula/rounding/completeness policy before use. | High |
| Structured AI analysis | **Not Implemented** | Output contracts only; no provider/prompt/service. | Define privacy-safe inputs, prompts/provider, structured validation, error/timeouts, and tests; keep AI away from numeric scores. | Medium |
| Dashboard | **Not Implemented** | Empty feature folder; app is a scaffold. | Implement views with loading/empty/error states and authorized API data. | Medium |
| Candidate comparison and ranking | **Not Implemented** | Comparison and ranking schemas only. | Define stable ranking eligibility/ties/missing evidence and comparison API/UI. | Medium |
| Missing data is not a zero / not a negative inference | **Implemented in scorer; UI workflow absent** | Missing categories carry no score; overall score omitted. | Preserve semantics in UI, reports, downstream ranking, exports, and tests. | High |
| Security, logging, testing | **Partially Implemented** | Env validation, CORS config, Zod validation, API/contract tests. | Auth/RLS, privacy and retention review, structured operational logging, CI, frontend/integration/security tests. | High |
| Human recruiter retains final decision | **Partially Implemented as contract wording** | Response schema includes a decision-support notice. | Product workflow and policy must prevent automated rejection/selection and present evidence/limitations. | High |

Do not implement unauthorized LeetCode scraping, unauthorized HackerRank scraping, or LinkedIn scraping. Missing evidence must remain missing, not become a zero or a negative judgment. Any eventual ranking/evaluation must support human review and decision-making.

## L. Remaining work and recommended order

Items are ordered to reduce interface drift before building dependent features. They are recommendations, not approved scope.

### Urgent documentation/integration gaps

| Task ID | Task name | What needs to be done | Dependencies | Relevant files | Acceptance criteria | Priority | Status |
|---|---|---|---|---|---|---|---|
| BUG-001 | Reconcile README with current code | Update the project overview/next steps to mention the implemented scorer and evidence pipeline, while retaining that UI, business APIs, auth, AI, and persistence are absent. | Verify owner decisions before making claims. | `README.md`, `docs/day2-scoring-implementation.md`, `docs/day3-evidence-processing.md`, `docs/day4-scoring-versioning.md` | README accurately separates implemented library behavior from non-existent product workflows. | Medium | Not started |
| BUG-002 | Agree on API path and error contract | Choose whether business routes are under `/api`; align web helper base URL and API routes once an endpoint is approved. | Frontend/backend owners agree on route and contracts. | `apps/web/src/lib/api/client.ts`, `apps/api/src/app.ts`, `docs/api-contract.md` | A real client call reaches a registered endpoint and its success/error payload is tested end to end. | High | Not started |

### Unfinished core features

| Task ID | Task name | What needs to be done | Dependencies | Relevant files | Acceptance criteria | Priority | Status |
|---|---|---|---|---|---|---|---|
| DEV-001 | Approve data model, auth, and access control | Agree on tenant/user ownership, candidate/evidence/role/evaluation relations, retention, auth flow, and RLS; write reviewed migrations. | Product/SRS decisions; Supabase project credentials configured locally by an authorized owner. | `docs/database-schema.md`, `supabase/migrations/`, `apps/api/src/services/auth/`, `apps/api/src/repositories/` | Migrations create reviewed schema and policies; tests prove authorized access and cross-user isolation; no secrets enter source control. | High | Not started |
| DEV-002 | Implement candidate CRUD | Add validation, persistence, API routes and forms for recruiter-managed candidate records. | DEV-001; API route decision BUG-002. | `packages/contracts/src/candidate.ts`, `apps/api/src/routes/`, `apps/api/src/services/candidates/`, `apps/web/src/features/candidates/` | Authorized recruiter can create/read/update/archive candidates; validation and permission failures are tested. | High | Not started |
| DEV-003 | Expose evaluation pipeline through API | Add an agreed authenticated route that accepts evidence, invokes `processCandidateEvidence`, returns validated result and processing diagnostics, and documents errors. | DEV-001, DEV-002, BUG-002; review preliminary weight/scoring policy. | `apps/api/src/modules/evidence-processing/index.ts`, `apps/api/src/modules/scoring/index.ts`, `apps/api/src/routes/`, `docs/api-contract.md` | Valid request returns schema-valid versioned evaluation; invalid/missing evidence behaves as documented; API integration tests cover health, auth, validation, and failures. | High | Not started |
| DEV-004 | Approve and operationalize normalization/weights | Define defensible rubrics, category mapping, role weights, and versioned change approvals. | Recruiter/team review and assessment design. | `config/role-weights.json`, `config/evidence-category-mapping.json`, `docs/day4-scoring-versioning.md` | Approved configurations are versioned, tested against documented examples, and explicitly marked approved only after evidence of approval. | High | Not started |
| DEV-005 | Build evaluation dashboard and candidate views | Implement routed UI for list/detail/evaluation, connect to authorized API, and handle loading/empty/success/error states. | DEV-002, DEV-003 and shared contract agreement. | `apps/web/src/App.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/features/`, `apps/web/src/lib/api/client.ts` | UI shows evidence, category scores, missing categories and score version; no missing data appears as zero; browser tests cover primary flow. | Medium | Not started |
| DEV-006 | Implement authorized platform evidence intake | Decide which official/authorized provider APIs or candidate-upload paths are permitted; add isolated adapters and provenance/error reporting. | Consent/privacy policy, auth, normalization rules. | `apps/api/src/integrations/`, `packages/contracts/src/platform-data.ts` | Each source has permission documentation, source timestamps, unavailable/error states, and tests; no unauthorized scraping. | Medium | Not started |
| DEV-007 | Add comparison and ranking | Specify eligibility, tie behavior, missing-evidence handling and human review; implement services/API/UI. | DEV-003, approved score/weights, candidate persistence. | `packages/contracts/src/comparison.ts`, `packages/contracts/src/ranking.ts`, `apps/api/src/services/comparisons/`, `apps/api/src/services/rankings/`, `apps/web/src/features/` | Stable, tested comparison/ranking never treats missing categories as zero and clearly presents evidence/limitations for recruiter review. | Medium | Not started |
| DEV-008 | Add AI explanation service | Implement provider behind API, pass only approved minimum necessary data, validate structured output, and handle timeout/provider errors. AI must not alter numeric scores or decisions. | Privacy review, API/auth, explicit AI requirements and provider/model decision. | `apps/api/src/modules/ai/`, `packages/contracts/src/ai-analysis.ts`, `docs/ai-design.md` | Tests cover valid/invalid output and provider failures; no key in web bundle; AI output remains separate from numeric score fields. | Medium | Not started |

### Future quality work

| Task ID | Task name | What needs to be done | Dependencies | Relevant files | Acceptance criteria | Priority | Status |
|---|---|---|---|---|---|---|---|
| QLT-001 | Add CI, linting, and frontend tests | Configure lint, run builds/tests in CI, add web component/integration coverage. | Stable app/API features. | `package.json`, workspace package files, `.github/workflows/`, `apps/web/tests/` | CI fails on lint/type/test/build errors and runs a meaningful web test suite. | Medium | Not started |
| QLT-002 | Add audit, observability, and retention controls | Define safe structured logs, audit events for score/config changes, privacy retention/deletion, and monitoring. | DEV-001 and persistence. | `apps/api/src/middleware/`, `apps/api/src/services/`, `docs/database-schema.md` | Logs avoid secrets/unnecessary candidate data; audited operations and deletion/retention are tested. | Medium | Not started |
| QLT-003 | Validate scoring use and fairness | Review construct validity, inter-rater consistency, adverse impact, and calibration with qualified stakeholders before real hiring use. | Approved rubrics, representative lawful evaluation data, legal/privacy review. | `docs/scoring-rules.md`, `config/role-weights.json`, future evaluation analytics | Documented review and monitoring gates exist; no unsupported claim of predictive validity. | High | Not started |

## M. How to run the project

These commands come from the current package scripts and setup docs. A fresh install was not run during this inspection.

1. Install Node.js `>=20 <25` and npm (10 or newer is recommended in `README.md`).
2. From the repository root, run `npm install`.
3. For local development, copy `.env.example` to the root `.env` for API settings and `apps/web/.env.example` to `apps/web/.env` for Vite settings. The examples contain placeholders; configure them locally if needed. Do not copy server-only secrets into the web app or commit populated `.env` files.
4. Start both development servers with `npm run dev`; the documented web address is `http://localhost:5173`, the API listens at `http://localhost:3000`, and the health check is `http://localhost:3000/health`.
5. Available root commands: `npm run build`, `npm run typecheck`, `npm test`, and `npm run lint`. Build/typecheck/test were run successfully for this report. Lint is not configured in workspaces.

Environment **names** identified in example/source configuration (no values are reproduced): `API_PORT`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, `GROQ_API_KEY`, `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`. The Supabase service-role key must stay server-side. Most are optional in the current schema; Supabase, GitHub, and Groq are not needed to run the current health route or in-process scorer. There are no verified database setup/migration commands because no migration exists.

## N. Handover summary

- **Working now:** TypeScript workspaces build; shared contracts validate; API `/health` and 404 work; in-process evidence validation/mapping and deterministic versioned scoring pass tests.
- **Partially working:** Raw evidence normalization requires caller-supplied rules; role weights and category policy are preliminary; API client and Supabase browser client are scaffolds only.
- **Most important current problems:** No SRS found; no candidate CRUD, authentication, database schema/persistence, business API, product UI, authorized platform intake, AI service, comparison, or ranking. README is stale, and web `/api` base path does not match current API routes.
- **Next three recommended tasks:** (1) reconcile README and settle the API prefix/contract; (2) approve the data model/auth/access control and create reviewed migrations; (3) implement candidate CRUD and an authenticated endpoint that exposes the existing evidence/scoring pipeline.
- **Could not verify:** Any live Supabase/provider connectivity, deployment behavior, browser workflows, clean-install reproducibility, actual SRS compliance, or team approval of weights/rubrics. No SRS was present to compare against.
