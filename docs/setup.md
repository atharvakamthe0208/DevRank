# Setup

## Requirements

Use Node.js 20 or newer (under 25) and npm. From the repository root run `npm install`, then copy `.env.example` to root `.env` for the API and `apps/web/.env.example` to `apps/web/.env` for browser-safe Vite settings. The root example is a reference; do not load its server secrets in the frontend. Replace placeholders locally and keep `.env` files untracked.

## Commands

- `npm run dev` starts Vite at `http://localhost:5173` and Express at `http://localhost:3000`.
- `npm run build` builds all workspaces with build scripts.
- `npm run typecheck` runs configured TypeScript checks.
- `npm run test` runs configured Vitest suites (initially empty).
- `npm run lint` is reserved; no linter is configured yet.

The API exposes only a starter `/health` route. Supabase, GitHub, and Groq values are optional until their integrations are implemented. Never use a Supabase service-role key in the web app.
