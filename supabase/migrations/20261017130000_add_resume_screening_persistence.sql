-- Idempotent repair for the screening persistence objects used by the API.
-- The earlier screening migration is intentionally left untouched. These objects are
-- isolated from candidates, evaluations, evidence, and recruiter profile schemas.
begin;
create table if not exists public.screening_sessions (
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
alter table public.screening_sessions
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists owner_id uuid,
  add column if not exists job_title text,
  add column if not exists job_description text,
  add column if not exists normalized_requirements jsonb default '[]'::jsonb,
  add column if not exists rubric_version text default 'resume-job-match-1.0.0',
  add column if not exists status text default 'created',
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
create unique index if not exists screening_sessions_id_owner_id_key
  on public.screening_sessions(id, owner_id);
create index if not exists screening_sessions_owner_created_idx
  on public.screening_sessions(owner_id, created_at desc);
create table if not exists public.resume_screenings (
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
alter table public.resume_screenings
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists session_id uuid,
  add column if not exists owner_id uuid,
  add column if not exists storage_path text,
  add column if not exists original_filename text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists sha256 text,
  add column if not exists status text default 'queued',
  add column if not exists retry_count integer default 0,
  add column if not exists extracted_data jsonb,
  add column if not exists evaluation jsonb,
  add column if not exists safe_error_code text,
  add column if not exists safe_error_message text,
  add column if not exists processed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
create unique index if not exists resume_screenings_id_owner_id_key
  on public.resume_screenings(id, owner_id);
create unique index if not exists resume_screenings_storage_path_key
  on public.resume_screenings(storage_path);
create unique index if not exists resume_screenings_session_id_sha256_key
  on public.resume_screenings(session_id, sha256);
create index if not exists resume_screenings_session_status_idx
  on public.resume_screenings(session_id, status, created_at);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.screening_sessions'::regclass and conname = 'screening_sessions_owner_id_fkey') then
    alter table public.screening_sessions add constraint screening_sessions_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.screening_sessions'::regclass and conname = 'screening_sessions_job_title_check') then
    alter table public.screening_sessions add constraint screening_sessions_job_title_check check (length(trim(job_title)) between 1 and 200) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.screening_sessions'::regclass and conname = 'screening_sessions_job_description_check') then
    alter table public.screening_sessions add constraint screening_sessions_job_description_check check (length(trim(job_description)) between 50 and 30000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.screening_sessions'::regclass and conname = 'screening_sessions_normalized_requirements_check') then
    alter table public.screening_sessions add constraint screening_sessions_normalized_requirements_check check (jsonb_typeof(normalized_requirements) = 'array') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.screening_sessions'::regclass and conname = 'screening_sessions_status_check') then
    alter table public.screening_sessions add constraint screening_sessions_status_check check (status in ('created','processing','completed','partial','failed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_owner_id_fkey') then
    alter table public.resume_screenings add constraint resume_screenings_owner_id_fkey
      foreign key (owner_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_session_id_owner_id_fkey') then
    alter table public.resume_screenings add constraint resume_screenings_session_id_owner_id_fkey
      foreign key (session_id, owner_id) references public.screening_sessions(id, owner_id) on delete cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_original_filename_check') then
    alter table public.resume_screenings add constraint resume_screenings_original_filename_check check (length(original_filename) between 1 and 255) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_mime_type_check') then
    alter table public.resume_screenings add constraint resume_screenings_mime_type_check check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_file_size_check') then
    alter table public.resume_screenings add constraint resume_screenings_file_size_check check (file_size > 0 and file_size <= 10485760) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_sha256_check') then
    alter table public.resume_screenings add constraint resume_screenings_sha256_check check (sha256 ~ '^[a-f0-9]{64}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_status_check') then
    alter table public.resume_screenings add constraint resume_screenings_status_check check (status in ('uploaded','queued','processing','completed','failed')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_retry_count_check') then
    alter table public.resume_screenings add constraint resume_screenings_retry_count_check check (retry_count between 0 and 3) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_extracted_data_check') then
    alter table public.resume_screenings add constraint resume_screenings_extracted_data_check check (extracted_data is null or jsonb_typeof(extracted_data) = 'object') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_evaluation_check') then
    alter table public.resume_screenings add constraint resume_screenings_evaluation_check check (evaluation is null or jsonb_typeof(evaluation) = 'object') not valid;
  end if;
end;
$$;
alter table public.screening_sessions enable row level security;
alter table public.resume_screenings enable row level security;
revoke all on public.screening_sessions, public.resume_screenings from anon, public;
grant select, insert, update on public.screening_sessions, public.resume_screenings to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'screening_sessions' and policyname = 'screening_sessions_owner_scope') then
    create policy screening_sessions_owner_scope on public.screening_sessions for all to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()))
      with check (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'resume_screenings' and policyname = 'resume_screenings_owner_scope') then
    create policy resume_screenings_owner_scope on public.resume_screenings for all to authenticated
      using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()))
      with check (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));
  end if;
end;
$$;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-resumes', 'private-resumes', false, 10485760,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'private_resumes_owner_insert') then
    create policy private_resumes_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'private-resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (select 1 from public.screening_sessions s
          where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'private_resumes_owner_select') then
    create policy private_resumes_owner_select on storage.objects for select to authenticated
      using (bucket_id = 'private-resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (select 1 from public.screening_sessions s
          where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'private_resumes_owner_delete') then
    create policy private_resumes_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'private-resumes'
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and exists (select 1 from public.screening_sessions s
          where s.id::text = (storage.foldername(name))[2] and s.owner_id = (select auth.uid())));
  end if;
end;
$$;
commit;
