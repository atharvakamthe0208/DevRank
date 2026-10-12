begin;

alter table public.evaluations
  drop constraint evaluations_status_check,
  add constraint evaluations_status_check check (status in ('pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed')),
  add column role_weights_snapshot jsonb check (role_weights_snapshot is null or jsonb_typeof(role_weights_snapshot) = 'object'),
  add column evaluation_result jsonb check (evaluation_result is null or jsonb_typeof(evaluation_result) = 'object');

comment on column public.evaluations.evaluation_result is 'Validated deterministic evaluation response snapshot; AI explanations cannot alter numerical scores.';
comment on column public.evaluations.role_weights_snapshot is 'Effective role weights captured at evaluation time for historical reproducibility.';

commit;
