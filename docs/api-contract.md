# Proposed candidate evaluation API contract

Shared Zod schemas and inferred types live in `packages/contracts/src`. Import these from both workspaces instead of redefining request or response shapes. Current starter contracts cover candidates, platform evidence and availability, evaluation requests/status, scoring categories and weights, AI analysis, comparisons, rankings, and standard API errors. These are initial shapes for team review, not a finalized API specification. Coordinate changes with all owners.

## Current HTTP conventions

- `GET /api/health` returns HTTP 200 with `{ "status": "ok" }`.
- The prior scaffold path `GET /health` remains as a compatibility alias.
- Successful resource responses use a resource-specific JSON object; a universal success envelope is not required for health.
- Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. `details` is optional and contains field paths/messages for validation failures only.
- Unknown routes return HTTP 404 with code `NOT_FOUND`. Malformed JSON returns HTTP 400 with code `INVALID_JSON`. Unexpected errors do not expose exception messages or stacks.
- Zod body validators are registered on routes with `validateBody(schema)`; query and path inputs use `validateQuery` and `validateParams`.
- New evaluations use six active GitHub + LeetCode categories under schema/scoring version `4.0.0`; category weights and deterministic source-specific formulas are documented in `docs/scoring-rules.md`. Historical v1/v2/v3 snapshots are read-only and are never recalculated or converted as v4.

## Authentication

Candidate routes require `Authorization: Bearer <supabase-access-token>`. The API verifies the token through Supabase Auth (`auth.getUser(token)`) and never trusts a client-supplied user ID or role. The verified ID, email confirmation state, profile role/status, and original token are attached to request-local auth context; the token is forwarded only to a request-scoped Supabase client so PostgreSQL RLS sees `auth.uid()`. Tokens are not returned or logged. Recruiter candidate routes require a confirmed email and approved recruiter profile; admin routes require a confirmed email and approved admin profile, and their database functions independently recheck authorization.

Missing, malformed, invalid, or expired credentials return HTTP 401 (`UNAUTHENTICATED`). Supabase Auth outages or missing backend configuration return HTTP 503 (`AUTH_SERVICE_UNAVAILABLE`). Unconfirmed or unapproved recruiter access returns HTTP 403. Candidate reads and writes are scoped to the authenticated owner. A missing candidate and another user's candidate both return HTTP 404 to avoid disclosing whether the other user's record exists. `GET /api/auth/me` returns the verified user's profile and access state. Admins can list applications at `GET /api/admin/recruiters?status=pending|approved|rejected` and decide a pending application at `PATCH /api/admin/recruiters/:id/decision` with `{ "decision": "approved" | "rejected" }`.

## Candidate API

All endpoints are under `/api/candidates` and require a valid bearer token.

| Method and path | Behavior | Success |
| --- | --- | --- |
| `POST /api/candidates` | Create for the authenticated owner; client ownership fields are rejected | `201` with candidate object |
| `GET /api/candidates?page=1&pageSize=20` | List active records for that owner, newest first with stable ID tie-break | `200` with `{ items, page, pageSize, total }` |
| `GET /api/candidates/:id` | Read one active record owned by the caller | `200` with candidate object |
| `PATCH /api/candidates/:id` | Update supported fields only | `200` with updated candidate object |
| `DELETE /api/candidates/:id` | Archive the record; related evidence and evaluation history are retained | `204` with no body |

Create request example:

```json
{
  "name": "Taylor Example",
  "email": "taylor@example.com",
  "githubUsername": "taylor-dev",
  "leetcodeUsername": "taylor_codes",
  "hackerrankUsername": "taylor-dev"
}
```

The response candidate includes `id`, `name`, optional `email` and platform usernames, `createdAt`, and `updatedAt`; it never includes `owner_id`. Candidate storage uses the existing `owner_id` column (the verified Supabase Auth user ID), rather than introducing a duplicate `created_by` column. Platform inputs are usernames, not URLs. Name is trimmed and limited to 120 characters; email is validated; usernames are trimmed, limited to 100 characters, and accept only letters, digits, `_`, `.`, and `-`. Page starts at 1 and `pageSize` is 1–100. Unknown fields are rejected; `id`, `owner_id`, and `created_by` are not writable.

The existing contracts do not establish a supported role list or `targetRole` field, so candidate CRUD does not add one. Role assignment stays in role profiles/evaluations until the team agrees on its contract. All request/response schemas live in `packages/contracts/src/candidate*.ts`.

