# Evaluation persistence migration: production-readiness audit

**Audit date:** 2026-10-16 (local verification updated; production audit remains unperformed)
**Intended environment:** Supabase project `vamxpxhhsoruuqeezxgs`, identified by the requester as **PRODUCTION**
**Audit state:** Production was not queried. This is a local repository and test-runtime audit plus an operator-ready read-only SQL procedure. All production catalog/data conclusions below remain unverified except where explicitly identified as prior operator-supplied context.

## Executive result

**Deployment is blocked.** Local static checks and the disposable PostgreSQL execution harness pass. This environment exposes no PostgreSQL client/server, Supabase CLI command, or database connector, and no explicitly confirmed read-only production connection was available. No connection was attempted. Prior task context reported three missing columns, `role_profile_id NOT NULL`, an existing validated status constraint, and blank remote migration versions. These are supplied historical observations, not evidence collected during this audit; the exact live schema, data, grants, policies, and ledger are unknown.

No production SQL, migration, ledger operation, link change, or data change was performed. No historical migration was edited.

## Local verification

| Command | Result | Evidence |
|---|---|---|
| `npm run test:migration:integration` | PASS (2026-10-16) | PGlite PostgreSQL 18.6 (0.5.9); legacy/current fixtures, actual reconciliation SQL, rerun, column/status checks, FK/RLS-policy/index/privilege checks, role-flow inserts, FK/null rejection, and invalid JSON/target/status rollback checks passed. |
| `npm run test:migration:acl` | PASS (2026-10-16) | Supabase-style default grants, unexpected direct grants, PUBLIC grants, and inherited privilege cases passed in PGlite. |
| `npm test` | PASS (2026-10-16) | Web 43 tests, API 187 tests, contracts 10 tests; 240 total. |
| `npm run typecheck` | PASS (2026-10-16) | Contracts build and API/web TypeScript checks exited 0. |
| `npm run build` | PASS (2026-10-16) | Contracts, API, and web builds exited 0. Vite emitted a 717.65 kB main-JS advisory (>500 kB). |
| `npm run lint` | NO LINTER CONFIGURED (2026-10-16) | Root wrapper exited 0, but workspace manifests define no lint scripts. |
| `git diff --check` | PASS (2026-10-16) | No whitespace errors. |

The PGlite dependency is an existing root `devDependency`; `test:migration:integration` is a dedicated script and is excluded from `npm test`. The runtime creates fresh in-memory databases and needs no database URL or Supabase credential. The test runs historical fixture migrations and then reads and executes the exact reconciliation migration file. ACL normalization behavior is tested separately by `test:migration:acl`. PGlite is PostgreSQL compiled to WASM, not the Supabase server. Its PostgreSQL 18.6 catalog output may differ from the production major/minor version, extension set, roles, and Supabase-managed objects.

## Facts, assumptions, and classification

Classification means: **VERIFIED** = checked against this local repository or disposable PostgreSQL runtime; **MISMATCH** = a supplied production observation conflicts with the migration's desired end state, but has not been freshly queried; **UNKNOWN** = no reliable live evidence is available. The classification does not elevate supplied production context to live verification.

