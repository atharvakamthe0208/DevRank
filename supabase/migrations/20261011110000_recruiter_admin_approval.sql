-- Secure admin review for recruiter applications. The first admin is provisioned only by
-- a trusted project owner using the SQL procedure documented in docs/authentication.md.
begin;

create or replace function public.is_dev_rank_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join auth.users as account on account.id = profile.id
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
      and profile.approval_status = 'approved'
      and account.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_dev_rank_admin() from public, anon, authenticated;

create or replace function public.list_recruiter_applications(p_status text default null)
returns table (
  user_id uuid,
  email text,
  display_name text,
  registered_at timestamptz,
  approval_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.is_dev_rank_admin()) then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Invalid recruiter status filter';
  end if;
  return query
    select profile.id, account.email::text, profile.display_name, account.created_at, profile.approval_status
    from public.profiles as profile
    join auth.users as account on account.id = profile.id
    where profile.role = 'recruiter'
      and profile.approval_status in ('pending', 'approved', 'rejected')
      and (p_status is null or profile.approval_status = p_status)
    order by case when profile.approval_status = 'pending' then 0 else 1 end, account.created_at desc;
end;
$$;
revoke all on function public.list_recruiter_applications(text) from public, anon, authenticated;
grant execute on function public.list_recruiter_applications(text) to authenticated;

create or replace function public.decide_recruiter_application(p_user_id uuid, p_decision text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_name text;
begin
  if (select auth.uid()) is null or not (select public.is_dev_rank_admin()) then
    raise exception using errcode = '42501', message = 'Administrator access is required';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception using errcode = '42501', message = 'Administrators cannot decide their own access';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'Invalid recruiter decision';
  end if;

  update public.profiles
  set approval_status = p_decision
  where id = p_user_id and role = 'recruiter' and approval_status = 'pending'
  returning display_name into changed_name;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pending recruiter application not found';
  end if;

  insert into public.audit_logs (owner_id, action, entity_type, entity_id, metadata)
  values (
    (select auth.uid()),
    case when p_decision = 'approved' then 'recruiter_approved' else 'recruiter_rejected' end,
    'recruiter',
    p_user_id,
    jsonb_build_object('approval_status', p_decision, 'display_name', changed_name)
  );
  return true;
end;
$$;
revoke all on function public.decide_recruiter_application(uuid, text) from public, anon, authenticated;
grant execute on function public.decide_recruiter_application(uuid, text) to authenticated;

comment on function public.list_recruiter_applications(text) is 'Lists recruiter applications only for an approved, confirmed DevRank admin.';
comment on function public.decide_recruiter_application(uuid, text) is 'Approves or rejects a pending recruiter application and records an audit event.';

commit;
