# Day 7 backend integration and security audit

**Audit scope:** local source, shared contracts, historical migrations, and isolated tests on the Issue #19 branch. No production connection was attempted.

## Findings

| Severity | Finding | Resolution / status |
| --- | --- | --- |
| Medium | `GET /api/github` verified a bearer token but did not enforce email confirmation or approved recruiter status. Pending, rejected, and unconfirmed accounts could consume the backend GitHub integration and its configured token/quota. | Fixed: apply `requireApprovedRecruiter` before input validation or provider calls; regression tests prove these identities receive 403 and the adapter is not called. |
| Low | The GitHub route trusted an injected provider's response at the HTTP boundary. The production adapter validates its own output, but a swapped or defective adapter could return data that violates the shared contract. | Fixed: controller validates with `githubProfileResponseSchema`; invalid output maps to a generic 502 without provider details. |
| Blocker | The evaluation persistence migration is not approved for production; prior supplied context reported missing result/role columns and blank remote migration versions. | Unchanged: no migration-history or production action was performed. Comparison/ranking and evaluation persistence still require the separate catalog/ledger audit and approved deployment plan. |
| Verification gap | The latest `origin/main` does not contain `scripts/test-evaluation-migration.mjs`, the reconciliation migration, or the `test:migration:integration` package script. Those files are present in the pre-existing Git stash. | Stash was left untouched. The required npm command fails with “Missing script.” A temporary copy of the stashed harness and migration was run against PGlite for local evidence, then removed. This is not reproducible from this branch until the harness is deliberately restored and reviewed. |

No other high-severity authorization or secret-disclosure defect was confirmed in the inspected API paths. Candidate list/detail/update/archive and platform submission/sync repositories filter by the verified owner and use the caller's JWT. Evaluation reads and writes also apply owner filters. Comparison/ranking use owner filters and reject cross-owner IDs as not found. API routes enforce approved recruiter access except `/api/auth/me`, which intentionally permits a signed-in user to inspect their own pending profile. AI analysis is owner-scoped and approved-recruiter-only.

The API uses the public Supabase key plus each request's verified JWT; no service-role key is used. Authentication diagnostics log only stage/status, candidate database diagnostics log safe metadata, GitHub provider errors map to generic messages, and AI provider failures log stable categories. GitHub and Groq calls have configured timeouts. LeetCode and HackerRank are candidate-reported submissions; no provider integration or scraping is implemented. Missing metrics remain absent; tests preserve genuine zero values.

## Database and RLS evidence limits

The historical migrations define composite owner foreign keys and owner-scoped policies. The isolated PGlite harness observed PostgreSQL catalog definitions and verified reconciliation rerun/preflight behavior, row/FK/index/policy/grant preservation, and configured-role versus owner-defined-role insert behavior. It did not query production or prove live Supabase RLS semantics, extensions, grants, migration ledger, or data compatibility. API ownership tests use mocked repositories, not a live Supabase project. Evaluation persistence remains schema-dependent and must be treated as blocked in production.

## Verification record

The temporary harness ran on PGlite `0.5.9`, reporting PostgreSQL `18.6` WASM. It passed the legacy four-status fixture, current five-status fixture, safe rerun, catalog checks, null-status rejection, invalid JSON and unsupported-role preflight rollback. The harness and reconciliation migration were read from `refs/stash` and copied temporarily under untracked scratch paths to run; those scratch files were deleted, and the stash was not changed.

`npm run test:migration:integration` itself is unavailable on this branch because no such package script is present. Production PostgreSQL may differ from PGlite in version, extensions, managed objects, and catalog behavior. Do not use this local result as production readiness evidence.

## Remaining risks and follow-up

- Restore/review the PGlite harness as a separately scoped tracked change before relying on repeatable CI coverage.
- Complete production read-only catalog/data review, reconcile actual schema with migration history, verify backup/restore, and obtain deployment approval before enabling evaluation-dependent flows.
- Confirm production Supabase RLS, grants, Auth profile state, and GitHub/Groq settings using authorized non-production accounts and approved read-only procedures; these were not inspected here.
- No transaction spans external GitHub retrieval and persistence; provider retrieval is read-only and the database write is a single atomic row insert. Evaluation persistence likewise writes one evaluation row after owner-scoped candidate/evidence reads. There is no multi-row transaction in these flows.