| Requirement | Classification | Evidence / consequence |
|---|---|---|
| Production PostgreSQL version and extensions | UNKNOWN | No production connection was made. PGlite uses PostgreSQL 18.6 WASM; production compatibility is not established. |
| Three result columns exist with the intended types | MISMATCH (prior supplied report only) | Prior task context says `evaluation_result`, `role_weights_snapshot`, and `target_role` are missing. Confirm afresh before selecting a deployment path. |
| `status` is text, NOT NULL, and has the exact accepted status constraint | UNKNOWN | Supplied context says a validated status check exists and known values included four statuses. It did not include the complete expression or its exact `pg_get_constraintdef` output. Migration accepts only exact normalized repository legacy or current definitions. |
| No NULL status rows and existing values fit the five-value contract | UNKNOWN | PGlite exercises clean and null-row cases; no production counts were collected. |
| `role_profile_id` nullability | MISMATCH (prior supplied report only) | Prior task context says NOT NULL. The migration drops NOT NULL and retains the composite FK. |
| JSON object shape / target-role vocabulary in existing rows | UNKNOWN | No production rows were queried. The migration aborts on non-object non-NULL JSON and values outside `software_developer`, `ai_ml_engineer`, `data_analyst`. |
| Candidate/owner and role-profile/owner composite foreign keys | UNKNOWN | Local initial migration defines both. PGlite executes them and verifies null profile behavior. No production definitions/validation states are available. |
| Evaluation indexes | UNKNOWN | Local initial migration defines owner/created and candidate/created indexes. No production index definitions are available. The migration checks names; the operator audit must compare definitions. |
| RLS enabled, not forced; exact six policy definitions | UNKNOWN | Historical migrations define these policies. PGlite observed the actual catalog output. Production policy expressions and RLS mode are unknown. |
| Table/sequence grants for `anon`, `authenticated`, `PUBLIC`, `service_role` | UNKNOWN | No production ACL/effective privilege output was obtained. The migration checks authenticated CRUD and rejects anon/PUBLIC table grants, but it does not make an explicit service-role compatibility decision. |
| Historical schema effects | VERIFIED locally; UNKNOWN in production | Local migrations are reviewed below. Production effects cannot be inferred from one missing-column report. |
| Supabase migration ledger | UNKNOWN (prior supplied report only) | Earlier context reported blank remote versions for local migrations. This audit did not query the ledger. Blank output does not prove the SQL was never applied. |
| Evaluation repository paths | VERIFIED locally | The repository persists `role_profile_id`, `target_role`, `status`, `role_weights_snapshot`, and `evaluation_result`. Configured-role evaluations pass a null role-profile ID; owner-defined roles resolve a profile within the authenticated owner scope and retain that ID. Composite FK `MATCH SIMPLE` semantics allow the configured path when the FK's profile component is NULL; owner-defined and cross-owner behavior was exercised in PGlite. |

### Historical schema versus ledger reconciliation

The local SQL effects below are code-verified. Production effects and ledger rows have not been queried. The previous report of blank remote versions is retained only as unverified operator-provided context.

| Version | Local migration effects (summary) | Production schema effects | Production ledger |
|---|---|---|---|
| `20261010000000` | Initial owner-scoped tables, keys/FKs, indexes, triggers, RLS policies, grants, and helper function. | UNKNOWN | UNKNOWN; prior context says remote version blank. |
| `20261011000000` | Candidate platform identifiers, archive timestamp, format checks, active-candidate index. | UNKNOWN | UNKNOWN; prior context says remote version blank. |
| `20261011100000` | Recruiter profile columns/checks, auth/signup functions and triggers, RLS policies, function/table grants. | UNKNOWN | UNKNOWN; prior context says remote version blank. |
| `20261011110000` | Admin/recruiter approval functions, grants, and audit behavior. | UNKNOWN | UNKNOWN; prior context says remote version blank. |
| `20261012000000` | Five-value evaluation status check; JSONB result and weight snapshot columns/checks/comments. | MISMATCH only for the three reported missing columns; all other effects UNKNOWN. | UNKNOWN; prior context says remote version blank. |
| `20261013000000` | Nullable `role_profile_id`, target-role column/vocabulary check/comment. | MISMATCH only for reported NOT NULL profile ID and missing `target_role`; other effects UNKNOWN. | UNKNOWN; prior context says remote version blank. |
| `20261014000000` | Proposed reconciler; not authorized/applied by this audit. | Not queried; do not infer absence from migration filename. | UNKNOWN; prior context says history output was blank for earlier versions, not proof about this version. |

Do not run `db push`, replay historical SQL, or repair ledger rows based on the reported blank output. First establish the full effect matrix against production and capture the actual ledger. Only then can an owner-approved, version-specific tracking proposal be considered.

## Operator read-only audit SQL

An authorized operator should open the SQL Editor from the dashboard after independently verifying the production project ref `vamxpxhhsoruuqeezxgs`. Run the following read-only statements and retain their results with the change record. Do not include candidate names, emails, tokens, or connection details in the record. Queries return catalog information and aggregates only.

### Server and required columns

