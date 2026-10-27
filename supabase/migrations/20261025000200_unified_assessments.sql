-- Immutable, owner-scoped unified assessment snapshots. Source evaluations remain unchanged.
begin;

create table if not exists public.unified_assessments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  candidate_id uuid not null,
  role_id text not null check (role_id in ('software_developer','ai_ml_engineer','data_analyst')),
  platform_evaluation_id uuid,
  resume_screening_id uuid,
  source_fingerprint text not null check (source_fingerprint ~ '^[a-f0-9]{64}$'),
  scoring_version text not null check (scoring_version = 'unified-1.0.0'),
  overall_score numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  status text not null check (status in ('completed','insufficient_evidence')),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, candidate_id, role_id, source_fingerprint),
  foreign key (candidate_id, owner_id) references public.candidates(id, owner_id) on delete cascade,
  foreign key (platform_evaluation_id, owner_id) references public.evaluations(id, owner_id) on delete set null (platform_evaluation_id),
  foreign key (resume_screening_id, owner_id) references public.resume_screenings(id, owner_id) on delete set null (resume_screening_id)
);

create index if not exists unified_assessments_owner_role_created_idx
  on public.unified_assessments(owner_id, role_id, created_at desc);
create index if not exists unified_assessments_owner_candidate_role_idx
  on public.unified_assessments(owner_id, candidate_id, role_id, created_at desc);

alter table public.unified_assessments enable row level security;
revoke all on public.unified_assessments from anon, public;
grant select, insert on public.unified_assessments to authenticated;

drop policy if exists unified_assessments_select_own on public.unified_assessments;
create policy unified_assessments_select_own on public.unified_assessments
  for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists unified_assessments_insert_own on public.unified_assessments;
create policy unified_assessments_insert_own on public.unified_assessments
  for insert to authenticated with check (owner_id = (select auth.uid()));

comment on table public.unified_assessments is
  'Immutable role-specific combined candidate evidence assessment. Result JSON snapshots all component values and source references.';
comment on column public.unified_assessments.source_fingerprint is
  'SHA-256 of role and immutable source IDs/results; unique per owner, candidate, role, and source set for idempotent generation.';

commit;
