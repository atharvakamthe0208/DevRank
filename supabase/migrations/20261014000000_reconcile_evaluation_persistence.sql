-- Reconcile the evaluations table for deterministic result persistence.
-- Existing result data and scores are never backfilled or synthesized.
-- The migration fails closed when production's status-check semantics are not one
-- of the two reviewed definitions used by this repository.
begin;
-- Verify the ownership/security baseline before any schema DDL. These invariants are
-- established by the initial schema and recruiter-auth migrations; do not silently
-- reconcile a database that lacks or has weakened them.
do $$
declare
  status_type text;
  status_nullable text;
  invalid_status_count bigint;
  invalid_status_examples text;
  policies_required record;
  actual_permissive text;
  actual_command text;
  actual_roles name[];
  actual_using text;
  actual_check text;
begin
  if to_regclass('public.candidates') is null or to_regclass('public.role_profiles') is null then
    raise exception 'Ownership precondition failed: public.candidates and public.role_profiles must exist before evaluations can be reconciled';
  end if;

  select data_type, is_nullable into status_type, status_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'evaluations' and column_name = 'status';
  if not found then
    raise exception 'Incompatible schema: public.evaluations.status is missing';
  end if;
  if status_type <> 'text' then
    raise exception 'Incompatible schema: public.evaluations.status must be text, found %', status_type;
  end if;

  select (select count(*) from public.evaluations where status is null),
         (select string_agg(id::text, ', ' order by id::text)
            from (select id from public.evaluations where status is null order by id limit 10) examples)
    into invalid_status_count, invalid_status_examples
  ;
  if invalid_status_count > 0 then
    raise exception 'Incompatible data: public.evaluations contains % row(s) with NULL status; sample evaluation IDs: %', invalid_status_count, invalid_status_examples;
  end if;
  if status_nullable <> 'NO' then
    raise exception 'Incompatible schema: public.evaluations.status must be declared NOT NULL; this migration will not change status nullability';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint fk
    where fk.conrelid = 'public.evaluations'::regclass
      and fk.confrelid = 'public.candidates'::regclass
      and fk.contype = 'f' and fk.convalidated and not fk.condeferrable
      and fk.confmatchtype = 's' and fk.confdeltype = 'c' and fk.confupdtype = 'a'
      and fk.conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.evaluations'::regclass and attname = 'candidate_id' and not attisdropped),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.evaluations'::regclass and attname = 'owner_id' and not attisdropped)
      ]::smallint[]
      and fk.confkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.candidates'::regclass and attname = 'id' and not attisdropped),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.candidates'::regclass and attname = 'owner_id' and not attisdropped)
      ]::smallint[]
  ) then
    raise exception 'Ownership precondition failed: expected validated candidate_id, owner_id -> candidates(id, owner_id) ON DELETE CASCADE foreign key';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint fk
    where fk.conrelid = 'public.evaluations'::regclass
      and fk.confrelid = 'public.role_profiles'::regclass
      and fk.contype = 'f' and fk.convalidated and not fk.condeferrable
      and fk.confmatchtype = 's' and fk.confdeltype = 'r' and fk.confupdtype = 'a'
      and fk.conkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.evaluations'::regclass and attname = 'role_profile_id' and not attisdropped),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.evaluations'::regclass and attname = 'owner_id' and not attisdropped)
      ]::smallint[]
      and fk.confkey = array[
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.role_profiles'::regclass and attname = 'id' and not attisdropped),
        (select attnum from pg_catalog.pg_attribute where attrelid = 'public.role_profiles'::regclass and attname = 'owner_id' and not attisdropped)
      ]::smallint[]
  ) then
    raise exception 'Ownership precondition failed: expected validated role_profile_id, owner_id -> role_profiles(id, owner_id) ON DELETE RESTRICT foreign key';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class t
    where t.oid = 'public.evaluations'::regclass
      and t.relrowsecurity and not t.relforcerowsecurity
  ) then
    raise exception 'Security precondition failed: evaluations must have RLS enabled and FORCE ROW LEVEL SECURITY disabled, matching the repository migrations';
  end if;

  if (select count(*) from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = 'evaluations') <> 6 then
    raise exception 'Security precondition failed: evaluations must have exactly the six reviewed owner/approval policies; inspect pg_policies for unexpected or missing policies';
  end if;

  for policies_required in
    select * from (values
      ('evaluations_select_own', 'PERMISSIVE', 'SELECT', 'owner_id=selectauth.uidasuid', null::text),
      ('evaluations_insert_own', 'PERMISSIVE', 'INSERT', null::text, 'owner_id=selectauth.uidasuid'),
      ('evaluations_update_own', 'PERMISSIVE', 'UPDATE', 'owner_id=selectauth.uidasuid', 'owner_id=selectauth.uidasuid'),
      ('evaluations_delete_own', 'PERMISSIVE', 'DELETE', 'owner_id=selectauth.uidasuid', null::text),
      ('devrank_auth_evaluations_owner_scope', 'PERMISSIVE', 'ALL', 'owner_id=selectauth.uidasuid', 'owner_id=selectauth.uidasuid'),
      ('devrank_auth_evaluations_approval_gate', 'RESTRICTIVE', 'ALL', 'owner_id=selectauth.uidasuidandselectis_approved_recruiterasis_approved_recruiter', 'owner_id=selectauth.uidasuidandselectis_approved_recruiterasis_approved_recruiter')
    ) expected(policy_name, permissive, command, using_expression, check_expression)
  loop
    select p.permissive, p.cmd, p.roles,
           nullif(replace(regexp_replace(lower(coalesce(p.qual, '')), '[[:space:]()]', '', 'g'), 'public.', ''), ''),
           nullif(replace(regexp_replace(lower(coalesce(p.with_check, '')), '[[:space:]()]', '', 'g'), 'public.', ''), '')
      into actual_permissive, actual_command, actual_roles, actual_using, actual_check
    from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'evaluations' and p.policyname = policies_required.policy_name;
    if not found then
      raise exception 'Security precondition failed: required policy public.% is missing', policies_required.policy_name;
    end if;
    if actual_permissive <> policies_required.permissive
       or actual_command <> policies_required.command
       or actual_roles <> array['authenticated']::name[]
       or actual_using is distinct from policies_required.using_expression
       or actual_check is distinct from policies_required.check_expression then
      raise exception 'Security precondition failed: policy public.% differs from the reviewed owner/approval policy; inspect pg_policies before migration', policies_required.policy_name;
    end if;
  end loop;

  if to_regclass('public.evaluations_owner_created_idx') is null
     or to_regclass('public.evaluations_candidate_created_idx') is null then
    raise exception 'Schema precondition failed: expected evaluations_owner_created_idx and evaluations_candidate_created_idx indexes';
  end if;
