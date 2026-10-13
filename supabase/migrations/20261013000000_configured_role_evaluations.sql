begin;

-- Configured-role evaluations snapshot the role ID and weights directly. Owner-defined
-- role-profile evaluations continue to use the existing composite foreign key.
alter table public.evaluations
  alter column role_profile_id drop not null,
  add column target_role text check (target_role is null or target_role in ('software_developer', 'ai_ml_engineer', 'data_analyst'));

comment on column public.evaluations.target_role is 'Supported role identifier captured for deterministic configured-role evaluations.';

commit;
