-- Add optional recruiter contact and professional details to the existing self-owned profile row.
-- Identity, email, role, and approval status remain managed by Supabase Auth/admin workflows.
begin;
alter table public.profiles
  add column if not exists phone_number text,
  add column if not exists company_name text,
  add column if not exists job_title text,
  add column if not exists company_website text,
  add column if not exists location_city text,
  add column if not exists location_country text;

alter table public.profiles
  add constraint profiles_phone_number_format check (
    phone_number is null or (phone_number ~ '^\+?[0-9][0-9 () .-]{5,30}$' and length(regexp_replace(phone_number, '[^0-9]', '', 'g')) >= 7)
  ),
  add constraint profiles_company_website_https check (
    company_website is null or company_website ~ '^https://[^[:space:]]+$'
  ),
  add constraint profiles_company_name_length check (company_name is null or length(company_name) <= 150),
  add constraint profiles_job_title_length check (job_title is null or length(job_title) <= 150),
  add constraint profiles_location_city_length check (location_city is null or length(location_city) <= 100),
  add constraint profiles_location_country_length check (location_country is null or length(location_country) <= 100);

-- Retain the existing owner-scoped RLS policies; grant writes only to editable columns.
grant update (display_name, phone_number, company_name, job_title, company_website, location_city, location_country)
  on public.profiles to authenticated;
commit;