end;
$$;
-- Supabase installations commonly apply default table ACLs for anon,
-- authenticated, and service_role. PostgreSQL materializes those defaults into
-- the new table's relacl, so has_table_privilege() sees them as effective grants.
-- The repository's explicit model is narrower: authenticated CRUD only, with no
-- anon or PUBLIC table access. Remove only grants covered by this table owner's
-- default ACL; any custom grant or inherited privilege remains a hard failure.
do $$
declare
  table_oid oid := 'public.evaluations'::regclass;
  table_owner oid;
  table_schema oid;
  anon_oid oid := to_regrole('anon');
  authenticated_oid oid := to_regrole('authenticated');
  default_anon_privileges text[] := '{}'::text[];
  default_public_privileges text[] := '{}'::text[];
  default_authenticated_privileges text[] := '{}'::text[];
  authenticated_extra_privileges text;
  has_extra_privilege boolean;
begin
  if anon_oid is null or authenticated_oid is null then
    raise exception 'Privilege precondition failed: Supabase roles anon and authenticated must exist';
  end if;

  select relowner, relnamespace into table_owner, table_schema
  from pg_catalog.pg_class where oid = table_oid;

  -- pg_default_acl records the privileges that PostgreSQL materializes for
  -- tables created by this owner. Include global and schema-specific defaults.
  select coalesce(array_agg(distinct acl.privilege_type order by acl.privilege_type), '{}'::text[])
    into default_anon_privileges
  from pg_catalog.pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) acl
  where d.defaclrole = table_owner and d.defaclobjtype = 'r'
    and d.defaclnamespace in (0, table_schema) and acl.grantee = anon_oid;

  select coalesce(array_agg(distinct acl.privilege_type order by acl.privilege_type), '{}'::text[])
    into default_public_privileges
  from pg_catalog.pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) acl
  where d.defaclrole = table_owner and d.defaclobjtype = 'r'
    and d.defaclnamespace in (0, table_schema) and acl.grantee = 0;

  select coalesce(array_agg(distinct acl.privilege_type order by acl.privilege_type), '{}'::text[])
    into default_authenticated_privileges
  from pg_catalog.pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) acl
  where d.defaclrole = table_owner and d.defaclobjtype = 'r'
    and d.defaclnamespace in (0, table_schema) and acl.grantee = authenticated_oid;

  -- Do not revoke arbitrary anon/PUBLIC access. Every direct ACL privilege must
  -- be accounted for by the PostgreSQL defaults for this owner and schema.
  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = anon_oid
      and (acl.is_grantable or not acl.privilege_type = any(default_anon_privileges))
  ) then
    raise exception 'Privilege precondition failed: anon has a non-default or grantable evaluations privilege; inspect pg_class.relacl and pg_default_acl';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = 0
      and (acl.is_grantable or not acl.privilege_type = any(default_public_privileges))
  ) then
    raise exception 'Privilege precondition failed: PUBLIC has a non-default or grantable evaluations privilege; inspect pg_class.relacl and pg_default_acl';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = authenticated_oid
      and acl.is_grantable
  ) then
    raise exception 'Privilege precondition failed: authenticated has a grant option on evaluations; inspect pg_class.relacl';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = authenticated_oid
      and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      and not acl.privilege_type = any(default_authenticated_privileges)
  ) then
    raise exception 'Privilege precondition failed: authenticated has a non-default privilege beyond repository CRUD on evaluations; inspect pg_class.relacl and pg_default_acl';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = anon_oid
  ) then
    revoke all privileges on table public.evaluations from anon;
  end if;
  if exists (
    select 1 from pg_catalog.pg_class t
    cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
    where t.oid = table_oid and acl.grantee = 0
  ) then
    revoke all privileges on table public.evaluations from public;
  end if;

  select string_agg(distinct acl.privilege_type, ', ' order by acl.privilege_type)
    into authenticated_extra_privileges
  from pg_catalog.pg_class t
  cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
  where t.oid = table_oid and acl.grantee = authenticated_oid
    and acl.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  if authenticated_extra_privileges is not null then
    -- The names are PostgreSQL's privilege_type values, and were checked above
    -- to be covered by this owner's default ACL before dynamic REVOKE.
    execute format('revoke %s on table public.evaluations from authenticated', authenticated_extra_privileges);
  end if;

  if not has_table_privilege('authenticated', table_oid, 'SELECT')
     or not has_table_privilege('authenticated', table_oid, 'INSERT')
     or not has_table_privilege('authenticated', table_oid, 'UPDATE')
     or not has_table_privilege('authenticated', table_oid, 'DELETE') then
    raise exception 'Privilege precondition failed: authenticated must retain effective SELECT, INSERT, UPDATE, and DELETE on evaluations';
  end if;

  if has_table_privilege('anon', table_oid, 'SELECT')
     or has_table_privilege('anon', table_oid, 'INSERT')
     or has_table_privilege('anon', table_oid, 'UPDATE')
     or has_table_privilege('anon', table_oid, 'DELETE')
     or has_table_privilege('anon', table_oid, 'TRUNCATE')
     or has_table_privilege('anon', table_oid, 'REFERENCES')
     or has_table_privilege('anon', table_oid, 'TRIGGER')
     or has_table_privilege('authenticated', table_oid, 'TRUNCATE')
     or has_table_privilege('authenticated', table_oid, 'REFERENCES')
     or has_table_privilege('authenticated', table_oid, 'TRIGGER') then
    raise exception 'Privilege precondition failed: anon or authenticated retains effective table privileges outside the repository model; inspect role memberships and grants';
  end if;

  if current_setting('server_version_num')::integer >= 170000 then
    execute 'select has_table_privilege(''anon'', ''public.evaluations'', ''MAINTAIN'') or has_table_privilege(''authenticated'', ''public.evaluations'', ''MAINTAIN'')'
      into has_extra_privilege;
    if has_extra_privilege then
      raise exception 'Privilege precondition failed: anon or authenticated retains effective MAINTAIN on evaluations; inspect role memberships and grants';
    end if;
  end if;
