-- Permanently delete a recruiter's candidate and its dependent records.
-- The explicit comparison link deletion is required because comparison_candidates
-- references evaluations with ON DELETE RESTRICT. Candidate ownership and recruiter
-- approval remain enforced by the existing RLS policies through SECURITY INVOKER.
begin;

do $$
begin
  if to_regclass('public.candidates') is null
    or to_regclass('public.comparison_candidates') is null
    or to_regclass('public.platform_evidence') is null
    or to_regclass('public.evaluations') is null
    or to_regclass('public.category_scores') is null
    or to_regclass('public.ai_analyses') is null then
    raise exception 'Permanent candidate deletion requires the complete candidate/evaluation schema';
  end if;

  if to_regprocedure('auth.uid()') is null then
    raise exception 'Permanent candidate deletion requires auth.uid()';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.candidates'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.comparison_candidates'::regclass and relrowsecurity
  ) then
    raise exception 'Permanent candidate deletion requires RLS on candidates and comparison_candidates';
  end if;

  if exists (
    select 1
    from (values
      ('platform_evidence', 'candidates'),
      ('evaluations', 'candidates'),
      ('category_scores', 'evaluations'),
      ('ai_analyses', 'evaluations')
    ) as expected(child_table, parent_table)
    where not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_row
      where constraint_row.contype = 'f'
        and constraint_row.conrelid = pg_catalog.to_regclass('public.' || expected.child_table)
        and constraint_row.confrelid = pg_catalog.to_regclass('public.' || expected.parent_table)
        and constraint_row.confdeltype = 'c'
        and constraint_row.convalidated
    )
  ) then
    raise exception 'Permanent candidate deletion requires validated cascading foreign keys for evidence and evaluation dependents';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'candidates'
      and policyname = 'devrank_auth_candidates_owner_scope'
      and permissive = 'PERMISSIVE' and 'authenticated' = any (roles)
      and qual like '%auth.uid%'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'candidates'
      and policyname = 'devrank_auth_candidates_approval_gate'
      and permissive = 'RESTRICTIVE' and 'authenticated' = any (roles)
      and qual like '%is_approved_recruiter%'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'comparison_candidates'
      and policyname = 'devrank_auth_comparison_candidates_owner_scope'
      and permissive = 'PERMISSIVE' and 'authenticated' = any (roles)
      and qual like '%auth.uid%'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'comparison_candidates'
      and policyname = 'devrank_auth_comparison_candidates_approval_gate'
      and permissive = 'RESTRICTIVE' and 'authenticated' = any (roles)
      and qual like '%is_approved_recruiter%'
  ) then
    raise exception 'Permanent candidate deletion requires owner-scoped and approved-recruiter RLS policies on candidates and comparison_candidates';
  end if;
end;
$$;

create or replace function public.delete_candidate_and_data(p_candidate_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    return false;
  end if;

  -- Return without modifying related data if this candidate is not visible to the caller.
  if not exists (
    select 1
    from public.candidates as candidate
    where candidate.id = p_candidate_id
      and candidate.owner_id = (select auth.uid())
  ) then
    return false;
  end if;

  -- Break the restrictive comparison -> evaluation reference before candidate/evaluation
  -- cascades run. The comparison itself remains, with this candidate removed from it.
  delete from public.comparison_candidates as comparison_candidate
  where comparison_candidate.candidate_id = p_candidate_id
    and comparison_candidate.owner_id = (select auth.uid());

  delete from public.candidates as candidate
  where candidate.id = p_candidate_id
    and candidate.owner_id = (select auth.uid());

  return found;
end;
$function$;

revoke all on function public.delete_candidate_and_data(uuid) from public, anon;
grant execute on function public.delete_candidate_and_data(uuid) to authenticated;

comment on function public.delete_candidate_and_data(uuid) is
  'Permanently deletes an authenticated owner’s candidate, evidence, evaluations, and comparison membership. RLS and recruiter approval policies apply.';

commit;