```sql
select version() as server_version,
       current_setting('server_version') as server_version_setting,
       current_setting('server_version_num') as server_version_num;

with expected(column_name) as (
  values ('evaluation_result'), ('role_weights_snapshot'), ('target_role'),
         ('status'), ('role_profile_id')
)
select e.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default,
       (c.column_name is not null) as present
from expected e
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = 'evaluations'
 and c.column_name = e.column_name
order by e.column_name;
```

### All evaluation constraints, foreign-key mappings, and indexes

```sql
select conname, contype, convalidated, condeferrable, condeferred,
       pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint
where conrelid = to_regclass('public.evaluations')
order by contype, conname;

select fk.conname,
       child.relname as child_table,
       parent_ns.nspname as parent_schema,
       parent.relname as parent_table,
       fk.convalidated, fk.condeferrable, fk.confmatchtype,
       fk.confupdtype, fk.confdeltype,
       pg_get_constraintdef(fk.oid, true) as definition
from pg_catalog.pg_constraint fk
join pg_catalog.pg_class child on child.oid = fk.conrelid
join pg_catalog.pg_class parent on parent.oid = fk.confrelid
join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
where fk.contype = 'f'
  and (fk.conrelid = to_regclass('public.evaluations')
       or fk.confrelid = to_regclass('public.evaluations'))
order by child.relname, fk.conname;

select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'evaluations'
order by indexname;
```

### RLS and exact policy catalog

```sql
select c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_catalog.pg_class c
where c.oid = to_regclass('public.evaluations');

select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'evaluations'
order by policyname;
```

### Table and owned-sequence privileges

This reports both explicit table ACL entries (including `PUBLIC`) and effective table privileges for the named Supabase roles that exist. It does not enumerate arbitrary custom roles; the operator should add any role used by the deployed API to the role list after reviewing its identity.

```sql
select grantee, privilege_type, is_grantable
from information_schema.table_privileges
where table_schema = 'public' and table_name = 'evaluations'
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by grantee, privilege_type;

select r.rolname as role_name,
       has_table_privilege(r.rolname, 'public.evaluations', 'SELECT') as can_select,
       has_table_privilege(r.rolname, 'public.evaluations', 'INSERT') as can_insert,
       has_table_privilege(r.rolname, 'public.evaluations', 'UPDATE') as can_update,
       has_table_privilege(r.rolname, 'public.evaluations', 'DELETE') as can_delete,
       has_table_privilege(r.rolname, 'public.evaluations', 'TRUNCATE') as can_truncate,
       has_table_privilege(r.rolname, 'public.evaluations', 'REFERENCES') as can_reference,
       has_table_privilege(r.rolname, 'public.evaluations', 'TRIGGER') as can_trigger
from pg_catalog.pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by r.rolname;

with owned_sequences as (
  select distinct n.nspname, s.relname, s.oid, s.relowner, s.relacl
  from pg_catalog.pg_class s
  join pg_catalog.pg_namespace n on n.oid = s.relnamespace
  join pg_catalog.pg_depend d on d.objid = s.oid
  where s.relkind = 'S'
    and d.refobjid = to_regclass('public.evaluations')
    and d.deptype in ('a', 'i')
)
select format('%I.%I', s.nspname, s.relname) as sequence_name,
       r.rolname as role_name,
       has_sequence_privilege(r.rolname, s.oid, 'USAGE') as can_use,
       has_sequence_privilege(r.rolname, s.oid, 'SELECT') as can_select,
       has_sequence_privilege(r.rolname, s.oid, 'UPDATE') as can_update
from owned_sequences s
cross join pg_catalog.pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role')
order by sequence_name, role_name;

with owned_sequences as (
  select distinct n.nspname, s.relname, s.oid, s.relowner, s.relacl
  from pg_catalog.pg_class s
  join pg_catalog.pg_namespace n on n.oid = s.relnamespace
  join pg_catalog.pg_depend d on d.objid = s.oid
  where s.relkind = 'S'
    and d.refobjid = to_regclass('public.evaluations')
    and d.deptype in ('a', 'i')
)
select format('%I.%I', s.nspname, s.relname) as sequence_name,
       case when acl.grantee = 0 then 'PUBLIC' else role_name.rolname end as grantee,
       acl.privilege_type, acl.is_grantable
from owned_sequences s
cross join lateral aclexplode(coalesce(s.relacl, acldefault('S', s.relowner))) acl
left join pg_catalog.pg_roles role_name on role_name.oid = acl.grantee
where acl.grantee = 0 or role_name.rolname in ('anon', 'authenticated', 'service_role')
order by sequence_name, grantee, acl.privilege_type;
```

