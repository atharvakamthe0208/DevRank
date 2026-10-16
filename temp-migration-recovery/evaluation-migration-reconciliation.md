# Evaluation persistence migration reconciliation

This plan is for `public.evaluations` in Supabase project `vamxpxhhsoruuqeezxgs`, which is identified by the operator as **PRODUCTION**. No production connection, SQL, schema write, or migration-history write was performed while preparing it. Use a change ticket, an authorized database operator, and a verified backup/restore plan before any deployment.

## Verified facts and unknowns

**Supplied production inspection:** `evaluation_result`, `role_weights_snapshot`, and `target_role` were absent; `role_profile_id` was `NOT NULL`; `evaluations_status_check` existed and was validated; stored status names included `pending`, `in_progress`, `completed`, and `failed`, but not `insufficient_evidence`. `supabase migration list` was reported to show blank remote versions for the six local historical versions. This is operator-supplied evidence, not a fresh database inspection by this task.

**Local repository facts:** the initial schema defines the candidate/owner composite foreign key, the role-profile/owner composite foreign key, both evaluation indexes, and owner-scoped RLS policies. The result migration adds the two JSON columns and changes the status check to five known values. The configured-role migration makes `role_profile_id` nullable and adds the target-role vocabulary check. The reconciliation migration repeats these intended effects behind schema/data checks. The evaluation repository persists the same result, status, target role, scoring version, evidence snapshot, and role-weight snapshot for both flows. Configured-role runs pass a null profile ID; owner-defined runs first fetch the role profile by both profile ID and authenticated owner ID, then pass the selected ID into the same persistence function.

**Unknown pending operator confirmation:** the complete live status-check expression; whether the three new columns or equivalent checks now exist; live foreign keys, indexes, grants and RLS policies; current complete status distribution; whether `supabase_migrations.schema_migrations` exists and what it contains; whether the CLI's local linked-project metadata points to the intended project; and which historical migration effects actually exist. Do not infer these from the reported missing columns or blank version output.

The repository has no `supabase/config.toml`; it has a migrations directory and CLI `.temp` state. Installed CLI version observed locally: `2.117.0`. Its help lists `migration list`, `migration fetch`, and `migration repair`. `repair` changes migration history and is not authorized by this plan. No remote command was run for this report.

The migration now requires `status` to be text and declared `NOT NULL`, rejects existing null statuses, checks the two composite foreign keys structurally, requires RLS enabled and not forced (as in the repository migrations), verifies all six historical owner/approval policies and their expressions, checks effective authenticated CRUD and rejects anon/PUBLIC table grants, and verifies the two evaluation indexes. The separate PGlite integration command now executes these catalog/policy checks against isolated fixtures and validates the relevant PostgreSQL output; see the integration section below. This does not verify the live production catalog.

## Stage A ΓÇö Read-only schema inspection

An authorized operator should verify the project ref and environment in the dashboard before running these queries. They are read-only and should be run in the production SQL Editor only under the organization's inspection procedure.

```sql
-- Required evaluation columns and nullability.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'evaluations'
order by ordinal_position;

-- All table constraints, complete definitions, and validation state.
select conname, contype, convalidated, pg_get_constraintdef(oid) as definition
from pg_catalog.pg_constraint
where conrelid = 'public.evaluations'::regclass
order by contype, conname;

-- Indexes and RLS policy definitions.
select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'evaluations'
order by indexname;

select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'evaluations'
order by policyname;

-- RLS mode and effective grants; the migration expects enabled=true, forced=false,
-- authenticated CRUD, and no anon/PUBLIC table privileges.
select relrowsecurity, relforcerowsecurity
from pg_catalog.pg_class
where oid = 'public.evaluations'::regclass;

select has_table_privilege('authenticated', 'public.evaluations', 'SELECT') as authenticated_select,
       has_table_privilege('authenticated', 'public.evaluations', 'INSERT') as authenticated_insert,
       has_table_privilege('authenticated', 'public.evaluations', 'UPDATE') as authenticated_update,
       has_table_privilege('authenticated', 'public.evaluations', 'DELETE') as authenticated_delete,
       has_table_privilege('anon', 'public.evaluations', 'SELECT') as anon_select,
       has_table_privilege('anon', 'public.evaluations', 'INSERT') as anon_insert,
       has_table_privilege('anon', 'public.evaluations', 'UPDATE') as anon_update,
       has_table_privilege('anon', 'public.evaluations', 'DELETE') as anon_delete;

-- Existing stored statuses.
select status, count(*) as row_count
from public.evaluations
group by status
order by status;

-- Check whether the Supabase migration ledger exists. If present, inspect it
-- separately with: select version, name from supabase_migrations.schema_migrations order by version;
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
```

