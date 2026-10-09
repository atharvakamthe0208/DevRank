# Architecture

DevRank is a modular monolith: `apps/web` calls `apps/api`, the API coordinates repositories and services, and `packages/contracts` owns shared Zod schemas and inferred TypeScript types. The API owns provider secrets and Supabase privileged access. Platform adapters normalize evidence independently; unavailable integrations should not prevent evaluation of available evidence.

The scoring module is deterministic and owns official numeric scores and rankings. The AI module may explain validated evidence and scores, but its structured output cannot alter them. AI, data collection, normalization, and scoring remain separate responsibilities. This is architecture guidance; those workflows are not yet implemented.