end;
$$;
-- Check any pre-existing columns before the first schema change.
do $$
declare
  column_info record;
begin
  for column_info in
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'evaluations'
      and column_name in ('evaluation_result', 'role_weights_snapshot', 'target_role')
  loop
    if (column_info.column_name in ('evaluation_result', 'role_weights_snapshot') and column_info.data_type <> 'jsonb')
       or (column_info.column_name = 'target_role' and column_info.data_type <> 'text') then
      raise exception 'Incompatible schema: public.evaluations.% must be %, found %',
        column_info.column_name,
        case when column_info.column_name = 'target_role' then 'text' else 'jsonb' end,
        column_info.data_type;
    end if;
  end loop;
end;
$$;
alter table public.evaluations
  add column if not exists evaluation_result jsonb,
  add column if not exists role_weights_snapshot jsonb,
  add column if not exists target_role text;
-- Preflight persisted values before adding or validating any new data constraints.
do $$
declare
  invalid_count bigint;
  examples text;
begin
  select (select count(*) from public.evaluations where evaluation_result is not null and jsonb_typeof(evaluation_result) <> 'object'),
         (select string_agg(id::text, ', ' order by id::text) from (
            select id from public.evaluations where evaluation_result is not null and jsonb_typeof(evaluation_result) <> 'object' order by id limit 10
          ) examples)
    into invalid_count, examples
  ;
  if invalid_count > 0 then
    raise exception 'Cannot add evaluation_result object check: % existing row(s) have a non-object value; sample evaluation IDs: %', invalid_count, examples;
  end if;

  select (select count(*) from public.evaluations where role_weights_snapshot is not null and jsonb_typeof(role_weights_snapshot) <> 'object'),
         (select string_agg(id::text, ', ' order by id::text) from (
            select id from public.evaluations where role_weights_snapshot is not null and jsonb_typeof(role_weights_snapshot) <> 'object' order by id limit 10
          ) examples)
    into invalid_count, examples
  ;
  if invalid_count > 0 then
    raise exception 'Cannot add role_weights_snapshot object check: % existing row(s) have a non-object value; sample evaluation IDs: %', invalid_count, examples;
  end if;

  select (select count(*) from public.evaluations where target_role is not null and target_role not in ('software_developer', 'ai_ml_engineer', 'data_analyst')),
         (select string_agg(id::text, ', ' order by id::text) from (
            select id from public.evaluations where target_role is not null and target_role not in ('software_developer', 'ai_ml_engineer', 'data_analyst') order by id limit 10
          ) examples)
    into invalid_count, examples
  ;
  if invalid_count > 0 then
    raise exception 'Cannot add target_role vocabulary check: % existing row(s) have unsupported roles; sample evaluation IDs: %', invalid_count, examples;
  end if;

  select (select count(*) from public.evaluations where status not in ('pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed')),
         (select string_agg(id::text, ', ' order by id::text) from (
            select id from public.evaluations where status not in ('pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed') order by id limit 10
          ) examples)
    into invalid_count, examples
  ;
  if invalid_count > 0 then
    raise exception 'Cannot allow insufficient_evidence status: % existing row(s) use statuses outside the reviewed contract vocabulary; sample evaluation IDs: %', invalid_count, examples;
  end if;
