# DevRank Playwright Visual QA

This repository uses `@playwright/test` at the root so browser tooling stays out of the production web and API workspaces. Chromium is the only configured browser.

## Install

From a fresh checkout:

```powershell
npm ci
npx playwright install chromium
```

## Start the app safely

The Playwright config starts only the Vite web workspace on `127.0.0.1:5173`. It reuses a server already listening there during local runs, so it does not start a duplicate or take over your browser.

Protected-route checks make real read-only API requests. Before using authenticated state, verify that the web and API development environments point to a **disposable local Supabase project**, not a hosted or production project. Start the API in a separate terminal with `npm run dev:api` if it is not already available on port 3000. Start local Supabase using the repository's local Supabase workflow if needed. Do not use production credentials or production data for visual QA.

## Create local authenticated state

Create a dedicated, email-confirmed, approved local recruiter account using the existing signup and admin-approval workflow. Then use Playwright's separate Chromium window to sign in through the actual application UI:

```powershell
New-Item -ItemType Directory -Force playwright/.auth | Out-Null
npx playwright codegen --save-storage=playwright/.auth/recruiter.json http://127.0.0.1:5173/login
```

Sign in to the local test account in the opened window and close it to save the state. This uses the normal login flow; it does not bypass authentication. The generated file contains credentials/session material, is ignored by Git, and must never be committed or shared.

Set the state path and run the authenticated checks:

```powershell
$env:PLAYWRIGHT_STORAGE_STATE = (Resolve-Path playwright/.auth/recruiter.json).Path
npm run test:visual
```

For Bash:

```bash
PLAYWRIGHT_STORAGE_STATE=playwright/.auth/recruiter.json npm run test:visual
```

The suite checks the Dashboard, Candidates, Evaluations, Insights, and Resume Screening at 320×800, 375×812, 390×844, 768×1024, 1024×768, and 1440×900. It verifies the expected heading and primary action, loaded Inter font face, heading typography, visible form-label size, runtime page errors, control clipping, and document-level horizontal overflow. An intentional horizontally scrollable table is allowed as long as it does not widen the page. Protected-route checks are explicitly skipped when no authenticated state is provided; a login screen is never counted as a protected-page pass.

To include the full AI analysis page, provide an existing evaluation ID owned by the local test recruiter:

```powershell
$env:PLAYWRIGHT_EVALUATION_ID = 'existing-local-evaluation-id'
npm run test:visual
```

## Commands

- `npm run test:e2e` — run all browser checks.
- `npm run test:visual` — run visual/responsive page checks and save screenshots.
- `npm run test:e2e:ui` — open Playwright's test UI.
- `npm run test:e2e:report` — view the last HTML report.

Successful runs save full-page screenshots under `visual-screenshots/<route>/<width>x<height>.png` for 390px and 1440px. Failure screenshots, traces, and HTML reports go under `test-results/` and `playwright-report/`; all these paths and the local authentication state are ignored by Git.

Open a retained trace with:

```powershell
npx playwright show-trace test-results/<test-folder>/trace.zip
```

## Troubleshooting

- If Chromium is missing, run `npx playwright install chromium`.
- If Vite is not running, the test runner starts it. If port 5173 is occupied by another service, stop that service or configure the local Vite port and Playwright base URL together.
- If the API is unavailable, start `npm run dev:api` in a separate terminal and confirm it uses the disposable local Supabase environment.
- If protected checks redirect to login or fail authorization, create a local email-confirmed, approved recruiter state through the actual login flow. Do not substitute mocked authorization or a hosted account.
- If Inter fails to load, check network access to Google Fonts; the app's system font fallback remains active, but the Inter smoke check will correctly fail.
