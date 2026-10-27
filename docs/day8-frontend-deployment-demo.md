# Day 8: frontend deployment and final demo

## Deployment status

This repository contains a React 19 + Vite frontend and a separate Express API. No hosting platform configuration or production API URL is present in the repository. DevRank has **not been deployed or verified at a public URL**. Do not enter a made-up production URL: obtain the deployed API's HTTPS base URL from the API host, then set it in the frontend host's build environment.

The frontend reads `VITE_API_BASE_URL`. Vite embeds `VITE_*` values when it builds the app. Local development continues to default to `http://localhost:3000/api`; in production, a missing, HTTP, or localhost URL is rejected with a clear configuration error. Rebuild/redeploy after changing the hosting provider's environment variables.

The frontend also needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public publishable/legacy anon key only) for browser authentication. Never put a Supabase secret or service-role key in a `VITE_*` variable. The API independently needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `WEB_ORIGIN` set to the exact deployed frontend origin, and `API_PORT` as provided by the API host. `SUPABASE_ANON_KEY` on the server is the public key used with a verified user token; this project must not use a service-role key for browser or ordinary recruiter access.

## Static frontend deployment steps

These steps apply to a static host that can build a Vite app. The exact dashboard names vary by provider; no provider is selected or configured by this repository.

1. Deploy the Express API separately to a Node.js-capable host. Obtain its HTTPS URL and confirm its health endpoint responds at `/api/health`.
2. Configure the API host with its server-only environment: `NODE_ENV=production`, the host-provided `API_PORT`, `WEB_ORIGIN` equal to the final frontend origin, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`. Configure Supabase Auth redirect URLs for the final frontend's `/auth/callback` and `/reset-password` routes. Verify the reviewed migrations and RLS policies in the intended Supabase project with its owner.
3. Configure the frontend host's **build-time** environment with:

   ```text
   VITE_API_BASE_URL=https://<your-deployed-api-host>/api
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-public-publishable-or-legacy-anon-key>
   ```

   Replace placeholders with values from your own deployments. Do not copy these example strings literally. The production API URL and Supabase values are currently unknown and are not supplied by the repository.
4. Use the repository root as the frontend build context so the npm workspaces and shared contract package are available. Build command: `npm run build`. Static publish directory: `apps/web/dist`.
5. Configure the host to serve `index.html` for frontend navigation paths such as `/login`, `/dashboard`, `/dashboard/candidates/new`, `/admin/recruiters`, `/auth/callback`, and `/reset-password`, while still serving actual static assets normally. This is the React Router SPA fallback. API paths must go to the separate API host, not the static frontend.
6. Set the API's CORS `WEB_ORIGIN` to the exact deployed frontend origin (scheme + host + port, with no route path). Redeploy the API if it changes.
7. After deployment, verify the homepage/login route, refresh a nested route directly, inspect the browser Network panel for the API URL (not localhost), sign in using an approved test recruiter, and verify that logout returns to login. Do not report deployment success until these checks pass.

If your host cannot run the root npm workspace build or cannot configure SPA fallback, use its documented monorepo/root-directory settings or select a compatible static host. No host-specific rewrite file is included because the intended provider is not known.

## What can be demonstrated in this checkout

The current branch is an early frontend shell. Routes and controls were checked against the code and current API:

- `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/auth/callback`, and `/access-pending` have recruiter auth screens. A working Supabase project, migrations, email setup, and an approved account are needed to complete the real auth flow.
- `/dashboard` renders a **sample dashboard** from `mockCandidates.ts`, visibly marked as demo/sample data. Dashboard search and sort work against this local sample list; the displayed Filter button is not wired to a filter operation.
- `/dashboard/candidates` and `/dashboard/reports` are placeholder pages in this checkout.
- `/dashboard/candidates/new` validates form details in the browser only. It explicitly says that candidate creation is not connected and nothing is saved.
- `/candidates/:id` reads the bundled mock candidate fixture. It is not a live candidate record.
- `/admin/recruiters` calls the admin API and requires a configured backend, migrated database, and approved admin account.
- There is no evaluation/rubric route or evaluation API in this checkout, so the evaluation/report part of the requested final demo is **not available** here. Do not present sample candidate scores as live evaluations.

The API routes currently implemented are `GET /api/health`, `GET /api/auth/me`, `GET /api/recruiter/session`, and admin recruiter list/decision endpoints under `/api/admin/recruiters`. Candidate and evaluation APIs are absent. This deployment guide does not make or imply backend feature changes.

## Local build and run

1. From the repository root, install dependencies with `npm install`.
2. Copy `.env.example` to the root `.env` and `apps/web/.env.example` to `apps/web/.env`; fill in only your own values locally. These files are ignored by Git. Root setup provides the API variables and the Vite variables; the web example is the browser-specific configuration. Check the example files for exact names.
3. Start both local servers with `npm run dev`.
4. Open the URL Vite prints (normally `http://localhost:5173`). The API normally listens on `http://localhost:3000`.
5. For auth, the Supabase project must have the checked-in migrations reviewed/applied and the correct local callback/reset URLs allowed. Public signup creates a pending recruiter; only a provisioned administrator can approve the recruiter.

