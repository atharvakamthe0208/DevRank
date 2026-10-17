-- DevRank's initial, owner-scoped MVP schema. This migration is prepared for review;
-- it has not been applied to any Supabase project.
begin;
-- Supabase Auth owns identities. This table stores only optional recruiter profile data.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index candidates_owner_created_idx on public.candidates (owner_id, created_at desc);
-- Evidence stays distinct from normalized evidence. Source-specific fields remain JSON
-- until the team verifies permitted fields for each provider; no scraping is implied.
create table public.platform_evidence (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null,
  owner_id uuid not null,
  source text not null check (source in ('github', 'leetcode', 'hackerrank', 'candidate_provided')),
  availability text not null check (availability in ('available', 'unavailable', 'not_provided', 'error')),
  raw_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_evidence) = 'object'),
  normalized_evidence jsonb check (normalized_evidence is null or jsonb_typeof(normalized_evidence) = 'object'),
  observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (candidate_id, owner_id) references public.candidates (id, owner_id) on delete cascade
);
create index platform_evidence_candidate_created_idx on public.platform_evidence (candidate_id, created_at desc);
-- Weights are data, not approved constants. No role or weight values are seeded here.
create table public.role_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  weights jsonb not null default '{}'::jsonb check (jsonb_typeof(weights) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index role_profiles_owner_name_idx on public.role_profiles (owner_id, name);
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid not null,
  role_profile_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'failed')),
  overall_score numeric(5, 2) check (overall_score is null or overall_score between 0 and 100),
  scoring_version text,
  evidence_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_snapshot) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, candidate_id, owner_id),
  foreign key (candidate_id, owner_id) references public.candidates (id, owner_id) on delete cascade,
  foreign key (role_profile_id, owner_id) references public.role_profiles (id, owner_id) on delete restrict
);
create index evaluations_owner_created_idx on public.evaluations (owner_id, created_at desc);
create index evaluations_candidate_created_idx on public.evaluations (candidate_id, created_at desc);
-- Category keys are intentionally not constrained to a final enum until scoring categories
-- are agreed in the shared contract. The score range is stable and database-enforced.
create table public.category_scores (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  owner_id uuid not null,
  category_key text not null check (length(trim(category_key)) > 0),
  score numeric(5, 2) not null check (score between 0 and 100),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  created_at timestamptz not null default now(),
  unique (evaluation_id, category_key),
  foreign key (evaluation_id, owner_id) references public.evaluations (id, owner_id) on delete cascade
);
create index category_scores_evaluation_idx on public.category_scores (evaluation_id);
-- AI output is stored separately from deterministic evaluation scores.
create table public.ai_analyses (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null,
  owner_id uuid not null,
  provider text not null,
  model text,
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  output jsonb check (output is null or jsonb_typeof(output) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (evaluation_id, owner_id) references public.evaluations (id, owner_id) on delete cascade
);
create index ai_analyses_evaluation_created_idx on public.ai_analyses (evaluation_id, created_at desc);
create table public.comparisons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text,
  role_profile_id uuid,
  scoring_version text,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (role_profile_id, owner_id) references public.role_profiles (id, owner_id) on delete restrict
);
create index comparisons_owner_created_idx on public.comparisons (owner_id, created_at desc);
create table public.comparison_candidates (
  comparison_id uuid not null,
  owner_id uuid not null,
  candidate_id uuid not null,
  evaluation_id uuid,
  position integer not null check (position > 0),
  created_at timestamptz not null default now(),
  primary key (comparison_id, candidate_id),
  unique (comparison_id, position),
  foreign key (comparison_id, owner_id) references public.comparisons (id, owner_id) on delete cascade,
  foreign key (candidate_id, owner_id) references public.candidates (id, owner_id) on delete cascade,
  foreign key (evaluation_id, candidate_id, owner_id) references public.evaluations (id, candidate_id, owner_id) on delete restrict
);
-- Minimal append-only audit metadata; payloads and candidate evidence are not copied here.
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (length(trim(action)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_owner_created_idx on public.audit_logs (owner_id, created_at desc);
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger candidates_set_updated_at before update on public.candidates
for each row execute function public.set_updated_at();
create trigger platform_evidence_set_updated_at before update on public.platform_evidence
for each row execute function public.set_updated_at();
create trigger role_profiles_set_updated_at before update on public.role_profiles
for each row execute function public.set_updated_at();
create trigger evaluations_set_updated_at before update on public.evaluations
for each row execute function public.set_updated_at();
-- Every user-facing table is protected by RLS. The API uses the public/anon key together
-- with the verified recruiter's JWT so these policies remain effective; no service key is needed.
alter table public.profiles enable row level security;
alter table public.candidates enable row level security;
alter table public.platform_evidence enable row level security;
alter table public.role_profiles enable row level security;
alter table public.evaluations enable row level security;
alter table public.category_scores enable row level security;
alter table public.ai_analyses enable row level security;
alter table public.comparisons enable row level security;
alter table public.comparison_candidates enable row level security;
alter table public.audit_logs enable row level security;
-- RLS controls row access; grants separately limit which operations each role can request.
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.candidates to authenticated;
grant select, insert, update, delete on public.platform_evidence to authenticated;
grant select, insert, update, delete on public.role_profiles to authenticated;
grant select, insert, update, delete on public.evaluations to authenticated;
grant select, insert, update, delete on public.category_scores to authenticated;
grant select, insert on public.ai_analyses to authenticated;
grant select, insert, update, delete on public.comparisons to authenticated;
grant select, insert, update, delete on public.comparison_candidates to authenticated;
grant select, insert on public.audit_logs to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy candidates_select_own on public.candidates for select to authenticated using (owner_id = (select auth.uid()));
create policy candidates_insert_own on public.candidates for insert to authenticated with check (owner_id = (select auth.uid()));
create policy candidates_update_own on public.candidates for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy candidates_delete_own on public.candidates for delete to authenticated using (owner_id = (select auth.uid()));
create policy platform_evidence_select_own on public.platform_evidence for select to authenticated using (owner_id = (select auth.uid()));
create policy platform_evidence_insert_own on public.platform_evidence for insert to authenticated with check (owner_id = (select auth.uid()));
create policy platform_evidence_update_own on public.platform_evidence for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy platform_evidence_delete_own on public.platform_evidence for delete to authenticated using (owner_id = (select auth.uid()));
create policy role_profiles_select_own on public.role_profiles for select to authenticated using (owner_id = (select auth.uid()));
create policy role_profiles_insert_own on public.role_profiles for insert to authenticated with check (owner_id = (select auth.uid()));
create policy role_profiles_update_own on public.role_profiles for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy role_profiles_delete_own on public.role_profiles for delete to authenticated using (owner_id = (select auth.uid()));
create policy evaluations_select_own on public.evaluations for select to authenticated using (owner_id = (select auth.uid()));
create policy evaluations_insert_own on public.evaluations for insert to authenticated with check (owner_id = (select auth.uid()));
create policy evaluations_update_own on public.evaluations for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy evaluations_delete_own on public.evaluations for delete to authenticated using (owner_id = (select auth.uid()));
create policy category_scores_select_own on public.category_scores for select to authenticated using (owner_id = (select auth.uid()));
create policy category_scores_insert_own on public.category_scores for insert to authenticated with check (owner_id = (select auth.uid()));
create policy category_scores_update_own on public.category_scores for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy category_scores_delete_own on public.category_scores for delete to authenticated using (owner_id = (select auth.uid()));
create policy ai_analyses_select_own on public.ai_analyses for select to authenticated using (owner_id = (select auth.uid()));
create policy ai_analyses_insert_own on public.ai_analyses for insert to authenticated with check (owner_id = (select auth.uid()));
create policy comparisons_select_own on public.comparisons for select to authenticated using (owner_id = (select auth.uid()));
create policy comparisons_insert_own on public.comparisons for insert to authenticated with check (owner_id = (select auth.uid()));
create policy comparisons_update_own on public.comparisons for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy comparisons_delete_own on public.comparisons for delete to authenticated using (owner_id = (select auth.uid()));
create policy comparison_candidates_select_own on public.comparison_candidates for select to authenticated using (owner_id = (select auth.uid()));
create policy comparison_candidates_insert_own on public.comparison_candidates for insert to authenticated with check (owner_id = (select auth.uid()));
create policy comparison_candidates_update_own on public.comparison_candidates for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy comparison_candidates_delete_own on public.comparison_candidates for delete to authenticated using (owner_id = (select auth.uid()));
create policy audit_logs_select_own on public.audit_logs for select to authenticated using (owner_id = (select auth.uid()));
create policy audit_logs_insert_own on public.audit_logs for insert to authenticated with check (owner_id = (select auth.uid()));
comment on table public.profiles is 'Optional recruiter profile data; Supabase Auth remains the identity source.';
comment on table public.candidates is 'Candidate records are private to the recruiter identified by owner_id.';
comment on table public.platform_evidence is 'Raw and normalized evidence are separate; only authorized or candidate-provided data is supported.';
comment on table public.role_profiles is 'Role weights are owner-defined JSON; no final scoring weights are seeded.';
comment on table public.category_scores is 'Category identifiers remain open until the shared scoring contract is agreed.';
comment on table public.ai_analyses is 'AI explanations are stored separately and cannot overwrite deterministic scores.';
comment on table public.audit_logs is 'Append-only through authenticated client policies; stores metadata, not evidence or secrets.';
commit;