The migration requires these exact policies from the initial schema and recruiter-auth migration: `evaluations_select_own`, `evaluations_insert_own`, `evaluations_update_own`, `evaluations_delete_own`, `devrank_auth_evaluations_owner_scope`, and `devrank_auth_evaluations_approval_gate`. The final policy must remain restrictive and include both authenticated-owner and approved-recruiter predicates. Save the output with the change record. If any query fails because an object is absent, record that absence; do not substitute assumptions. Compare each current constraint definition, including `convalidated`, against the migration preconditions before deployment.

## Stage B ΓÇö Reconciliation

The blank remote versions mean the CLI did not report those versions as present in its migration ledger at the time of the supplied inspection. They do **not** establish whether migration SQL ran: the schema may have been created manually, through another deployment system, or the CLI may have inspected a different target. The repo has no checked-in `supabase/config.toml` to establish a reproducible project configuration. Verify the active target out-of-band; never print or copy access tokens or database passwords into this record.

Create an effect matrix for every local historical migration (`20261010000000`, `20261011000000`, `20261011100000`, `20261011110000`, `20261012000000`, `20261013000000`) against the live catalog and its full data effects. Do not mark a version applied merely because one or more columns exist. The first migration also creates tables, keys, indexes, policies, grants, functions, and triggers; the recruiter migrations alter profile checks, grants, functions, and policies. Any missing or divergent effects need an explicit plan and must not be hidden by ledger edits.

The installed CLI exposes `migration repair`, but it is a migration-history mutation and must not be used speculatively. Supabase documents that `migration repair` changes only `supabase_migrations.schema_migrations` and does not run or revert migration SQL ([migration guide](https://supabase.com/docs/guides/deployment/database-migrations), [CLI reference](https://supabase.com/docs/reference/cli/global-flags)). If the authorized operator later establishes exact equivalence for a historical migration's complete effects, they should prepare a version-by-version tracking proposal using the documentation for the approved CLI version and obtain database-owner and change-management approval. Any version whose effects are incomplete or differ needs a reviewed forward migration or a separately approved baseline strategy. Do not fabricate ledger rows or use blanket `db push`, `--include-all`, or automatic historical replay to resolve the discrepancy.

Before any write, require a verified backup and tested restore procedure, an approved production change window, named operator approval, and an exact reviewed mapping of repository migration files to production ledger/schema state. This plan does not authorize a ledger repair.

## Stage C ΓÇö Deployment

No deployment command is specified: the target/history reconciliation strategy and the complete production status-check definition have not been established here. Do not run `db push`, `db reset`, `migration repair`, or any command that applies or records migrations until Stage A and Stage B are complete and the change is approved. The reconciliation migration intentionally aborts if the status check is absent, unvalidated, or differs from the exact reviewed repository legacy/current form. If production differs, revise and review the migration against the captured catalog before requesting approval; do not weaken the precondition at deployment time.

## Stage D ΓÇö Verification

After an approved deployment, rerun Stage A's column, constraint, index, policy, and status queries. Confirm the three new column types, nullable `role_profile_id`, a validated status check allowing `insufficient_evidence`, and unchanged candidate/owner and role-profile foreign keys, evaluation indexes, RLS policy definitions, and ownership gates. Check migration history only after the approved tracking procedure; it should correspond to the reviewed migration plan.

Then verify the API against a non-production fixture/project first: create one configured-role evaluation and confirm its stored row has a null role-profile ID and non-null supported target/result/weight snapshot; create one owner-defined-role evaluation and confirm it retains its role-profile ID and owner scoping. Do not fabricate historical results or scores for rows created before result persistence. Existing legacy rows without a stored result remain unavailable through the result API by design.

## Local PostgreSQL integration test

The normal API static checks in `apps/api/tests/evaluation-migration.test.ts` inspect SQL text and repository call paths. A separate PostgreSQL execution target is available and is intentionally excluded from `npm test`:

```powershell
npm run test:migration:integration
```

It runs `scripts/test-evaluation-migration.mjs` against fresh, in-memory PGlite databases (PostgreSQL 18.6 compiled to WASM). The fixtures execute the repository's initial schema, recruiter-auth, result, and configured-role migrations to establish the legacy four-status and current five-status schema shapes, including owner composite foreign keys, the expected six RLS policies, grants, and indexes. The test then executes the exact reconciliation migration file. It checks a legacy persisted row, the emitted catalog definitions, nullable `role_profile_id`, unchanged foreign keys/indexes/policies/grants/RLS, configured-role insertion with a null profile, owner-defined insertion with its profile, cross-owner FK rejection, null-status rejection, invalid JSON/target-role preflight failures with transactional rollback, and safe migration reruns.

This is real PostgreSQL execution and catalog output, but it is **not** a Supabase-hosted or native PostgreSQL server test. It does not prove behavior against the production PostgreSQL major version, installed extensions, Supabase roles/functions, actual production data, or the real migration ledger. It is staged-test evidence only. No production connection or SQL was used. Production readiness still requires live read-only catalog review, an approved migration-history reconciliation, backup/restore readiness, and deployment approval.
