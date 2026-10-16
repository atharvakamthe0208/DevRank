# Evaluation API `DATABASE_UNAVAILABLE` investigation

## Finding

`POST /api/evaluations` is routed to `EvaluationRepository.run()`. The repository verifies that the candidate belongs to the authenticated owner, reads that owner's platform evidence, computes the result deterministically, then inserts a row into `public.evaluations`. The insert includes `target_role`, `role_weights_snapshot`, and `evaluation_result`; the response is returned only after PostgREST returns the inserted row. Insert errors were previously replaced with a generic 503 without a server-side database diagnostic.

The configured API process on this workstation points at the known production Supabase project. It was not sent an evaluation request and no SQL was executed. Earlier task context records that production lacked `evaluation_result`, `role_weights_snapshot`, and `target_role`; this makes a production schema mismatch the leading cause of this 503. The specific failed operation, SQLSTATE/PostgREST code, and first missing field were not observed in this investigation, so the root cause is not claimed as freshly reproduced.

## Required schema contract

- `evaluation_result jsonb` and `role_weights_snapshot jsonb` must exist. Non-null values must be JSON objects; the application writes snapshots and does not synthesize or backfill historical scores.
- `target_role text` must exist and accept `software_developer`, `ai_ml_engineer`, and `data_analyst`.
- `status` must accept `pending`, `in_progress`, `completed`, `insufficient_evidence`, and `failed`. A `NULL` status remains invalid.
- `role_profile_id` must be nullable for configured-role runs. Those rows use `NULL` there and persist the configured role in `target_role`.
- Owner-defined-role runs continue to write their owned `role_profile_id`. Existing owner and role-profile foreign keys, RLS, and owner filters must remain active.

The historical repository migrations describe these columns, status values, and nullable role-profile behavior, but their presence in source does not prove that production applied them. No migration-history repair or deployment is authorized by this investigation.

## Change in this investigation

The repository now logs only the bounded operation name, failure source, error category, SQLSTATE/PostgREST code, a recognized evaluation column name, and a syntactically safe constraint identifier. Raw provider messages, details, tokens, candidate data, evidence, and scores are never logged or returned. The HTTP response remains the generic 503. Tests cover a simulated `PGRST204` for `target_role`, output sanitization, configured-role inserts with a null role-profile ID, and owner-defined-role inserts retaining their role-profile ID.

## Verification and deployment gate

Unit tests, typecheck, and build verify application behavior against mocked PostgREST responses only. They do not prove successful persistence against any live database. The operator must first use an approved non-production database to verify both insert paths and catalog constraints. For production, perform the separate approved read-only catalog/data audit, reconcile the actual schema with the migration ledger, verify backup/restore readiness, and obtain deployment approval before any migration is applied. Do not run `db push` or migration-history repair as a workaround.
