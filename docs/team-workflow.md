# Team workflow

## Ownership

- Atharva owns Express setup, auth, persistence, API routes, GitHub integration, `apps/api` outside scoring/AI, Supabase schema and deployment configuration.
- Aryan owns `apps/web`, including routing, UI and centralized API client. Use mock fixtures until endpoints are agreed.
- Priya owns deterministic scoring and AI explanation/output validation under `apps/api/src/modules/`, plus scoring/AI tests and integration scenarios.
- Shared contracts require communication with all members. Coordinate SQL migrations with Atharva. Each owner documents interfaces in `docs/`.

## Git

Use short-lived branches named `feature/<area>-<change>` or `fix/<area>-<change>`, keep commits focused, and open a review before merging to the shared default branch. Pull the latest shared branch before starting or merging work. When an API shape changes, update `packages/contracts` and notify frontend/backend owners in the same review. Do not commit secrets, generated output, or local environment files.
