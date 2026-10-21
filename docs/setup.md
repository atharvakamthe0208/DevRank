# Setup

## Requirements

Use Node.js 20 or newer (under 25) and npm. From the repository root run `npm install`, then copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`. The API loads its own `.env` by a path relative to its source/build, independent of the current working directory; Vite loads the web workspace `.env`. The legacy root `.env.example` is not loaded by either server. Replace placeholders locally and keep populated `.env` files untracked.

## Commands

- `npm run dev` first builds shared contracts, then starts Vite at `http://localhost:5173` and Express at `http://localhost:3000`. `npm run dev:web` and `npm run dev:api` also build the shared contracts before starting one server. If the configured API host/port is already occupied, the API reports the conflicting address and exits; stop the existing DevRank process or configure a free `API_PORT`. The API does not kill other processes or select another port automatically.
- `npm run dev:api` starts only the API; `npm run build --workspace @devrank/api` compiles it and `npm run start --workspace @devrank/api` runs the compiled server.
- `npm run build` builds all workspaces with build scripts.
- `npm run typecheck` runs configured TypeScript checks.
- `npm test` runs workspace Vitest suites.
- `npm test --workspace @devrank/api` runs API auth, candidate, GitHub adapter, platform data, health, validation, and environment tests.
- `npm run lint` is reserved; no linter is configured yet.

The API exposes health, approved-recruiter candidate CRUD, GitHub lookup/sync, candidate-provided platform submissions, evaluation creation and history, AI analysis, dashboard, comparison, and ranking routes. The web app provides recruiter authentication, candidate management, and configured-role plus owner-defined-role evaluation flows. The active scorer uses six categories and scoring version `3.0.0`; Communication Skills is supported by structured interview/presentation rubrics, and missing evidence never becomes a zero score. GitHub and LeetCode snapshots are separate unverified context, not numeric scoring inputs without approved normalization rules. Dashboard, comparison, and ranking use owner-scoped persisted data and reject incompatible scoring versions. Evaluation-dependent routes require the approved evaluation-persistence schema; production migration and history reconciliation remain unresolved. Supabase Auth and database operations require valid `SUPABASE_URL` and `SUPABASE_ANON_KEY` values. Requests carry the caller's Supabase access token so RLS applies; no service-role key is used. Live Supabase authentication and connectivity are unverified until separately tested with approved configuration.

After starting the API, verify health with `curl http://localhost:3000/api/health`; the expected response is `{"status":"ok"}`.

## Environment variables

- API (`apps/api/.env`): `API_PORT`, `NODE_ENV`, `WEB_ORIGIN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, optional `GITHUB_TOKEN`, optional `GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN`, and backend-only `LEETCODE_API_BASE_URL` (defaults to `http://localhost:3001`). `WEB_ORIGIN` is the primary frontend origin. In development and tests the API also permits HTTP loopback origins (`localhost`, `127.0.0.1`, and `::1`) on arbitrary ports to accommodate Vite's automatic port selection. Production permits only the configured `WEB_ORIGIN`.
- Web: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- `GITHUB_TOKEN` is optional and used only server-side to increase the official GitHub REST API rate limit. Keep it out of frontend `VITE_*` settings and committed files. Public GitHub profile lookup works without it.
- `GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN` is a separate optional server-only token for GitHub GraphQL contribution-calendar, commit, pull-request, issue, and review totals. Configure it without GitHub's optional `read:user` scope so private/internal contribution counts are not included. The API cannot inspect token scopes; if the token is absent, contribution history is unavailable while the public profile sync can still succeed. Never put either GitHub token in frontend `VITE_*` variables.
- LeetCode sync calls the separately managed alfa-leetcode-api service from the API server. Set `LEETCODE_API_BASE_URL` to a local instance (for example `http://localhost:3001`) or a trusted HTTPS hosted instance; this is server-side configuration and must not use a `VITE_*` variable. For a local provider, the upstream documents Docker image `alfaarghya/alfa-leetcode-api:2.0.4`; expose its container port 3000 as host port 3001 (for example `docker run -p 3001:3000 alfaarghya/alfa-leetcode-api:2.0.4`). DevRank concurrently requests the username profile, `/solved`, and optional `/contest` endpoints; missing optional values remain absent, and failure of contest statistics does not discard valid solved statistics. Provider data does not independently verify candidate identity and does not feed evaluation scores without approved normalization. HackerRank remains candidate-provided only. DevRank does not request LeetCode credentials or session cookies and does not independently scrape LeetCode pages.

