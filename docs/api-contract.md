# Proposed candidate evaluation API contract

Shared Zod schemas and inferred types live in `packages/contracts/src`. Import these from both workspaces instead of redefining request or response shapes. Current starter contracts cover candidates, platform evidence and availability, evaluation requests/status, scoring categories and weights, AI analysis, comparisons, rankings, and standard API errors. These are initial shapes for team review, not a finalized API specification. Coordinate changes with all owners.

## Current HTTP conventions

- `GET /api/health` returns HTTP 200 with `{ "status": "ok" }`.
- The prior scaffold path `GET /health` remains as a compatibility alias.
- Successful resource responses use a resource-specific JSON object; a universal success envelope is not required for health.
- Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. `details` is optional and contains field paths/messages for validation failures only.
- Unknown routes return HTTP 404 with code `NOT_FOUND`. Malformed JSON returns HTTP 400 with code `INVALID_JSON`. Unexpected errors do not expose exception messages or stacks.
- Zod body validators are registered on routes with `validateBody(schema)`; query and path inputs use `validateQuery` and `validateParams`.
- The current shared scoring contract lists four categories, while the 8-day plan gives six category names as examples. Priya and the team must resolve that mismatch before the canonical category enum or role weights are finalized; the initial database migration therefore stores category keys without a fixed enum constraint.

## Authentication

Candidate routes require `Authorization: Bearer <supabase-access-token>`. The API verifies the token through Supabase Auth (`auth.getUser(token)`) and never trusts a client-supplied user ID. The verified ID and original token are attached to request-local auth context; the token is forwarded only to a request-scoped Supabase client so PostgreSQL RLS sees `auth.uid()`. Tokens are not returned or logged. The web app remains responsible for sign-in through Supabase Auth; this API does not implement passwords or a duplicate login system.

Missing, malformed, invalid, or expired credentials return HTTP 401 (`UNAUTHENTICATED`). Supabase Auth outages or missing backend configuration return HTTP 503 (`AUTH_SERVICE_UNAVAILABLE`). Candidate reads and writes are scoped to the authenticated owner. A missing candidate and another user's candidate both return HTTP 404 to avoid disclosing whether the other user's record exists. There is no role/permission model yet, so no candidate route currently returns 403.

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
