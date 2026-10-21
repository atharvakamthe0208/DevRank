-- Idempotency keys prevent browser/network retries from creating duplicate screening sessions/jobs.
begin;

alter table public.screening_sessions
  add column if not exists idempotency_key uuid;

create unique index if not exists screening_sessions_owner_idempotency_key_key
  on public.screening_sessions(owner_id, idempotency_key)
  where idempotency_key is not null;

-- Unsupported MIME files are persisted as failed items so they do not discard valid siblings.
alter table public.resume_screenings
  drop constraint if exists resume_screenings_mime_type_check;
alter table public.resume_screenings
  add constraint resume_screenings_mime_type_check
  check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'));

-- A temp-file I/O failure still needs a durable failed row, but cannot have a content digest.
alter table public.resume_screenings alter column sha256 drop not null;
alter table public.resume_screenings drop constraint if exists resume_screenings_sha256_check;
alter table public.resume_screenings add constraint resume_screenings_sha256_check
  check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$');

-- The API worker uses a server-only service-role client. Grant the queue and
-- screening-row access it needs while keeping recruiter access owner-scoped.
grant select, insert, update, delete on public.screening_sessions to service_role;
grant select, insert, update, delete on public.resume_screenings to service_role;
grant select, insert, update, delete on public.screening_jobs to service_role;

commit;