### Existing data and migration preflight counts

These statements do not return evaluation IDs or candidate data. Run JSON and target-role checks only if the corresponding column query reports the column present; otherwise record that it is absent and the invalid count is not applicable.

```sql
select status, count(*) as row_count
from public.evaluations
group by status
order by status nulls first;

select count(*) filter (where status is null) as null_status_rows,
       count(*) filter (where status is not null and status not in
         ('pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed')) as unsupported_status_rows
from public.evaluations;
```

If `evaluation_result` exists:

```sql
select count(*) filter (where evaluation_result is not null
                         and jsonb_typeof(evaluation_result) <> 'object') as invalid_json_shape_rows
from public.evaluations;
```

If `role_weights_snapshot` exists:

```sql
select count(*) filter (where role_weights_snapshot is not null
                         and jsonb_typeof(role_weights_snapshot) <> 'object') as invalid_json_shape_rows
from public.evaluations;
```

If `target_role` exists:

```sql
select count(*) filter (where target_role is not null
                         and target_role not in
                           ('software_developer', 'ai_ml_engineer', 'data_analyst')) as unsupported_target_role_rows
from public.evaluations;
```

### Migration ledger

First run the existence query. Only if it returns a relation should the second query be run; this avoids treating an absent schema/table as an empty ledger.

```sql
select to_regclass('supabase_migrations.schema_migrations') as migration_ledger;
```

If present:

```sql
select version, name
from supabase_migrations.schema_migrations
order by version;
```

No query above modifies data, catalog, or ledger. Stop and preserve the error/result if any expected relation or role is absent; do not create a substitute object for the audit.

## Comparison with migration assumptions

The reconciliation migration assumes all of the following. Each must be checked against the operator output before deployment:

1. `public.evaluations`, `public.candidates`, and `public.role_profiles` exist, and `status` is `text NOT NULL` with no null rows.
2. The validated `evaluations_status_check` definition, after lowercase and whitespace normalization, is exactly the repository's four-status legacy form or five-status current form. Anything else, including a renamed/missing/unvalidated constraint, aborts. The migration changes only the four-status form to the five-status form after it preflights existing status values.
3. Both expected composite foreign keys are validated, non-deferrable, default MATCH SIMPLE, with candidate deletion CASCADE and role-profile deletion RESTRICT. Dropping NOT NULL on `role_profile_id` leaves its FK in place; MATCH SIMPLE skips that FK when the profile component is null. Owner-defined rows still require an owner-matching role profile. This migration does not add or repair foreign keys.
4. RLS is enabled and not forced; exactly six named policies match the reviewed owner/authenticated/approval expressions; authenticated has effective CRUD; anon and PUBLIC have no table privileges; expected index names exist. The migration does not change RLS, policies, grants, or indexes.
5. Existing result/weight values are either SQL NULL or JSON objects; target-role values are NULL or one of the three supported role IDs. Existing values outside these shapes stop the transaction; no rows or scores are rewritten/backfilled.
6. Same-named JSON/target constraints match their reviewed normalized definitions and are validated. The migration also recognizes and verifies the historical result-check names so an already-current schema does not receive duplicate equivalent JSON checks.

The migration does not explicitly verify every other schema effect from the initial schema (for example the standalone `owner_id -> auth.users` FK or the complete role grants used by an application-specific service role). The operator's full catalog/effect matrix must establish these invariants independently. A partial match such as a present column is not proof that a historical migration is wholly applied.

## Proposed deployment sequence and approvals

