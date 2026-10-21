-- A separately persisted, text-derived match estimate. It never replaces the
-- structured AI-evaluated score stored in resume_screenings.evaluation.
begin;

alter table public.resume_screenings
  add column if not exists preliminary_evaluation jsonb
  check (preliminary_evaluation is null or jsonb_typeof(preliminary_evaluation) = 'object');

comment on column public.resume_screenings.preliminary_evaluation is
  'Deterministic preliminary document match and evidence coverage; not a validated candidate evaluation.';

commit;
