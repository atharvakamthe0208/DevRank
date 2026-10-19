-- Supabase Auth profiles for the recruiter workspace.
-- This migration is additive: no user, candidate, or evaluation rows are deleted.
begin;
alter table public.profiles
  add column if not exists role text not null default 'recruiter',
  add column if not exists approval_status text not null default 'pending';
update public.profiles set role = 'recruiter' where role is null;
update public.profiles set approval_status = 'pending' where approval_status is null;
alter table public.profiles alter column role set default 'recruiter', alter column role set not null;
alter table public.profiles alter column approval_status set default 'pending', alter column approval_status set not null;
-- Remove prior checks on these two fields (including dashboard-created constraint names),
-- then constrain the allowed states explicitly. Invalid legacy values abort this transaction.
do $$
declare
  existing_check record;
  definition text;
begin
  for existing_check in
    select constraint_row.conname, pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.profiles'::regclass
      and constraint_row.contype = 'c'
  loop
    definition := lower(existing_check.definition);
    if definition like '%role%' or definition like '%approval_status%' then
      execute pg_catalog.format('alter table public.profiles drop constraint %I', existing_check.conname);
    end if;
  end loop;
end;
$$;
alter table public.profiles
  add constraint profiles_role_check check (role in ('recruiter', 'admin')),
  add constraint profiles_approval_status_check check (approval_status in ('pending', 'approved', 'rejected', 'suspended'));
-- Any profile created from signup metadata is always recruiter/pending. The display name is
-- the only signup metadata copied into the public profile.
create or replace function public.enforce_recruiter_signup_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.role := 'recruiter';
  new.approval_status := 'pending';
  return new;
end;
$$;
revoke all on function public.enforce_recruiter_signup_defaults() from public, anon, authenticated;
drop trigger if exists enforce_recruiter_signup_defaults on public.profiles;
create trigger enforce_recruiter_signup_defaults
  before insert on public.profiles
  for each row execute function public.enforce_recruiter_signup_defaults();
create or replace function public.handle_new_recruiter_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role, approval_status)
  values (
    new.id,
    nullif(pg_catalog.btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    'recruiter',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_recruiter_profile() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_recruiter_profile on auth.users;
create trigger on_auth_user_created_recruiter_profile
  after insert on auth.users
  for each row execute function public.handle_new_recruiter_profile();
-- This invoker function can inspect only the caller's profile through profiles_select_own.
create or replace function public.is_approved_recruiter()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'recruiter'
      and profile.approval_status = 'approved'
  );
$$;
revoke all on function public.is_approved_recruiter() from public, anon;
grant execute on function public.is_approved_recruiter() to authenticated;
-- Role and approval columns are never writable by an authenticated client.
revoke all on public.profiles from anon;
revoke insert, update on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
-- Add owner-scoped permissive policies plus restrictive approval gates. Restrictive policies
-- AND with every permissive policy, so custom or legacy policies cannot bypass approval. This
-- preserves existing policy definitions while safely tightening access.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'profiles', 'candidates', 'platform_evidence', 'role_profiles', 'evaluations',
    'category_scores', 'ai_analyses', 'comparisons', 'comparison_candidates', 'audit_logs'
  ] loop
    execute pg_catalog.format('alter table public.%I enable row level security', target_table);
    execute pg_catalog.format('revoke all on public.%I from anon, public', target_table);
  end loop;
end;
$$;
create policy devrank_auth_profiles_owner_scope on public.profiles as permissive for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy devrank_auth_profiles_restrict_to_owner on public.profiles as restrictive for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
do $$
declare
  target_table text;
  approval_check text := 'owner_id = (select auth.uid()) and (select public.is_approved_recruiter())';
begin
  foreach target_table in array array[
    'candidates', 'platform_evidence', 'role_profiles', 'evaluations', 'category_scores',
    'ai_analyses', 'comparisons', 'comparison_candidates', 'audit_logs'
  ] loop
    execute pg_catalog.format(
      'create policy %I on public.%I as permissive for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',
      'devrank_auth_' || target_table || '_owner_scope', target_table
    );
    execute pg_catalog.format(
      'create policy %I on public.%I as restrictive for all to authenticated using (%s) with check (%s)',
      'devrank_auth_' || target_table || '_approval_gate', target_table, approval_check, approval_check
    );
  end loop;
end;
$$;
comment on column public.profiles.role is 'Signup always creates recruiters. Only trusted project owners may provision admin accounts.';
comment on column public.profiles.approval_status is 'Recruiter applications require administrator approval before workspace access.';
commit;
