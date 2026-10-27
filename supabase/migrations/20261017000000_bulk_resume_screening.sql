-- Bulk screening data is separate from developer evaluations and never changes their scores.
begin;

create table public.screening_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_title text not null check (length(trim(job_title)) between 1 and 200),
  job_description text not null check (length(trim(job_description)) between 50 and 30000),
  normalized_requirements jsonb not null default '[]'::jsonb check (jsonb_typeof(normalized_requirements) = 'array'),
  rubric_version text not null default 'resume-job-match-1.0.0',
  status text not null default 'created' check (status in ('created','processing','completed','partial','failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index screening_sessions_owner_created_idx on public.screening_sessions(owner_id, created_at desc);

create table public.resume_screenings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null check (length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('uploaded','queued','processing','completed','failed')),
  retry_count integer not null default 0 check (retry_count between 0 and 3),
  extracted_data jsonb check (extracted_data is null or jsonb_typeof(extracted_data) = 'object'),
  evaluation jsonb check (evaluation is null or jsonb_typeof(evaluation) = 'object'),
  safe_error_code text,
  safe_error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (session_id, sha256),
  foreign key (session_id, owner_id) references public.screening_sessions(id, owner_id) on delete cascade
);
create index resume_screenings_session_status_idx on public.resume_screenings(session_id, status, created_at);

create table public.screening_jobs (
  id uuid primary key default gen_random_uuid(),
  resume_id uuid not null references public.resume_screenings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempt integer not null default 0 check (attempt between 0 and 3),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resume_id, attempt)
);
create index screening_jobs_claim_idx on public.screening_jobs(status, available_at) where status = 'queued';

alter table public.screening_sessions enable row level security;
alter table public.resume_screenings enable row level security;
alter table public.screening_jobs enable row level security;
revoke all on public.screening_sessions, public.resume_screenings, public.screening_jobs from anon, public;
grant select, insert, update, delete on public.screening_sessions, public.resume_screenings to authenticated;
-- Recruiter clients may observe queue state but cannot enqueue or claim work.
grant select on public.screening_jobs to authenticated;

create policy screening_sessions_owner_scope on public.screening_sessions for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()))
  with check (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));
create policy resume_screenings_owner_scope on public.resume_screenings for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()))
  with check (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));
create policy screening_jobs_owner_read on public.screening_jobs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));

-- PostgreSQL-backed queue claim. Worker calls this via a server-only service-role client;
-- row locking and leases recover jobs after worker crashes.
create or replace function public.claim_screening_jobs(p_limit integer default 2, p_lease_seconds integer default 300)
returns setof public.screening_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 5 or p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'Invalid worker claim bounds';
  end if;
  update public.screening_jobs
     set status = 'queued', lease_until = null, updated_at = now()
   where status = 'processing' and lease_until < now();
  return query
    with picked as (
      select job.id from public.screening_jobs as job
       where job.status = 'queued' and job.available_at <= now()
       order by job.available_at, job.created_at
       for update skip locked limit p_limit
    )
    update public.screening_jobs as job
       set status = 'processing', lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
      from picked where job.id = picked.id
    returning job.*;
end;
$$;
revoke all on function public.claim_screening_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_screening_jobs(integer, integer) to service_role;

-- Compare-and-set retry: concurrent requests cannot enqueue a second retry.
create or replace function public.retry_screening_job(p_resume_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.resume_screenings%rowtype;
  next_attempt integer;
begin
  select * into target from public.resume_screenings where id = p_resume_id for update;
  if not found or target.status <> 'failed' or target.retry_count >= 3 then
    return false;
  end if;
  next_attempt := target.retry_count + 1;
  update public.resume_screenings
     set status = 'queued', retry_count = next_attempt, safe_error_code = null,
         safe_error_message = null, updated_at = now()
   where id = p_resume_id;
  insert into public.screening_jobs (resume_id, owner_id, attempt, status)
  values (target.id, target.owner_id, next_attempt, 'queued')
  on conflict (resume_id, attempt) do nothing;
  return found;
end;
$$;
revoke all on function public.retry_screening_job(uuid) from public, anon, authenticated;
grant execute on function public.retry_screening_job(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-resumes', 'private-resumes', false, 10485760,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

create policy private_resumes_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'private-resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.screening_sessions s
      where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));
create policy private_resumes_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'private-resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.screening_sessions s
      where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));
create policy private_resumes_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'private-resumes'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.screening_sessions s
      where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));

comment on table public.screening_sessions is 'Private recruiter-owned resume screening sessions. Job-match scores are distinct from developer evaluations.';
comment on table public.resume_screenings is 'Per-file screening state and derived evaluation. Original file is stored in private-resumes.';
comment on table public.screening_jobs is 'Durable worker queue with bounded attempts and expiring leases.';
commit;