Validation errors return HTTP 400 (`VALIDATION_ERROR`) with field paths and messages. Unknown candidates return HTTP 404 (`NOT_FOUND`); duplicate conflicts return HTTP 409 (`CONFLICT`); missing database configuration or database failures return sanitized HTTP 503 errors. Unexpected errors use the existing generic 500 response convention.

## GitHub profile lookup

`GET /api/github?profile=<username-or-profile-URL>` requires a confirmed, approved recruiter Supabase Bearer token. The `profile` query value accepts a GitHub username or an HTTPS `github.com/<username>` profile URL. The API calls GitHub's official REST API and returns profile URL, public repository count, followers/following, and metadata for at most the 100 most recently updated owned public repositories (name, URL, description, stars, forks, primary language, update time). `repositoriesTruncated` indicates when the API's public repository count exceeds the returned sample. This lookup does not persist data or imply a verified score.

Invalid profile input returns 400 (`INVALID_GITHUB_PROFILE`); an unknown user returns 404 (`GITHUB_USER_NOT_FOUND`); primary or secondary GitHub rate limits return 429 (`GITHUB_RATE_LIMITED`) based on status, rate-limit headers, or sanitized inspection of the provider message; timeout, network, authentication, malformed provider responses, and other provider failures return sanitized errors. Provider response bodies, stack traces, and credentials are not returned. Optional backend-only `GITHUB_TOKEN` increases GitHub REST API quota; anonymous public access is used when it is unset. Calls have an 8-second timeout and repository retrieval is capped at two 50-repository pages. Optional contribution context uses `POST https://api.github.com/graphql` with a separate backend-only `GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN`; the token must omit optional `read:user` scope. It reads `contributionCalendar` daily counts, total commit/PR/issue/review contributions, and bounded commit contributions by repository. This context is unverified and non-scoring. Token scopes are not inspected at runtime. Missing token/history, rate limits, partial data, and provider failures remain explicitly unavailable/partial instead of zero.

## Candidate-provided platform data

`POST /api/candidates/:id/platform-data` requires a valid Bearer token and a candidate owned by the authenticated user. It stores an append-only entry in the existing owner-scoped `platform_evidence` table; candidate ID and owner ID are set server-side. It accepts LeetCode and HackerRank submissions and never scrapes provider pages.

`POST /api/candidates/:id/platform-data/github-sync` also requires approved-recruiter access and an owned, active candidate. The request is `{ "profile": "username-or-public-github-profile-url" }`; the API calls GitHub's official REST API, validates its public profile/repository fields, then stores an append-only `github` evidence row using the request-scoped Supabase client. The response includes the validated profile snapshot and `provenance: "github_api"`. Provider errors are returned as sanitized API errors, and a failed lookup does not create evidence. The candidate details page shows sync status, a short repository sample, and an error/retry path.