end;
$$;
-- Verify same-named constraints by their full normalized PostgreSQL definitions.
-- Name collisions with different semantics abort; they are never treated as success.
do $$
declare
  actual_definition text;
  actual_validated boolean;
begin
  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g'))
         , convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_evaluation_result_object_check'
    and contype = 'c';
  if actual_definition is not null and actual_definition <> 'check(((evaluation_resultisnull)or(jsonb_typeof(evaluation_result)=''object''::text)))' then
    raise exception 'Constraint name collision: evaluations_evaluation_result_object_check has unexpected definition: %', actual_definition;
  end if;
  if actual_definition is not null and not actual_validated then
    raise exception 'Constraint evaluations_evaluation_result_object_check exists but is NOT VALID; inspect existing rows and validate it before rerunning';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g'))
         , convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_role_weights_snapshot_object_check'
    and contype = 'c';
  if actual_definition is not null and actual_definition <> 'check(((role_weights_snapshotisnull)or(jsonb_typeof(role_weights_snapshot)=''object''::text)))' then
    raise exception 'Constraint name collision: evaluations_role_weights_snapshot_object_check has unexpected definition: %', actual_definition;
  end if;
  if actual_definition is not null and not actual_validated then
    raise exception 'Constraint evaluations_role_weights_snapshot_object_check exists but is NOT VALID; inspect existing rows and validate it before rerunning';
  end if;

  -- Historical result migrations used these names for semantically identical
  -- checks. Validate them explicitly so the current schema does not gain duplicates.
  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g')),
         convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_evaluation_result_check'
    and contype = 'c';
  if actual_definition is not null and actual_definition <> 'check(((evaluation_resultisnull)or(jsonb_typeof(evaluation_result)=''object''::text)))' then
    raise exception 'Constraint name collision: evaluations_evaluation_result_check has unexpected definition: %', actual_definition;
  end if;
  if actual_definition is not null and not actual_validated then
    raise exception 'Constraint evaluations_evaluation_result_check exists but is NOT VALID; inspect existing rows and validate it before rerunning';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g')),
         convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_role_weights_snapshot_check'
    and contype = 'c';
  if actual_definition is not null and actual_definition <> 'check(((role_weights_snapshotisnull)or(jsonb_typeof(role_weights_snapshot)=''object''::text)))' then
    raise exception 'Constraint name collision: evaluations_role_weights_snapshot_check has unexpected definition: %', actual_definition;
  end if;
  if actual_definition is not null and not actual_validated then
    raise exception 'Constraint evaluations_role_weights_snapshot_check exists but is NOT VALID; inspect existing rows and validate it before rerunning';
  end if;

  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g'))
         , convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_target_role_check'
    and contype = 'c';
  if actual_definition is not null and actual_definition <> 'check(((target_roleisnull)or(target_role=any(array[''software_developer''::text,''ai_ml_engineer''::text,''data_analyst''::text]))))' then
    raise exception 'Constraint name collision: evaluations_target_role_check has unexpected definition: %', actual_definition;
  end if;
  if actual_definition is not null and not actual_validated then
    raise exception 'Constraint evaluations_target_role_check exists but is NOT VALID; inspect existing rows and validate it before rerunning';
  end if;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass and conname in ('evaluations_evaluation_result_object_check', 'evaluations_evaluation_result_check') and contype = 'c') then
    alter table public.evaluations add constraint evaluations_evaluation_result_object_check
      check (evaluation_result is null or jsonb_typeof(evaluation_result) = 'object');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass and conname in ('evaluations_role_weights_snapshot_object_check', 'evaluations_role_weights_snapshot_check') and contype = 'c') then
    alter table public.evaluations add constraint evaluations_role_weights_snapshot_object_check
      check (role_weights_snapshot is null or jsonb_typeof(role_weights_snapshot) = 'object');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass and conname = 'evaluations_target_role_check' and contype = 'c') then
    alter table public.evaluations add constraint evaluations_target_role_check
      check (target_role is null or target_role in ('software_developer', 'ai_ml_engineer', 'data_analyst'));
  end if;
