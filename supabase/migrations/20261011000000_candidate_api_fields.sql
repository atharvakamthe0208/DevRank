-- Candidate API fields and archival support. Existing evaluations/evidence are kept
-- when a candidate is deleted through the API (soft delete via archived_at).
begin;

alter table public.candidates
  add column github_username text,
  add column leetcode_username text,
  add column hackerrank_username text,
  add column archived_at timestamptz,
  add constraint candidates_github_username_format check (
    github_username is null or github_username ~ '^[A-Za-z0-9_.-]{1,100}$'
  ),
  add constraint candidates_leetcode_username_format check (
    leetcode_username is null or leetcode_username ~ '^[A-Za-z0-9_.-]{1,100}$'
  ),
  add constraint candidates_hackerrank_username_format check (
    hackerrank_username is null or hackerrank_username ~ '^[A-Za-z0-9_.-]{1,100}$'
  );

create index candidates_owner_active_created_idx
  on public.candidates (owner_id, created_at desc, id asc)
  where archived_at is null;

comment on column public.candidates.archived_at is
  'Soft deletion timestamp. Candidate history remains available to related records and can be retained by policy.';

commit;