`POST /api/candidates/:id/platform-data/leetcode-sync` requires the same approved-recruiter and active candidate ownership checks. The request is `{ "profile": "username-or-https://leetcode.com/u/username/" }`. The backend calls the configured `LEETCODE_API_BASE_URL` `/:username`, `/:username/solved`, and `/:username/contest` endpoints in parallel. The profile and solved endpoints are required; contest data is supplementary and omitted when unavailable or malformed. Solved counts use `solvedProblem`, `easySolved`, `mediumSolved`, and `hardSolved`; contest data uses `contestAttend`, `contestRating`, `contestGlobalRanking`, `totalParticipants`, and `contestTopPercentage`. Only supported values are persisted as total/easy/medium/hard solved counts and contest attendance/rating/ranking/participant/top-percentage fields. Missing values remain absent; profile fields alone do not count as statistics, and a response without any supported solved count is rejected. The response uses `provenance: "alfa_leetcode_api"`, identifies `provider: "alfa-leetcode-api"`, and includes the retrieved timestamp. This third-party wrapper uses LeetCode's GraphQL API; its public statistics are not independent verification of candidate identity and are not consumed by the deterministic evaluation scorer. See the provider's [OpenAPI definition](https://github.com/alfaarghya/alfa-leetcode-api/blob/main/swagger.yaml) for the documented endpoint shapes. Each endpoint request has an eight-second timeout and no retry. A provider timeout returns 504, a missing user 404, rate limiting 429, and malformed/unavailable required provider or storage failures return sanitized errors. The previous saved evidence remains available after failed required requests or persistence errors.

LeetCode request:

```json
{
  "platform": "leetcode",
  "profileUrl": "https://leetcode.com/u/example/",
  "handle": "example",
  "availability": "available",
  "statistics": { "problemsSolved": 120, "easySolved": 55, "mediumSolved": 55, "hardSolved": 10 }
}
```

HackerRank request:

```json
{
  "platform": "hackerrank",
  "handle": "example",
  "availability": "available",
  "statistics": { "points": 0, "badges": 2, "certificates": 1 }
}
```

For both platforms, provide either `profileUrl` or `handle` (or both), and explicit `availability`: `available`, `unavailable`, or `not_provided`. Available data requires at least one supported statistic. LeetCode supports nonnegative integer counts (`problemsSolved`, `easySolved`, `mediumSolved`, `hardSolved`); HackerRank supports nonnegative `points` and integer `badges`/`certificates`. Statistics are optional individually; absent fields remain absent, and `0` is preserved as a real value. Non-available submissions omit `statistics`. Unknown fields and platform-mismatched profile URLs are rejected.

Success returns HTTP 201 with `id`, `candidateId`, `platform`, `availability`, `provenance: "candidate_provided"`, optional `profileUrl`, `handle`, and `statistics`, and `submittedAt` (ISO timestamp). HTTP 400 (`VALIDATION_ERROR`) covers malformed or unsupported fields; 401 (`UNAUTHENTICATED`) requires valid credentials; 404 (`NOT_FOUND`) covers missing, archived, or another owner's candidate; and 503 reports unavailable storage. Candidate-provided means the recruiter submitted the candidate's reported data; it has not been independently verified. The candidate details page provides separate LeetCode and HackerRank forms for explicit availability and supported manually submitted metrics. These entries use `provenance: "candidate_provided"`, remain unverified, and are not used as scores. The forms preserve zero-valued metrics and show validation, saving, saved, and error states. Automated LeetCode sync is a separate route; HackerRank provider sync is not implemented.

No migration is required for platform data UI: the existing `platform_evidence` schema already allows GitHub/LeetCode/HackerRank source rows, ties each record to its candidate and owner, and has owner-scoped RLS policies.

## Evaluation workflow (Issue #11)

Both evaluation endpoints require a Supabase Bearer token and approved recruiter access. The API derives supported roles and weights from the validated `config/role-weights.json`; the browser does not own a duplicate role list.

| Method and path | Behavior | Success |
| --- | --- | --- |
| `GET /api/evaluations/roles` | Return configured roles, display names, and category weights | `200` with `{ roles: [...] }` |
| `POST /api/evaluations` | Verify candidate ownership, run the deterministic scorer for the requested configured role, and persist a historical evaluation | `201` with persisted ID/status, candidate, role, timestamp, result, and evidence limitations |
| `GET /api/evaluations/:id` | Retrieve a persisted evaluation owned by the caller | `200` with the validated persisted result |
| `GET /api/evaluations/role-profiles` | Return the caller's role profiles with active-v4 six-category usability status | `200` with `{ items: [...] }` |
| `POST /api/candidates/:id/evaluations` | Persist an evaluation using an owner-defined role profile | `201` with persisted evaluation |
| `GET /api/candidates/:id/evaluations` | Return up to 20 recent caller-owned supported result snapshots for an owned candidate | `200` with `{ items: [...] }` |
| `POST /api/evaluations/:id/ai-analysis` | Generate an explanation for a caller-owned persisted evaluation without changing it | `200` with the unchanged evaluation and a separate analysis, or `analysis: null` when evidence is insufficient |

The request is `{ "candidateId": "<uuid>", "roleId": "software_developer" }`. Unknown or other-owner candidates return the same `404 NOT_FOUND`. Requests are schema-validated and callers cannot supply candidate ownership, category scores, evidence, or role weights. Evaluation responses use the shared `evaluationRunResponseSchema` and its nested `evaluationResponseSchema`.

The `/api/evaluations` workflow stores a row in `evaluations`, including target role, scoring version, effective weight snapshot, evidence snapshot, and validated result. Configured-role runs use the active v4 20/20/15/10/10/25 weights; they do not require an owner-created role profile. `POST /api/candidates/:id/evaluations` accepts owner-defined profiles with six valid v4 category weights. Historical v1/v2/v3 results are preserved and displayed read-only. Custom profiles with previous category keys are not rewritten; their owner must explicitly reconfigure them before use. Migrations `20261012000000_evaluation_results.sql` and `20261013000000_configured_role_evaluations.sql` add result/weight snapshots, permit `insufficient_evidence`, and allow configured-role evaluations to store `target_role` without a role-profile foreign key. Apply only under the separately approved migration deployment plan.

The evaluation repository derives v4 category indexes only from saved GitHub and LeetCode evidence snapshots using the formulas in `docs/scoring-rules.md`. A missing, malformed, or partial source remains unscored and prevents an overall weighted score; no missing value becomes zero. LeetCode candidate-reported evidence stays separate from provider evidence. These indexes are not validated hiring criteria or measures of quality/competence.

AI analysis requires a valid bearer token and approved recruiter profile. The request body must be empty; evaluation data, candidate details, evidence, scores, and weights are loaded from owner-scoped persisted records. A completed response is `{ "status": "completed", "evaluation": <persisted evaluation>, "analysis": <validated explanation> }`; insufficient evidence returns `{ "status": "insufficient_evidence", "evaluation": <persisted evaluation>, "analysis": null }` without calling Groq. `AI_NOT_CONFIGURED`, `AI_PROVIDER_AUTH_FAILED`, `AI_RATE_LIMITED`, and `AI_UNAVAILABLE` errors use the standard error envelope with HTTP 503; invalid provider output returns `502 AI_INVALID_RESPONSE`. The analysis is not persisted and cannot change deterministic scores or evaluation snapshots. Backend-only settings are `GROQ_API_KEY`, `GROQ_MODEL`, and `AI_TIMEOUT_MS`; see `docs/day5-ai-analysis.md`.

Use the Evaluations item in recruiter navigation, or select **Evaluate candidate** from a candidate profile. The evaluation page shows the active v4 report, category indexes, source metrics, formulas, weights, incomplete evidence states, and the overall weighted index only when all six categories are scoreable. Candidate-scoped owner-defined evaluation is available when saved profiles satisfy the v4 weight contract. Saved GitHub/LeetCode snapshots remain unverified, provenance-labeled evidence; report rendering uses the snapshot persisted with that evaluation.

## Dashboard, comparisons, and rankings (Issue #16)

All three insight endpoints require a valid Supabase Bearer token and approved recruiter access. Queries use that recruiter's JWT, add an explicit `owner_id` filter, and remain subject to RLS. Request and response types are shared Zod contracts in `packages/contracts`.

| Method and path | Behavior |
| --- | --- |
| `GET /api/dashboard` | Return active owned-candidate count, evaluation count/status counts, and up to ten most recent evaluations. A numeric score is included only for a completed row with a valid stored number; incomplete rows have no score. |
| `POST /api/comparisons` | Accept positional `candidateIds` and `evaluationIds` (2–5 unique pairs). Require caller-owned evaluations that match the candidate IDs and share the same supported role and scoring version. Completed and insufficient-evidence snapshots can be compared; pending, in-progress, failed, missing, malformed, or inconsistent results fail explicitly. |
| `GET /api/rankings?roleId=software_developer&page=1&pageSize=20` | Rank each candidate's latest evaluation for the selected role when it is completed, has a valid result snapshot, and matches the requested/current scoring version. Order by score descending, then evaluation time ascending, candidate ID, and evaluation ID. Ranks are stable ordinal positions; pagination uses that order. Incomplete, incompatible-version, missing-score, and invalid-snapshot records are reported in `excluded`, never scored as zero. |

Comparisons require equal `target_role`, `scoring_version`, and role-weight snapshots; result snapshots are validated against the row. Rankings reject an eligible result set with mixed role-weight snapshots. An unsupported requested scoring version returns `409 SCORING_VERSION_UNSUPPORTED`; comparisons of mixed roles, scoring versions, or weight sets return `409 ROLE_VERSION_MISMATCH`, `409 SCORING_VERSION_MISMATCH`, or `409 ROLE_CONFIGURATION_MISMATCH`. Missing or other-owner evaluation IDs return the same `404 NOT_FOUND`. A persisted result that cannot be validated returns `409 EVALUATION_RESULT_UNAVAILABLE`. The dashboard verifies that its supported status counts sum to the total and returns `409 EVALUATION_STATUS_UNSUPPORTED` if the database contains an unrecognized status.

**Deployment dependency:** dashboard summaries use base candidate/evaluation fields. Comparison and ranking select `evaluations.target_role` and `evaluations.evaluation_result` (and compare `scoring_version`); these fields are provided by the evaluation-persistence migrations, whose production readiness and migration-history reconciliation remain unresolved. If the database does not expose them, these endpoints fail closed with `503 EVALUATION_SCHEMA_UNAVAILABLE`. Do not run `supabase db push` or manually repair migration history as a workaround. Resolve the separate production audit, confirm the actual catalog and ledger, and approve a deployment plan before enabling these endpoints in production.
