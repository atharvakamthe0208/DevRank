# Architecture

DevRank is a modular monolith: `apps/web` calls `apps/api`, the API coordinates repositories and services, and `packages/contracts` owns shared Zod schemas and inferred TypeScript types. The API owns provider secrets and mediates database access. Platform adapters normalize evidence independently; unavailable integrations should not prevent evaluation of available evidence.

The API separates Express app setup (`src/app.ts`) from startup (`src/server.ts`). Routes are mounted under `/api`; middleware owns request validation, 404 responses, and consistent errors. Supabase uses the public/anonymous key with an authenticated user's verified JWT so database Row Level Security remains active. No service-role key is used by this scaffold.

The scoring module is deterministic and owns official numeric scores and rankings. The AI module may explain validated evidence and scores, but its structured output cannot alter them. AI, data collection, normalization, and scoring remain separate responsibilities. Scoring, AI, and business APIs are not yet implemented.