## Database migration workflow

Review and apply the four migrations in timestamp order: initial schema, candidate API fields, recruiter authorization/RLS, then admin approval functions. The new migrations preserve table data and existing policies while adding restrictive access gates. See [Recruiter authentication](authentication.md) for project settings and the one-time first-admin provisioning process. Do not apply migrations automatically from the API or local startup. The target live database was not inspected from this checkout.

Lint is not configured in this repository; `npm run lint` currently performs no lint checks.

## CSV candidate import

On the Candidates page, choose **Import CSV**, upload a UTF-8 `.csv`, map the columns, correct the editable preview rows, check potential duplicates, and explicitly confirm the import. The first column row is treated as headers. Common aliases include `name`/`full name`/`candidate name`, `email`/`email address`, `github`/`github username`/`github profile URL`, and `leetcode`/`leetcode username`/`leetcode profile URL`. Name is required; email and GitHub/LeetCode fields are optional, matching individual candidate creation. Profile values may be usernames or recognized HTTPS profile URLs (`github.com/<username>` and `leetcode.com/u/<username>`). Unsupported URLs must be corrected manually.

The importer accepts files up to 1 MiB, at most 500 candidate rows, 50 columns, and 500 characters per cell. It supports quoted cells, commas and escaped double quotes inside quoted cells, and Unicode. Unclosed quoted fields stop the import with an error; rows with inconsistent column counts or invalid fields remain visible and are not submitted until corrected. Duplicate headers are retained for manual column mapping. Original row values remain available in the preview.

Potential duplicate matching is owner-scoped and case-insensitive on exact email, GitHub username, or LeetCode username. Candidate name is not a duplicate key, and these identifiers are not schema uniqueness constraints. The default policy skips potential matches; a recruiter can explicitly choose to create additional records, which never overwrites the match. Rows with no email or profile usernames cannot be matched heuristically. Existing candidate data and platform evidence are not modified. Candidate creation and provider synchronization are separate; use the existing profile actions to sync after import.

`supabase/migrations/20261020211405_candidate_bulk_import_idempotency.sql` adds the owner-scoped, RLS-protected idempotency receipt table and transactional RPC. Receipts contain only a request digest and row outcomes/IDs, not the uploaded CSV or candidate fields. Import requests require an `Idempotency-Key` UUID; replaying the same key and payload returns the saved outcome, while reusing a key with different input is rejected. Successful, skipped, and failed row outcomes are stored in the same transaction as candidate creation. The migration is not applied automatically.

Run the isolated database migration test with `npm run test:candidate-import:db`. It applies the real schema/auth/import SQL to a fresh in-memory PGlite database and covers owner isolation, potential matches, both duplicate policies, idempotent replay/key mismatch, client access to the receipt table, and a row-level database constraint failure. This does not contact Supabase or validate PostgREST/JWT behavior against a Supabase server. For end-to-end UI/API testing, start the disposable local stack and apply only to its local database with explicit local flags:

```powershell
.\node_modules\.bin\supabase start
.\node_modules\.bin\supabase migration up --local
.\node_modules\.bin\supabase status
```

Verify the status output identifies localhost endpoints before configuring the local API/web environment. Provision an approved test recruiter using the existing local-auth procedure, run `npm run dev`, and upload a small test CSV. Confirm that a repeated request with the same idempotency key returns the original result without creating extra candidates; verify a different payload gets a conflict, potential matches are skipped by default, and platform sync remains a separate action. Use `supabase stop` when finished. These commands are for the local stack only; never use `--linked`, `--db-url`, `supabase db push`, or a hosted project for this procedure.
