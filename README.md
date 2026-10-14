# DevRank

DevRank is an MVP for recruiter-managed candidate records and evidence-based technical evaluation. The repository contains a React/Vite client, Express API, shared Zod contracts, Supabase Auth/PostgreSQL integration, deterministic five-category scoring, and optional server-side AI analysis. Comparison and ranking workflows remain future work.

## Stack

- React, Vite, TypeScript
- Node.js, Express, TypeScript
- Supabase PostgreSQL and Auth
- Zod shared contracts; optional Groq structured analysis behind the API
- Vitest; npm workspaces

## Repository map

```text
apps/web/             React application and recruiter/admin workflows
apps/api/             Express API, auth, persistence, scoring, AI, integrations
packages/contracts/   Shared request, response, evidence and evaluation schemas
supabase/             SQL migrations and database notes
docs/                 Architecture, API, setup, scoring, AI and day notes
```

See [docs/setup.md](docs/setup.md), [docs/authentication.md](docs/authentication.md), and [PROJECT_STATUS.md](PROJECT_STATUS.md) for current setup and implementation status. Role weights remain preliminary and require assessment-owner review. No SRS was found in the repository.

## Prerequisites and setup

- Node.js 20 or newer (under 25)
- npm 10 or newer recommended

```sh
npm install
```

Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`; configure local values without committing populated environment files. Supabase settings are required for authenticated/persisted workflows. Groq configuration is optional; without it deterministic evaluations still work. Start the development servers with:

```sh
npm run dev
```

The web app is served at `http://localhost:5173`; API health is `http://localhost:3000/api/health`. Root commands include `npm run build`, `npm run typecheck`, and `npm test`. Lint is not configured.

## Current implementation

Recruiters can authenticate, manage candidates, submit LeetCode/HackerRank data as candidate-provided evidence, and sync public GitHub profile evidence through the official REST API. API evaluation creation validates evidence, scores five categories, stores a versioned snapshot, and optionally attaches AI analysis. The web app now offers evaluation setup from candidate profiles and displays persisted five-category results, missing evidence, and valid optional AI analysis. Existing role weights remain preliminary and must be approved; no default weights are created. Comparison/ranking are not implemented. Database migrations must be applied separately; live Supabase and provider behavior is deployment-dependent. See [evaluation UI documentation](docs/evaluation-ui.md).

## Team ownership

- **Atharva:** `apps/api` and `supabase/` (excluding scoring and AI business logic); API setup, persistence, auth, integrations, deployment.
- **Aryan:** `apps/web`; UI, routing and API client integration.
- **Priya:** `apps/api/src/modules/scoring`, `apps/api/src/modules/ai`, and QA scenarios; coordinate shared-contract changes.
- **Shared:** Coordinate `packages/contracts` changes and migration reviews.