## Repeatable demo flow

Use a non-production project, an approved demo recruiter, and no real candidate personal data.

1. Open the local or verified deployed frontend and show the recruiter login page.
2. Sign in with an already approved recruiter account. Account provisioning and approval are manual prerequisites; this guide does not create an account.
3. Show the dashboard and point out that the visible candidate names and scores are sample fixture data, not database results.
4. Try dashboard search and sort on the sample candidates. Do not claim the Filter button works.
5. Open a sample candidate detail page to show the mock profile.
6. Open **Add candidate**, submit invalid required fields to show validation, then enter valid test details. The form only validates; explicitly show the “nothing will be saved” message and cancel/return. Do not claim candidate creation occurred.
7. Explain that candidate list, evaluation/rubric, and live report pages are not implemented on this checkout. Do not demonstrate fake evaluation success or rankings.
8. Log out. If the real account flow is configured, demonstrate that a protected route redirects to login after logout.

For signup approval, admin functions, or candidate/evaluation functionality, prepare a separate flow only after confirming the relevant live backend and UI are implemented and available.

## Screenshot checklist

No screenshots are included in the repository. Capture screenshots from the actual running app only, using a non-production test account and sample/non-personal data. Suggested filenames:

1. `day8-01-recruiter-login.png` — login form (do not show the signed-in email or browser autofill).
2. `day8-02-demo-dashboard.png` — dashboard with the sample/demo notice visible.
3. `day8-03-sample-candidate-detail.png` — mock detail page; inspect for personal data before capture.
4. `day8-04-add-candidate-validation.png` — required-field validation or the explicit “not saved” notice.
5. `day8-05-logout-login.png` — login page after logout, with no session or private information visible.

Do not use browser DevTools screenshots that reveal access tokens, request authorization headers, local `.env` values, private account data, or sensitive logs. There is no genuine evaluation result screenshot available in this checkout.

## Checks and blockers

Run from the repository root:

```powershell
npm test
npm run build
npm run lint
```

Report only the results observed in the current checkout. `npm run lint` currently has no workspace linter configured. A successful local build does not prove that the production API URL, host rewrites, CORS, Supabase redirects, live migrations, or recruiter authorization are configured.

### Results from this Day 8 pass (2026-10-17)

- Web tests: 10 passed. The normal Vitest config-bundling mode is blocked in this restricted workspace because esbuild cannot read a parent directory while loading the Vite config; the suite passed with `npm test --workspace @devrank/web -- --configLoader runner`.
- API tests: 13 passed with `npm test --workspace @devrank/api`.
- Contracts: no test files were found with `npm test --workspace @devrank/contracts`.
- Typecheck: `npm run typecheck` passed for contracts, API, and web.
- Build: contracts and API builds passed; the web production build passed with `npm run build --workspace @devrank/web -- --configLoader runner`. Vite warned that the minified JS chunk is above 500 kB.
- Lint: `npm run lint` exited successfully but ran no lint checks because none are configured.
- Browser smoke check: the real local login, signup, forgot-password, reset-password, and protected dashboard redirect were opened. The login document had no horizontal overflow at 320, 375, 430, 768, 1024, 1280, or 1440 px. Other application pages and authenticated workflows were not visually viewport-tested because this branch lacks the live candidate/evaluation pages and no approved demo account was used.
- A real local login screenshot was captured in the review browser preview. No screenshot file was saved to the repository; use the checklist above to capture and name demo images after a non-production deployment/account is available.
- No deployment, live API request, Supabase sign-in, candidate write, or evaluation was performed.

Remaining manual prerequisites: select a deployment host, deploy the API, obtain its real HTTPS URL, configure both hosts' environment variables, set frontend SPA fallback, set API CORS origin, confirm Supabase Auth redirect URLs and reviewed migration/RLS state, and test with a non-production approved recruiter. Candidate management/evaluation UI and backend endpoints also remain future implementation work on this branch.
