# Setup

## Requirements

Use Node.js 20 or newer (under 25) and npm. From the repository root run `npm install`, then copy `.env.example` to root `.env` for the API and `apps/web/.env.example` to `apps/web/.env` for browser-safe Vite settings. The root example includes both `VITE_*` browser settings and API settings; only Vite-prefixed values are exposed in the browser. Replace placeholders locally and keep `.env` files untracked. The backend also has a focused example at `apps/api/.env.example`.

## Commands

- `npm run dev` starts Vite at `http://localhost:5173` and Express at `http://localhost:3000`.
- `npm run dev:api` starts only the API; `npm run build --workspace @devrank/api` compiles it and `npm run start --workspace @devrank/api` runs the compiled server.
- `npm run build` builds all workspaces with build scripts.
- `npm run typecheck` runs configured TypeScript checks.
- `npm test` runs workspace Vitest suites.
- `npm run lint` is reserved; no linter is configured yet.

The API exposes `GET /api/health` (and the legacy `GET /health`) and no business endpoints yet. The API starts without Supabase credentials. Database services must call `getSupabaseClient()` and provide `SUPABASE_URL` plus `SUPABASE_ANON_KEY`; authenticated requests must pass a verified user's JWT so RLS applies. No service-role key is read by this scaffold. Real connectivity is unverified until valid project credentials are configured.

After starting the API, verify health with `curl http://localhost:3000/api/health`; the expected response is `{"status":"ok"}`.

## Environment variables

- API: `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- GitHub and Groq keys are not consumed by this issue and are intentionally absent from the environment examples until their integrations are implemented.

## Database migration workflow

Review `supabase/migrations/20261010000000_initial_devrank_schema.sql` with the team before applying it. It is a version-controlled proposal, not an applied migration. Confirm the target project, inspect the SQL diff, and apply through the team's controlled Supabase migration workflow; then verify RLS and table definitions in the non-production project before production. Do not apply it automatically from the API or local startup.
