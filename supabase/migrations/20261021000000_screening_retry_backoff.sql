-- Space transient resume retries to avoid exhausting the bounded attempt count
-- during a short Groq rate-limit window. Attempts remain idempotent per resume.
begin;

create or replace function public.retry_screening_job(p_resume_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.resume_screenings%rowtype;
  next_attempt integer;
  delay_seconds integer;
begin
  select * into target from public.resume_screenings where id = p_resume_id for update;
  if not found or target.status <> 'failed' or target.retry_count >= 3 then
    return false;
  end if;
  next_attempt := target.retry_count + 1;
  delay_seconds := case next_attempt when 1 then 5 when 2 then 20 else 60 end;
  update public.resume_screenings
     set status = 'queued', retry_count = next_attempt, safe_error_code = null,
         safe_error_message = null, updated_at = now()
   where id = p_resume_id;
  insert into public.screening_jobs (resume_id, owner_id, attempt, status, available_at)
  values (target.id, target.owner_id, next_attempt, 'queued', now() + make_interval(secs => delay_seconds))
  on conflict (resume_id, attempt) do nothing;
  return found;
end;
$$;

revoke all on function public.retry_screening_job(uuid) from public, anon, authenticated;
grant execute on function public.retry_screening_job(uuid) to service_role;

commit;
