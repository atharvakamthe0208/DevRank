begin;

-- Explicitly replace a candidate's linked resume only after another saved result
-- has completed. The former result remains stored and becomes available to link again.
create or replace function public.replace_candidate_resume_result(p_candidate_id uuid, p_resume_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_resume_id uuid;
  replacement_status text;
  replacement_candidate_id uuid;
begin
  if auth.uid() is null then
    return false;
  end if;

  perform 1
  from public.candidates
  where id = p_candidate_id and owner_id = auth.uid() and archived_at is null
  for update;
  if not found then
    return false;
  end if;

  select id into previous_resume_id
  from public.resume_screenings
  where owner_id = auth.uid() and candidate_id = p_candidate_id
  order by created_at desc
  limit 1
  for update;
  if previous_resume_id is null or previous_resume_id = p_resume_id then
    return false;
  end if;

  select status, candidate_id into replacement_status, replacement_candidate_id
  from public.resume_screenings
  where id = p_resume_id and owner_id = auth.uid()
  for update;
  if not found or replacement_status <> 'completed' or replacement_candidate_id is not null then
    return false;
  end if;

  -- A completed row may still contain a provisional or malformed score. Only
  -- swap in a score produced and persisted as a validated resume evaluation.
  if not exists (
    select 1
    from public.resume_screenings
    where id = p_resume_id
      and owner_id = auth.uid()
      and evaluation->>'rubricVersion' = 'resume-job-match-1.0.0'
      and evaluation->>'scoreType' = 'resume_job_match'
      and evaluation->>'status' = 'complete'
      and case
        when jsonb_typeof(evaluation->'score') = 'number'
          then (evaluation->>'score')::numeric between 0 and 100
        else false
      end
  ) then
    return false;
  end if;

  update public.resume_screenings
  set candidate_id = null, updated_at = now()
  where id = previous_resume_id and owner_id = auth.uid() and candidate_id = p_candidate_id;
  if not found then
    return false;
  end if;

  update public.resume_screenings
  set candidate_id = p_candidate_id, updated_at = now()
  where id = p_resume_id and owner_id = auth.uid() and status = 'completed' and candidate_id is null;
  if not found then
    raise exception 'Resume result changed during replacement' using errcode = '40001';
  end if;

  return true;
end;
$$;

revoke all on function public.replace_candidate_resume_result(uuid, uuid) from public, anon;
grant execute on function public.replace_candidate_resume_result(uuid, uuid) to authenticated;

commit;
