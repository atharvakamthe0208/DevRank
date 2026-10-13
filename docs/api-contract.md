# Proposed candidate evaluation API contract

Shared Zod schemas and inferred types live in `packages/contracts/src`. Import these from both workspaces instead of redefining request or response shapes. Current starter contracts cover candidates, platform evidence and availability, evaluation requests/status, scoring categories and weights, AI analysis, comparisons, rankings, and standard API errors. These are initial shapes for team review, not a finalized API specification. Coordinate changes with all owners.

## Current HTTP conventions

- `GET /api/health` returns HTTP 200 with `{ "status": "ok" }`.
- The prior scaffold path `GET /health` remains as a compatibility alias.
- Successful resource responses use a resource-specific JSON object; a universal success envelope is not required for health.
- Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. `details` is optional and contains field paths/messages for validation failures only.
- Unknown routes return HTTP 404 with code `NOT_FOUND`. Malformed JSON returns HTTP 400 with code `INVALID_JSON`. Unexpected errors do not expose exception messages or stacks.
- Zod body validators are registered on routes with `validateBody(schema)`; query and path inputs use `validateQuery` and `validateParams`.
- The active shared scoring contract defines five categories. The initial database migration leaves category keys unconstrained for forward compatibility; the API validates evaluation results against the current shared enum. Persisted v1 evaluation snapshots use a read-only legacy schema.

## Authentication

Candidate routes require `Authorization: Bearer <supabase-access-token>`. The API verifies the token through Supabase Auth (`auth.getUser(token)`) and never trusts a client-supplied user ID or role. The verified ID, email confirmation state, profile role/status, and original token are attached to request-local auth context; the token is forwarded only to a request-scoped Supabase client so PostgreSQL RLS sees `auth.uid()`. Tokens are not returned or logged. Recruiter candidate routes require a confirmed email and approved recruiter profile; admin routes require a confirmed email and approved admin profile, and their database functions independently recheck authorization.

Missing, malformed, invalid, or expired credentials return HTTP 401 (`UNAUTHENTICATED`). Supabase Auth outages or missing backend configuration return HTTP 503 (`AUTH_SERVICE_UNAVAILABLE`). Unconfirmed or unapproved recruiter access returns HTTP 403. Candidate reads and writes are scoped to the authenticated owner. A missing candidate and another user's candidate both return HTTP 404 to avoid disclosing whether the other user's record exists. `GET /api/auth/me` returns the verified user's profile and access state. Admins can list applications at `GET /api/admin/recruiters?status=pending|approved|rejected` and decide a pending application at `PATCH /api/admin/recruiters/:id/decision` with `{ "decision": "approved" | "rejected" }`.

## Evaluation API

All evaluation endpoints require a valid bearer token and an approved recruiter profile. Candidate and role-profile ownership are checked by the API and RLS.

| Method and path | Behavior | Success |
| --- | --- | --- |
| `POST /api/candidates/:id/evaluations` | Creates a historical evaluation for an owned active candidate. Body: `{ "roleProfileId": "<uuid>" }`. | `201` with persisted evaluation and deterministic result |
| `GET /api/evaluations/:id` | Retrieves one evaluation owned by the caller. | `200` with the persisted evaluation |

The selected role profile name must match a supported shared role ID and its weights must define the five shared categories totaling 100. Invalid profiles return `422` (`ROLE_CONFIGURATION_INVALID`); inaccessible candidates/roles and evaluations return `404`. The response has `id`, `candidateId`, `roleProfileId`, `status` (`completed` or `insufficient_evidence`), `createdAt`, and `result` using the shared `evaluationResponseSchema`. Each explicit request creates a new record. Insufficient evidence retains category statuses and evidence references and omits `overallScore`; provider snapshots and raw platform metrics are not converted to scores. Only normalized evidence matching the shared evidence contract is scored. Scoring version and effective weights are persisted with the validated result. The repository separately attaches an `aiAnalysis` result; missing configuration/provider failures do not discard deterministic scores. AI analysis failure status is independent of evaluation status.

Migration `20261012000000_evaluation_results.sql` adds the result and weight snapshots and allows `insufficient_evidence`; apply it to the intended Supabase project before using the endpoints. The five-category v2 contract is the active scorer source of truth; six-category snapshots use the separate read-only legacy contract; the older four-category note below is historical and should be reconciled separately.

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

`GET /api/github?profile=<username-or-profile-URL>` requires the same Supabase Bearer token as candidate routes. The `profile` query value accepts a GitHub username or an HTTPS `github.com/<username>` profile URL. The API calls GitHub's official REST API and returns profile URL, public repository count, followers/following, and metadata for at most the 100 most recently updated owned public repositories (name, URL, description, stars, forks, primary language, update time). `repositoriesTruncated` indicates when the API's public repository count exceeds the returned sample. This lookup does not persist data or imply a verified score.

Invalid profile input returns 400 (`INVALID_GITHUB_PROFILE`); an unknown user returns 404 (`GITHUB_USER_NOT_FOUND`); primary or secondary GitHub rate limits return 429 (`GITHUB_RATE_LIMITED`) based on status, rate-limit headers, or sanitized inspection of the provider message; timeout, network, authentication, malformed provider responses, and other provider failures return sanitized errors. Provider response bodies, stack traces, and credentials are not returned. Optional backend-only `GITHUB_TOKEN` increases GitHub API quota; anonymous public access is used when it is unset. Calls have an 8-second timeout and repository retrieval is capped at two 50-repository pages.

## Candidate-provided platform data

`POST /api/candidates/:id/platform-data` requires a valid Bearer token and a candidate owned by the authenticated user. It stores an append-only entry in the existing owner-scoped `platform_evidence` table; candidate ID and owner ID are set server-side. It accepts LeetCode and HackerRank submissions and never scrapes provider pages.

`POST /api/candidates/:id/platform-data/github-sync` also requires approved-recruiter access and an owned, active candidate. The request is `{ "profile": "username-or-public-github-profile-url" }`; the API calls GitHub's official REST API, validates its public profile/repository fields, then stores an append-only `github` evidence row using the request-scoped Supabase client. The response includes the validated profile snapshot and `provenance: "github_api"`. Provider errors are returned as sanitized API errors, and a failed lookup does not create evidence. The candidate details page shows sync status, a short repository sample, and an error/retry path.

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

Success returns HTTP 201 with `id`, `candidateId`, `platform`, `availability`, `provenance: "candidate_provided"`, optional `profileUrl`, `handle`, and `statistics`, and `submittedAt` (ISO timestamp). HTTP 400 (`VALIDATION_ERROR`) covers malformed or unsupported fields; 401 (`UNAUTHENTICATED`) requires valid credentials; 404 (`NOT_FOUND`) covers missing, archived, or another owner's candidate; and 503 reports unavailable storage. Candidate-provided means the recruiter submitted the candidate's reported data; it has not been independently verified. The candidate details page provides separate LeetCode and HackerRank forms for explicit availability and the supported metrics. These entries are saved with `provenance: "candidate_provided"`, remain unverified, and are not used as scores. The forms preserve zero-valued metrics and show validation, saving, saved, and error states. Authorized LeetCode/HackerRank integrations are not implemented; restricted scraping, browser automation, and unofficial endpoints are excluded.

No migration is required for platform data UI: the existing `platform_evidence` schema already allows GitHub/LeetCode/HackerRank source rows, ties each record to its candidate and owner, and has owner-scoped RLS policies.
