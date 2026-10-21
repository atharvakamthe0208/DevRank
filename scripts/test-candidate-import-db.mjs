import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
const readMigration = async (name) => (await readFile(new URL(name, migrationUrl), 'utf8')).replace(/^\uFEFF/, '');
const userIds = {
  ownerOne: '00000000-0000-4000-8000-000000000001',
  ownerTwo: '00000000-0000-4000-8000-000000000002',
  pending: '00000000-0000-4000-8000-000000000003',
  unconfirmed: '00000000-0000-4000-8000-000000000004',
};
const database = new PGlite();

try {
  await database.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, created_at timestamptz not null default now(),
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  `);

  // PGlite ships PostgreSQL's SHA-256 primitive but not the pgcrypto extension
  // package. This shim exposes the same digest(bytea, text) call used by the
  // migration; local Supabase integration tests exercise the actual extension.
  await database.exec(`
    create schema extensions;
    create function extensions.digest(data bytea, algorithm text) returns bytea
      language sql immutable strict set search_path = ''
      as $$ select case when algorithm = 'sha256' then pg_catalog.sha256(data) else null end $$;
  `);

  for (const migration of [
    '20261010000000_initial_devrank_schema.sql',
    '20261011000000_candidate_api_fields.sql',
    '20261011100000_recruiter_auth.sql',
    '20261011110000_recruiter_admin_approval.sql',
    '20261020211405_candidate_bulk_import_idempotency.sql',
    '20261021093336_candidate_bulk_import_sha256_digest.sql',
  ]) {
    let source = await readMigration(migration);
    if (migration === '20261021093336_candidate_bulk_import_sha256_digest.sql') {
      // CREATE EXTENSION is validated against a disposable real Supabase stack;
      // PGlite uses the digest shim above instead.
      source = source.replace('create extension if not exists pgcrypto with schema extensions;\n', '');
    }
    await database.exec(source);
  }

  await database.query(`
    insert into auth.users (id, email, email_confirmed_at) values
      ($1, 'one@example.invalid', now()), ($2, 'two@example.invalid', now()),
      ($3, 'pending@example.invalid', now()), ($4, 'unconfirmed@example.invalid', null)
  `, [userIds.ownerOne, userIds.ownerTwo, userIds.pending, userIds.unconfirmed]);
  await database.query("update public.profiles set approval_status = 'approved' where id in ($1, $2, $3)", [userIds.ownerOne, userIds.ownerTwo, userIds.unconfirmed]);
  await database.query(`
    insert into public.candidates (owner_id, full_name, email, github_username)
    values ($1, 'Existing Person', 'known@example.invalid', 'known-github')
  `, [userIds.ownerOne]);
  // A fixture-only database constraint forces a genuine insert failure for one row.
  await database.exec(`alter table public.candidates add constraint candidate_import_test_reject_email check (email is null or email <> 'blocked@example.invalid')`);

  async function asUser(userId, run) {
    await database.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
    try { return await run(); }
    finally { await database.exec('reset role; reset request.jwt.claim.sub;'); }
  }

  await assert.rejects(asUser(userIds.ownerOne, () => database.query(
    'select * from public.candidate_import_batches',
  )), /permission denied/i, 'the receipt table must not be directly readable through the client role');
  await assert.rejects(asUser(userIds.ownerOne, () => database.query(
    `insert into public.candidate_import_batches (owner_id, idempotency_key, request_digest, result) values ($1, $2, $3, '{}'::jsonb)`,
    [userIds.ownerOne, '55555555-5555-4555-8555-555555555555', '0'.repeat(32)],
  )), /permission denied/i, 'clients must not forge idempotency receipts');
  await assert.rejects(asUser(userIds.ownerOne, () => database.query(
    `update public.candidate_import_batches set result = '{"pending":true}'::jsonb`,
  )), /permission denied/i, 'clients must not reset receipts and make a retry create duplicates');

  const initialRows = [
    { rowNumber: 2, candidate: { name: 'Existing Person renamed', email: 'KNOWN@example.invalid' } },
    { rowNumber: 3, candidate: { name: 'New Candidate', email: 'new@example.invalid', githubUsername: 'new-github', leetcodeUsername: 'new-lc' } },
    { rowNumber: 4, candidate: { name: 'Same Person, different label', email: 'new@example.invalid' } },
  ];
  const preview = await asUser(userIds.ownerOne, async () => {
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, null, true, true) as result`, [JSON.stringify(initialRows)]);
    return result.rows[0].result;
  });
  assert.deepEqual(Object.keys(preview).sort(), ['createdCount', 'failedCount', 'results', 'skippedCount'], 'preview RPC uses the same result envelope as the import RPC');
  assert.deepEqual(Object.keys(preview.results[0]).sort(), ['candidateId', 'potentialDuplicate', 'rowNumber', 'status'], 'preview rows contain only the documented preview fields');
  assert.deepEqual(preview.results.map((row) => row.status), ['duplicate', 'ready', 'duplicate']);
  assert.equal(preview.createdCount, 0);
  assert.equal(preview.skippedCount, 0);

  const importKey = '11111111-1111-4111-8111-111111111111';
  const imported = await asUser(userIds.ownerOne, async () => {
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false) as result`, [JSON.stringify(initialRows), importKey]);
    return result.rows[0].result;
  });
  assert.deepEqual(imported.results.map((row) => row.status), ['skipped', 'created', 'skipped']);
  assert.equal(imported.createdCount, 1);
  assert.equal(imported.skippedCount, 2);
  const countAfterFirstImport = await database.query('select count(*)::int as count from public.candidates where owner_id = $1', [userIds.ownerOne]);
  assert.equal(countAfterFirstImport.rows[0].count, 2);

  const retried = await asUser(userIds.ownerOne, async () => {
    const equivalentRows = initialRows.map(({ rowNumber, candidate }) => ({
      candidate: Object.fromEntries(Object.entries(candidate).reverse()),
      rowNumber,
    }));
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false) as result`, [JSON.stringify(equivalentRows), importKey]);
    return result.rows[0].result;
  });
  assert.deepEqual(retried, imported, 'same key and payload must return the saved outcome');
  const receipt = await database.query(
    'select request_digest_version, request_digest from public.candidate_import_batches where owner_id = $1 and idempotency_key = $2',
    [userIds.ownerOne, importKey],
  );
  assert.equal(receipt.rows[0].request_digest_version, 2, 'new receipts must record SHA-256 version 2');
  assert.match(receipt.rows[0].request_digest, /^[a-f0-9]{64}$/, 'new receipts must store a 64-character SHA-256 digest');
  const countAfterRetry = await database.query('select count(*)::int as count from public.candidates where owner_id = $1', [userIds.ownerOne]);
  assert.equal(countAfterRetry.rows[0].count, 2, 'retry must not insert another candidate');
  const existingCandidate = await database.query('select full_name from public.candidates where owner_id = $1 and email = $2', [userIds.ownerOne, 'known@example.invalid']);
  assert.equal(existingCandidate.rows[0].full_name, 'Existing Person', 'potential duplicate handling must never overwrite the existing record');

  const explicitDuplicateImport = await asUser(userIds.ownerOne, async () => {
    const rows = [{ rowNumber: 2, candidate: { name: 'Explicitly Imported Match', email: 'known@example.invalid' } }];
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, $2::uuid, false, false) as result`, [JSON.stringify(rows), '55555555-5555-4555-8555-555555555555']);
    return result.rows[0].result;
  });
  assert.equal(explicitDuplicateImport.createdCount, 1, 'the opt-in duplicate policy creates a new row rather than overwriting the match');
  const existingStillUnchanged = await database.query('select full_name from public.candidates where owner_id = $1 and email = $2 order by created_at, id limit 1', [userIds.ownerOne, 'known@example.invalid']);
  assert.equal(existingStillUnchanged.rows[0].full_name, 'Existing Person');

  await assert.rejects(asUser(userIds.ownerOne, async () => database.query(
    `select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false)`,
    [JSON.stringify([{ rowNumber: 2, candidate: { name: 'Different payload', email: 'different@example.invalid' } }]), importKey],
  )), (error) => error.code === '22023');
  await assert.rejects(asUser(userIds.ownerOne, async () => database.query(
    `select public.candidate_bulk_import($1::jsonb, $2::uuid, false, false)`,
    [JSON.stringify(initialRows), importKey],
  )), (error) => error.code === '22023', 'duplicate-handling options are part of the request digest');

  // A pre-upgrade receipt has an MD5 digest and uses the default legacy version.
  // It remains replayable with the old canonical input but cannot accept edits.
  const legacyKey = '77777777-7777-4777-8777-777777777777';
  const legacyRows = [{ rowNumber: 2, candidate: { name: 'Legacy Receipt Candidate' } }];
  const legacyCandidate = await database.query(
    `insert into public.candidates (owner_id, full_name) values ($1, 'Legacy Receipt Candidate') returning id`,
    [userIds.ownerOne],
  );
  const legacyResult = {
    results: [{ rowNumber: 2, status: 'created', candidateId: legacyCandidate.rows[0].id }],
    createdCount: 1,
    skippedCount: 0,
    failedCount: 0,
  };
  const legacyDigest = await database.query(
    `select md5($1::jsonb::text || '|' || 'true') as digest`,
    [JSON.stringify(legacyRows)],
  );
  await database.query(
    `insert into public.candidate_import_batches (owner_id, idempotency_key, request_digest, result) values ($1, $2, $3, $4::jsonb)`,
    [userIds.ownerOne, legacyKey, legacyDigest.rows[0].digest, JSON.stringify(legacyResult)],
  );
  const legacyReplay = await asUser(userIds.ownerOne, async () => {
    const result = await database.query(
      `select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false) as result`,
      [JSON.stringify(legacyRows), legacyKey],
    );
    return result.rows[0].result;
  });
  assert.deepEqual(legacyReplay, legacyResult, 'legacy MD5 receipts must replay their stored outcome');
  await assert.rejects(asUser(userIds.ownerOne, async () => database.query(
    `select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false)`,
    [JSON.stringify([{ rowNumber: 2, candidate: { name: 'Changed Legacy Payload' } }]), legacyKey],
  )), (error) => error.code === '22023', 'legacy receipts must still reject changed payloads');
  await assert.rejects(asUser(userIds.ownerOne, () => database.query(
    `select public.candidate_bulk_import(null, $1::uuid, true, false)`, [importKey],
  )), (error) => error.code === '22023', 'the RPC must reject a null row payload even when called outside the API schema');

  const secondOwnerResult = await asUser(userIds.ownerTwo, async () => {
    const rows = [{ rowNumber: 2, candidate: { name: 'Independent Owner Candidate', email: 'known@example.invalid' } }];
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false) as result`, [JSON.stringify(rows), importKey]);
    return result.rows[0].result;
  });
  assert.equal(secondOwnerResult.createdCount, 1, 'another owner’s matching email must not be visible or treated as a duplicate');
  const ownerTwoCount = await database.query('select count(*)::int as count from public.candidates where owner_id = $1', [userIds.ownerTwo]);
  assert.equal(ownerTwoCount.rows[0].count, 1);
  const otherOwnerCandidates = await asUser(userIds.ownerOne, async () => database.query('select id from public.candidates where owner_id = $1', [userIds.ownerTwo]));
  assert.equal(otherOwnerCandidates.rows.length, 0, 'RLS must isolate candidate rows');

  const partialRows = [
    { rowNumber: 2, candidate: { name: 'Surviving Row', email: 'survive@example.invalid' } },
    { rowNumber: 3, candidate: { name: 'Constraint Failure', email: 'blocked@example.invalid' } },
  ];
  const partialResult = await asUser(userIds.ownerOne, async () => {
    const result = await database.query(`select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false) as result`, [JSON.stringify(partialRows), '33333333-3333-4333-8333-333333333333']);
    return result.rows[0].result;
  });
  assert.deepEqual(partialResult.results.map((row) => row.status), ['created', 'failed']);
  assert.equal(partialResult.createdCount, 1);
  assert.equal(partialResult.failedCount, 1);

  await assert.rejects(asUser(userIds.pending, async () => database.query(
    `select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false)`,
    [JSON.stringify([{ rowNumber: 2, candidate: { name: 'Blocked' } }]), '44444444-4444-4444-8444-444444444444'],
  )), (error) => error.code === '42501');
  await assert.rejects(asUser(userIds.unconfirmed, async () => database.query(
    `select public.candidate_bulk_import($1::jsonb, $2::uuid, true, false)`,
    [JSON.stringify([{ rowNumber: 2, candidate: { name: 'Unconfirmed' } }]), '66666666-6666-4666-8666-666666666666'],
  )), (error) => error.code === '42501', 'the SECURITY DEFINER RPC must enforce email confirmation itself');

  console.log('Candidate CSV import database migration tests passed (isolated PGlite).');
} finally {
  await database.close();
}
