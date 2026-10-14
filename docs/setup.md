# Setup

## Requirements

Use Node.js 20 or newer (under 25) and npm. From the repository root run `npm install`, then copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`. The API loads its own `.env` by a path relative to its source/build, independent of the current working directory; Vite loads the web workspace `.env`. The legacy root `.env.example` is not loaded by either server. Replace placeholders locally and keep populated `.env` files untracked.

## Commands

- `npm run dev` first builds shared contracts, then starts Vite at `http://localhost:5173` and Express at `http://localhost:3000`. `npm run dev:web` and `npm run dev:api` also build the shared contracts before starting one server.
- `npm run dev:api` starts only the API; `npm run build --workspace @devrank/api` compiles it and `npm run start --workspace @devrank/api` runs the compiled server.
- `npm run build` builds all workspaces with build scripts.
- `npm run typecheck` runs configured TypeScript checks.
- `npm test` runs workspace Vitest suites.
- `npm test --workspace @devrank/api` runs API auth, candidate, GitHub adapter, platform data, health, validation, and environment tests.
- `npm run lint` is reserved; no linter is configured yet.

The API exposes health, approved-recruiter candidate CRUD, GitHub lookup/sync, candidate-provided platform submissions, evaluation creation and history, AI analysis, dashboard, comparison, and ranking routes. The web app provides recruiter authentication, candidate management, and configured-role plus owner-defined-role evaluation flows. The active scorer uses five categories and scoring version `2.0.0`; missing evidence never becomes a zero score. Dashboard, comparison, and ranking use owner-scoped persisted data and reject incompatible scoring versions. Evaluation-dependent routes require the approved evaluation-persistence schema; production migration and history reconciliation remain unresolved. Supabase Auth and database operations require valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` values. Requests carry the caller's Supabase access token so RLS applies; no service-role key is used. Live Supabase authentication and connectivity are unverified until separately tested with approved configuration.

After starting the API, verify health with `curl http://localhost:3000/api/health`; the expected response is `{"status":"ok"}`.

## Environment variables

- API (`apps/api/.env`): `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `GITHUB_TOKEN`. `WEB_ORIGIN` is the primary frontend origin. In development and tests the API also permits HTTP loopback origins (`localhost`, `127.0.0.1`, and `::1`) on arbitrary ports to accommodate Vite's automatic port selection. Production permits only the configured `WEB_ORIGIN`.
- Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `GITHUB_TOKEN` is optional and used only server-side to increase the official GitHub REST API rate limit. Keep it out of frontend `VITE_*` settings and committed files. Public GitHub profile lookup works without it.
- LeetCode and HackerRank values are candidate-provided; no platform integration or independent verification is implemented. Restricted scraping and unofficial endpoints are excluded.

## Database migration workflow

Review and apply the four migrations in timestamp order: initial schema, candidate API fields, recruiter authorization/RLS, then admin approval functions. The new migrations preserve table data and existing policies while adding restrictive access gates. See [Recruiter authentication](authentication.md) for project settings and the one-time first-admin provisioning process. Do not apply migrations automatically from the API or local startup. The target live database was not inspected from this checkout.

Lint is not configured in this repository; `npm run lint` currently performs no lint checks.
