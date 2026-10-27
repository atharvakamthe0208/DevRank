-- Persist compact, owner-scoped import outcomes so retries of a confirmed batch
-- return the same result instead of inserting its candidates again.
begin;

create table public.candidate_import_batches (
  owner_id uuid not null references auth.users (id) on delete cascade,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{32}$'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  primary key (owner_id, idempotency_key)
);

alter table public.candidate_import_batches enable row level security;
create policy candidate_import_batches_owner_scope
  on public.candidate_import_batches as permissive for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy candidate_import_batches_approval_gate
  on public.candidate_import_batches as restrictive for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()))
  with check (owner_id = (select auth.uid()) and (select public.is_approved_recruiter()));
revoke all on public.candidate_import_batches from public, anon, authenticated;

create or replace function public.candidate_bulk_import(
  p_rows jsonb,
  p_idempotency_key uuid,
  p_skip_duplicates boolean,
  p_preview boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid := (select auth.uid());
  v_digest text;
  v_prior_digest text;
  v_saved_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_candidate jsonb;
  v_row_number integer;
  v_name text;
  v_email text;
  v_github text;
  v_leetcode text;
  v_identity_keys text[];
  v_identity_key text;
  v_seen_keys jsonb := '{}'::jsonb;
  v_duplicate_id uuid;
  v_existing_duplicate_id uuid;
  v_candidate_id uuid;
  v_duplicate boolean;
  v_row_result jsonb;
  v_created integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  if v_owner is null
    or not exists (
      select 1 from auth.users as account
      where account.id = v_owner and account.email_confirmed_at is not null
    )
    or not (select public.is_approved_recruiter()) then
    raise exception using errcode = '42501', message = 'approved recruiter required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'invalid import row count';
  end if;
  if p_skip_duplicates is null or p_preview is null or (not p_preview and p_idempotency_key is null) then
    raise exception using errcode = '22023', message = 'invalid import options';
  end if;

  -- The payload fingerprint is only an idempotency consistency check, not an
  -- authorization credential. The primary key and RLS scope it to auth.uid().
  v_digest := pg_catalog.md5(p_rows::text || '|' || p_skip_duplicates::text);
  if not p_preview then
    insert into public.candidate_import_batches (owner_id, idempotency_key, request_digest, result)
    values (v_owner, p_idempotency_key, v_digest, '{"pending":true}'::jsonb)
    on conflict (owner_id, idempotency_key) do nothing;

    select batch.request_digest, batch.result
      into v_prior_digest, v_saved_result
      from public.candidate_import_batches as batch
      where batch.owner_id = v_owner and batch.idempotency_key = p_idempotency_key
      for update;
    if v_prior_digest <> v_digest then
      raise exception using errcode = '22023', message = 'idempotency key reused with a different request';
    end if;
    if v_saved_result <> '{"pending":true}'::jsonb then
      return v_saved_result;
    end if;
  end if;

  for v_row in select value from pg_catalog.jsonb_array_elements(p_rows) as rows(value)
  loop
    v_row_number := null;
    v_candidate := null;
    v_name := null;
    v_email := null;
    v_github := null;
    v_leetcode := null;
    v_identity_keys := array[]::text[];
    v_duplicate_id := null;
    v_duplicate := false;

    begin
      if jsonb_typeof(v_row) is distinct from 'object'
        or jsonb_typeof(v_row -> 'rowNumber') is distinct from 'number'
        or jsonb_typeof(v_row -> 'candidate') is distinct from 'object' then
        raise exception using errcode = '22023', message = 'invalid import row';
      end if;
      v_row_number := (v_row ->> 'rowNumber')::integer;
      v_candidate := v_row -> 'candidate';
      if v_row_number < 2 or v_row_number > 1000000
        or jsonb_typeof(v_candidate -> 'name') is distinct from 'string'
        or length(pg_catalog.btrim(v_candidate ->> 'name')) not between 1 and 120 then
        raise exception using errcode = '22023', message = 'invalid candidate name or row number';
      end if;

      v_name := pg_catalog.btrim(v_candidate ->> 'name');
      v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_candidate ->> 'email')), '');
      v_github := nullif(pg_catalog.lower(pg_catalog.btrim(v_candidate ->> 'githubUsername')), '');
      v_leetcode := nullif(pg_catalog.lower(pg_catalog.btrim(v_candidate ->> 'leetcodeUsername')), '');
      if (v_candidate ? 'email' and jsonb_typeof(v_candidate -> 'email') is distinct from 'string')
        or (v_candidate ? 'githubUsername' and jsonb_typeof(v_candidate -> 'githubUsername') is distinct from 'string')
        or (v_candidate ? 'leetcodeUsername' and jsonb_typeof(v_candidate -> 'leetcodeUsername') is distinct from 'string') then
        raise exception using errcode = '22023', message = 'invalid candidate field type';
      end if;
      if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
        raise exception using errcode = '22023', message = 'invalid email';
      end if;
      if v_github is not null and (length(v_github) > 100 or v_github !~ '^[a-z0-9_.-]+$') then
        raise exception using errcode = '22023', message = 'invalid GitHub username';
      end if;
      if v_leetcode is not null and (length(v_leetcode) > 100 or v_leetcode !~ '^[a-z0-9_.-]+$') then
        raise exception using errcode = '22023', message = 'invalid LeetCode username';
      end if;

      if v_email is not null then v_identity_keys := pg_catalog.array_append(v_identity_keys, 'email:' || v_email); end if;
      if v_github is not null then v_identity_keys := pg_catalog.array_append(v_identity_keys, 'github:' || v_github); end if;
      if v_leetcode is not null then v_identity_keys := pg_catalog.array_append(v_identity_keys, 'leetcode:' || v_leetcode); end if;

      -- Serialize bulk imports sharing any comparison key, then check the current
      -- owner-scoped rows. Names are deliberately not treated as unique.
      for v_identity_key in select pg_catalog.unnest(v_identity_keys) order by 1
      loop
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text || ':' || v_identity_key, 0));
        if v_seen_keys ? v_identity_key then
          v_duplicate := true;
          if jsonb_typeof(v_seen_keys -> v_identity_key) = 'string'
            and nullif(v_seen_keys ->> v_identity_key, '') is not null then
            v_duplicate_id := (v_seen_keys ->> v_identity_key)::uuid;
          end if;
        end if;
      end loop;

      select candidate.id into v_existing_duplicate_id
      from public.candidates as candidate
      where candidate.owner_id = v_owner and candidate.archived_at is null
        and ((v_email is not null and pg_catalog.lower(pg_catalog.btrim(candidate.email)) = v_email)
          or (v_github is not null and pg_catalog.lower(pg_catalog.btrim(candidate.github_username)) = v_github)
          or (v_leetcode is not null and pg_catalog.lower(pg_catalog.btrim(candidate.leetcode_username)) = v_leetcode))
      order by candidate.created_at, candidate.id
      limit 1;
      if found then v_duplicate := true; v_duplicate_id := v_existing_duplicate_id; end if;

      if p_preview then
        v_row_result := pg_catalog.jsonb_build_object(
          'rowNumber', v_row_number,
          'status', case when v_duplicate then 'duplicate' else 'ready' end,
          'potentialDuplicate', v_duplicate,
          'candidateId', v_duplicate_id
        );
      elsif v_duplicate and p_skip_duplicates then
        v_skipped := v_skipped + 1;
        v_row_result := pg_catalog.jsonb_build_object(
          'rowNumber', v_row_number, 'status', 'skipped', 'reason', 'potential_duplicate',
          'candidateId', v_duplicate_id
        );
      else
        insert into public.candidates (owner_id, full_name, email, github_username, leetcode_username)
        values (v_owner, v_name, v_email, v_github, v_leetcode)
        returning id into v_candidate_id;
        v_created := v_created + 1;
        v_duplicate_id := v_candidate_id;
        v_row_result := pg_catalog.jsonb_build_object(
          'rowNumber', v_row_number, 'status', 'created', 'candidateId', v_candidate_id
        );
      end if;

      -- For a duplicate within this CSV, retain the first row's candidate ID.
      foreach v_identity_key in array v_identity_keys
      loop
        if not (v_seen_keys ? v_identity_key) then
          v_seen_keys := v_seen_keys || pg_catalog.jsonb_build_object(v_identity_key, v_duplicate_id);
        end if;
      end loop;
      v_rows := v_rows || pg_catalog.jsonb_build_array(v_row_result);
    -- Report expected row-level validation/constraint failures independently,
    -- but let permission, schema, and connection errors abort the transaction.
    exception when sqlstate '22023'
      or check_violation
      or not_null_violation
      or foreign_key_violation
      or unique_violation
      or string_data_right_truncation then
      v_failed := v_failed + 1;
      v_rows := v_rows || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'rowNumber', coalesce(v_row_number, 0), 'status', 'failed', 'reason', 'candidate_not_created'
      ));
    end;
  end loop;

  v_saved_result := pg_catalog.jsonb_build_object(
    'results', v_rows,
    'createdCount', v_created,
    'skippedCount', v_skipped,
    'failedCount', v_failed
  );
  if not p_preview then
    update public.candidate_import_batches
      set result = v_saved_result
      where owner_id = v_owner and idempotency_key = p_idempotency_key;
  end if;
  return v_saved_result;
end;
$function$;

revoke all on function public.candidate_bulk_import(jsonb, uuid, boolean, boolean) from public, anon;
grant execute on function public.candidate_bulk_import(jsonb, uuid, boolean, boolean) to authenticated;
comment on table public.candidate_import_batches is
  'Owner-scoped idempotency receipts for candidate CSV imports; stores digests and row outcomes, not uploaded CSV content.';
comment on function public.candidate_bulk_import(jsonb, uuid, boolean, boolean) is
  'Privileged implementation with explicit authenticated, email-confirmed, approved-recruiter, and owner checks; previews or imports at most 500 validated candidate rows. Receipt table is inaccessible directly. Duplicate matching is a case-insensitive email/GitHub/LeetCode potential-match heuristic, not a uniqueness constraint.';

commit;