1. **Read-only audit:** a named database operator verifies the project ref in the Supabase dashboard, runs the audit SQL above, and attaches results with sensitive values omitted. A second reviewer compares every constraint, FK, index, policy, ACL, data count, and ledger row.
2. **Migration mapping:** produce a version-by-version matrix for all six historical migrations. For each, verify the complete structural and behavioral effects, not one column. Resolve differences in a reviewed forward-only plan. Do not replay historical SQL or alter the ledger speculatively.
3. **Non-production rehearsal:** execute the exact migration in a disposable database matching the production PostgreSQL major version and required extensions/roles as closely as practical. Exercise rollback and API flows. PGlite passing is necessary local evidence, not a substitute for this rehearsal.
4. **Recovery readiness:** obtain a fresh backup, identify its recovery point and retention, and demonstrate a restore into an isolated environment. Record owner approval, RPO/RTO, and the plan if the migration commits but application verification fails.
5. **Change approval:** database owner and application owner approve the migration file hash, precise target, migration-history plan, deployment operator, maintenance window, and stop/rollback criteria. No such approval is recorded by this audit.
6. **Deployment:** after approval only, use the approved version-specific migration mechanism. This audit provides no `db push` or `migration repair` command because the production catalog/ledger reconciliation is unknown. Do not treat the reported blank remote history as authorization for a bulk push or history repair.
7. **Post-deployment:** run the verification SQL below, record catalog outputs and migration ledger state, and perform configured-role and owner-defined-role API smoke tests in the approved target.

### Preflight abort conditions

Abort before any write if the production project identity is uncertain; any exact check constraint differs or is unvalidated; any old status is outside the reviewed vocabulary; status is nullable or contains NULL; an expected FK, policy, index, privilege invariant, or column type differs; existing JSON/target data violates the intended checks; the ledger cannot be reconciled version by version; or backup/restore and named deployment approvals are missing.

### Post-deployment verification SQL

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'evaluations'
  and column_name in ('evaluation_result', 'role_weights_snapshot', 'target_role', 'status', 'role_profile_id')
order by column_name;

select conname, contype, convalidated, pg_get_constraintdef(oid, true) as definition
from pg_catalog.pg_constraint
where conrelid = to_regclass('public.evaluations')
order by contype, conname;

select indexname, indexdef from pg_catalog.pg_indexes
where schemaname = 'public' and tablename = 'evaluations' order by indexname;

select relrowsecurity, relforcerowsecurity
from pg_catalog.pg_class where oid = to_regclass('public.evaluations');

select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname = 'public' and tablename = 'evaluations' order by policyname;

select status, count(*) as row_count
from public.evaluations group by status order by status nulls first;
```

Verify `role_profile_id` is nullable; the three new columns have types `jsonb`, `jsonb`, and `text`; the validated five-status check includes `insufficient_evidence`; the two composite FKs, indexes, RLS mode/policies, and grants match the pre-deployment record; and no historical score/result was fabricated. Then test one configured-role API evaluation (null profile ID, supported target and persisted result/snapshot) and one owner-defined evaluation (retained owner-scoped profile ID).

## Rollback and recovery limitations

The migration wraps its DDL in a transaction, so an error before COMMIT should roll back schema changes. Once committed, the migration has no automatic down migration. Dropping the new columns could discard results written after deployment; restoring the old status check could reject rows that use `insufficient_evidence`; setting `role_profile_id` NOT NULL could fail for configured-role rows. Do not run an improvised reverse SQL script. If post-deploy verification fails, stop application writes affecting evaluation persistence if approved by incident command, preserve diagnostics, and follow the tested restore or a reviewed forward-fix plan under the incident/change process. The recovery decision must honor the recorded RPO/RTO and account for writes since the backup.

## Blockers and unresolved questions

- No fresh, authorized read-only production connection was available; every live catalog/data/ledger result is unknown.
- The exact production status-check expression and all live FK, index, RLS, policy, and ACL definitions are unknown.
- Counts for null statuses, invalid JSON shapes, unsupported target roles, and full status distribution are unknown.
- Historical migration effects cannot be matched to the actual production schema or migration ledger. Prior blank CLI output is unverified and does not prove SQL absence.
- Production PostgreSQL version/extensions and compatibility with PGlite are unknown.
- Backup/restore test, named approvals, change window, exact migration-history reconciliation, and deployment operator are not established.

Until these blockers are resolved and the proposed checkpoints are approved, the migration is **not production-ready** and deployment is blocked.
