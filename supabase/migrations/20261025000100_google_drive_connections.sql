-- Keep recruiter-authorized Google Drive refresh tokens encrypted by the API.
-- Clients cannot access this table; only the server service role may read/write it.
begin;

create table if not exists public.google_drive_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  token_iv text not null,
  token_auth_tag text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connections enable row level security;
revoke all on public.google_drive_connections from anon, authenticated;
grant select, insert, update, delete on public.google_drive_connections to service_role;

commit;
