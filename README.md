# DevRank

DevRank is an MVP project for evaluating and ranking technical candidates using collected evidence, deterministic scoring, and AI-generated explanations. The repository is structured as a modular monolith with a React client, Express API, shared contracts, and version-controlled Supabase assets. Directories are scaffolding; they do not imply that product features or external integrations are implemented.

## Stack

- React, Vite, TypeScript
- Node.js, Express, TypeScript
- Supabase PostgreSQL and Auth
- Zod shared contracts; LangChain/Groq behind a backend service boundary when implemented
- Vitest for tests; npm workspaces and npm only

## Repository map

```text
apps/web/             React application, organized by product feature
apps/api/             Express modular monolith and isolated integrations
packages/contracts/   Shared request, response, and evidence schemas
supabase/             SQL migrations, seed data, and database notes
docs/                 Architecture, interface, scoring, AI, setup, and workflow notes
scripts/              Repository automation
.github/workflows/    CI workflow location
```

See [docs/setup.md](docs/setup.md) for setup and [docs/team-workflow.md](docs/team-workflow.md) for ownership and collaboration.

## Prerequisites

- Node.js 20 or newer (under 25)
- npm 10 or newer recommended
- A Supabase project is only needed when implementing database-backed flows

## Install and run

```sh
npm install
```

Copy `.env.example` to `.env` for the API and to `apps/web/.env` for Vite. Replace placeholders locally; never commit populated environment files. Start both development servers with:

```sh
npm run dev
```

The web app is served at `http://localhost:5173`; the API health endpoint is `http://localhost:3000/api/health`. Workspace commands are `npm run build`, `npm run lint`, `npm run test`, and `npm run typecheck`. Lint is not configured yet; API tests cover the health route, request validation, error conventions, and environment parsing.

## Team ownership

- **Atharva:** `apps/api` and `supabase/` (excluding scoring and AI business logic); API setup, persistence, auth, integrations, deployment.
- **Aryan:** `apps/web`; UI, routing, mock fixtures, and API client integration.
- **Priya:** `apps/api/src/modules/scoring`, `apps/api/src/modules/ai`, and QA scenarios; coordinate changes to shared contracts.
- **Shared:** `packages/contracts` changes are communicated to all; database migrations are reviewed with Atharva; each owner documents their interfaces.

## Current scope and next steps

The repository includes a minimal Express foundation, Supabase bearer-token verification, owner-scoped candidate CRUD APIs, an official GitHub REST adapter, candidate-provided LeetCode/HackerRank evidence submission, shared contracts, and prepared SQL migrations. Migrations have not been applied to a database. Evaluation APIs, scoring, AI, and most product UI are not implemented. See [docs/api-contract.md](docs/api-contract.md) for API contracts and [docs/team-workflow.md](docs/team-workflow.md) for Git conventions.
