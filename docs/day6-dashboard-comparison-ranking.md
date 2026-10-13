# Day 6 dashboard, comparison, and ranking APIs

## Implemented behavior

- `GET /api/dashboard` provides owner-scoped active-candidate and evaluation counts, status totals, and the latest ten evaluations.
- `POST /api/comparisons` accepts 2–5 positional candidate/evaluation pairs. The endpoint checks ownership, candidate association, result validity, role consistency, scoring-version consistency, and identical role-weight snapshots. Insufficient-evidence results remain explicitly incomplete and do not acquire an overall score.
- `GET /api/rankings` filters by supported role and current scoring version. For each candidate it uses only the latest evaluation for that role; an incomplete or incompatible latest run does not fall back to an older score. Eligible results with different role-weight snapshots fail with `409 ROLE_CONFIGURATION_MISMATCH`, avoiding a ranking across different rubrics. Compatible complete records are sorted deterministically by score descending, evaluation time ascending, candidate ID, and evaluation ID. Page ranks remain absolute across pages.
- All endpoints require an authenticated, approved recruiter. Data access uses the caller JWT plus explicit owner filters; existing RLS continues to apply.

Shared request and response schemas are exported by `@devrank/contracts`. Invalid requests return the existing `400 VALIDATION_ERROR`; missing/other-owner records use `404 NOT_FOUND`; incomplete comparisons, mixed role/scoring versions, unsupported scoring versions, and invalid snapshots have explicit error codes. The dashboard rejects an unrecognized evaluation status rather than silently omitting it from totals. Ranking responses report exclusions by reason. Missing scores are never converted to zero.

## Compatibility and blockers

Comparison and ranking depend on persisted `target_role` and `evaluation_result` columns, along with persisted scoring version and completed/insufficient-evidence statuses. The production readiness audit for the evaluation persistence migrations is still unresolved, and the remote migration ledger was previously observed blank without proving what schema was applied. These endpoints return `503 EVALUATION_SCHEMA_UNAVAILABLE` if the required columns are missing. Do not use migration repair, remote push, or a manual ledger insertion without a separately reviewed catalog-versus-history reconciliation plan.

The current service supports scoring version `1.0.0` only. Legacy snapshots with no scoring version, unsupported versions, result/row mismatches, and malformed results are excluded from rankings or rejected from comparisons. This feature does not recalculate historical scores or ask an LLM to score candidates. The dashboard's status totals reflect the statuses currently present in the schema and expose no fabricated result data.

## Verification

API tests use mocked repository fixtures; they do not contact Supabase. Deployment still requires the separate approved production catalog review, migration-history reconciliation, backup/restore readiness, and deployment approval.
