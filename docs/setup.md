# Setup

## Requirements

Use Node.js 20 or newer (under 25) and npm. From the repository root run `npm install`, then copy `.env.example` to root `.env` for the API and `apps/web/.env.example` to `apps/web/.env` for browser-safe Vite settings. The root example includes both `VITE_*` browser settings and API settings; only Vite-prefixed values are exposed in the browser. Replace placeholders locally and keep `.env` files untracked. The backend also has a focused example at `apps/api/.env.example`.

## Commands

- `npm run dev` starts Vite at `http://localhost:5173` and Express at `http://localhost:3000`.
- `npm run dev:api` starts only the API; `npm run build --workspace @devrank/api` compiles it and `npm run start --workspace @devrank/api` runs the compiled server.
- `npm run build` builds all workspaces with build scripts.
- `npm run typecheck` runs configured TypeScript checks.
- `npm test` runs workspace Vitest suites.
- `npm test --workspace @devrank/api` runs API auth, candidate, health, validation, and environment tests.
- `npm run lint` is reserved; no linter is configured yet.

The API exposes `GET /api/health` (and the legacy `GET /health`) plus authenticated candidate CRUD at `/api/candidates`. Supabase Auth and database operations require real `SUPABASE_URL` and `SUPABASE_ANON_KEY` values. Candidate requests must use a Supabase access token; the API verifies it, then forwards that user's token to PostgreSQL so RLS applies. No service-role key is used. Real Supabase authentication and connectivity are unverified until valid project credentials are configured.

After starting the API, verify health with `curl http://localhost:3000/api/health`; the expected response is `{"status":"ok"}`.

## Environment variables

- API: `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- GitHub and Groq keys are not consumed by this issue and are intentionally absent from the environment examples until their integrations are implemented.

## Database migration workflow

Review `supabase/migrations/20261010000000_initial_devrank_schema.sql` and `supabase/migrations/20261011000000_candidate_api_fields.sql` with the team before applying them. They are version-controlled proposals, not applied migrations. Confirm the target project, inspect the SQL diff, and apply through the team's controlled Supabase migration workflow; then verify RLS and table definitions in a non-production project before production. Do not apply migrations automatically from the API or local startup.
