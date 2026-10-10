# Proposed candidate evaluation API contract

Shared Zod schemas and inferred types live in `packages/contracts/src`. Import these from both workspaces instead of redefining request or response shapes. Current starter contracts cover candidates, platform evidence and availability, evaluation requests/status, scoring categories and weights, AI analysis, comparisons, rankings, and standard API errors. These are initial shapes for team review, not a finalized API specification. Coordinate changes with all owners.

## Current HTTP conventions

- `GET /api/health` returns HTTP 200 with `{ "status": "ok" }`.
- The prior scaffold path `GET /health` remains as a compatibility alias.
- Successful resource responses use a resource-specific JSON object; a universal success envelope is not required for health.
- Errors use `{ "error": { "code": "...", "message": "...", "details": ... } }`. `details` is optional and contains field paths/messages for validation failures only.
- Unknown routes return HTTP 404 with code `NOT_FOUND`. Malformed JSON returns HTTP 400 with code `INVALID_JSON`. Unexpected errors do not expose exception messages or stacks.
- Zod body validators are registered on routes with `validateBody(schema)`; future route owners should validate input before calling services.
- The current shared scoring contract lists four categories, while the 8-day plan gives six category names as examples. Priya and the team must resolve that mismatch before the canonical category enum or role weights are finalized; the initial database migration therefore stores category keys without a fixed enum constraint.

## Planned candidate API

Candidate CRUD is planned under `/api/candidates`; endpoints and exact request/response schemas are not implemented or finalized yet. The next backend and frontend owners should agree on fields in `packages/contracts` before implementing them.