end;
$$;
-- Require the actual constraint to match exactly one reviewed repository form.
-- The production catalog definition was not supplied for this migration review;
-- any unavailable, renamed, or different constraint is a hard stop with its definition.
do $$
declare
  actual_definition text;
  actual_validated boolean;
  legacy_definition constant text := 'check((status=any(array[''pending''::text,''in_progress''::text,''completed''::text,''failed''::text])))';
  current_definition constant text := 'check((status=any(array[''pending''::text,''in_progress''::text,''completed''::text,''insufficient_evidence''::text,''failed''::text])))';
begin
  select lower(regexp_replace(pg_catalog.pg_get_constraintdef(oid), '\s+', '', 'g'))
         , convalidated into actual_definition, actual_validated
  from pg_catalog.pg_constraint
  where conrelid = 'public.evaluations'::regclass
    and conname = 'evaluations_status_check'
    and contype = 'c';

  if actual_definition is null then
    raise exception 'Cannot reconcile evaluation status: public.evaluations.evaluations_status_check is missing; inspect production constraints and prepare an explicitly reviewed migration';
  end if;
  if not actual_validated then
    raise exception 'Cannot reconcile evaluation status: evaluations_status_check is NOT VALID; validate and inspect it before applying this migration';
  end if;
  if actual_definition not in (legacy_definition, current_definition) then
    raise exception 'Cannot reconcile evaluation status: unexpected evaluations_status_check definition: %; expected one of the reviewed legacy or current repository definitions', actual_definition;
  end if;

  if actual_definition = legacy_definition then
    alter table public.evaluations drop constraint evaluations_status_check;
    alter table public.evaluations add constraint evaluations_status_check
      check (status in ('pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed'));
  end if;
end;
$$;
-- Configured-role runs write role_profile_id = NULL. PostgreSQL's default MATCH SIMPLE
-- behavior skips only the composite role-profile FK when that component is NULL.
-- Owner-defined runs still write a profile ID; owner_id and the candidate composite FK
-- remain unchanged. This changes only nullability and does not remove the FK.
alter table public.evaluations alter column role_profile_id drop not null;
comment on column public.evaluations.evaluation_result is
  'Validated deterministic evaluation response snapshot; AI explanations cannot alter numerical scores.';
comment on column public.evaluations.role_weights_snapshot is
  'Effective role weights captured at evaluation time for historical reproducibility.';
comment on column public.evaluations.target_role is
  'Supported role identifier captured for deterministic configured-role evaluations.';
commit;
