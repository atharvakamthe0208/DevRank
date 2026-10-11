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

The API exposes `GET /api/health`, `GET /api/auth/me`, candidate CRUD under `/api/candidates`, and administrator-only recruiter review under `/api/admin/recruiters`. Candidate routes require a verified Supabase token, confirmed email, and approved recruiter profile. Admin routes require a verified, confirmed administrator profile and recheck authorization in database functions. Supabase connectivity remains unverified until project credentials and migrations are configured.

After starting the API, verify health with `curl http://localhost:3000/api/health`; the expected response is `{"status":"ok"}`.

## Environment variables

- API: `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- GitHub and Groq keys are not consumed by this issue and are intentionally absent from the environment examples until their integrations are implemented.

## Database migration workflow

Review and apply the four migrations in timestamp order: initial schema, candidate API fields, recruiter authorization/RLS, then admin approval functions. The new migrations preserve table data and existing policies while adding restrictive access gates. See [Recruiter authentication](authentication.md) for project settings and the one-time first-admin provisioning process. Do not apply migrations automatically from the API or local startup. The target live database was not inspected from this checkout.

Lint is not configured in this repository; `npm run lint` currently performs no lint checks.
