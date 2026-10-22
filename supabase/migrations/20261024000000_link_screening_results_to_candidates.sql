-- Recruiters may explicitly associate one completed resume result with one
-- candidate. Ownership is part of the foreign key; names/emails are never joined.
begin;

alter table public.resume_screenings
  add column if not exists candidate_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.resume_screenings'::regclass and conname = 'resume_screenings_candidate_owner_fkey') then
    alter table public.resume_screenings
      add constraint resume_screenings_candidate_owner_fkey
      foreign key (candidate_id, owner_id)
      references public.candidates(id, owner_id)
      on delete set null (candidate_id);
  end if;
end;
$$;

create unique index if not exists resume_screenings_one_candidate_link_idx
  on public.resume_screenings(owner_id, candidate_id)
  where candidate_id is not null;

comment on column public.resume_screenings.candidate_id is
  'Optional recruiter-selected association to an owned candidate; never inferred from resume names or email addresses.';

commit;
