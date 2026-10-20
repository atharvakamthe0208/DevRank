import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/', import.meta.url);
const readMigration = async (name) => (await readFile(new URL(name, migrationPath), 'utf8')).replace(/^\uFEFF/, '');
const userIds = {
  admin: '00000000-0000-4000-8000-000000000001',
  pending: '00000000-0000-4000-8000-000000000002',
  targetApprove: '00000000-0000-4000-8000-000000000003',
  targetReject: '00000000-0000-4000-8000-000000000004',
  targetRace: '00000000-0000-4000-8000-000000000005',
  unconfirmedAdmin: '00000000-0000-4000-8000-000000000006',
  pendingAdmin: '00000000-0000-4000-8000-000000000007',
};
const candidateId = '10000000-0000-4000-8000-000000000001';
const timestampBaseline = '2000-01-01T00:00:00Z';

const bootstrapSql = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    email_confirmed_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

async function createDatabase() {
  const db = new PGlite();
  try {
    await db.exec(bootstrapSql);
    await db.exec(await readMigration('20261010000000_initial_devrank_schema.sql'));
    await db.exec(await readMigration('20261011000000_candidate_api_fields.sql'));

    // Model permissive policies installed before the recruiter-auth migration. The new
    // restrictive policies must still block an unapproved caller under these policies.
    await db.exec(`
      create policy legacy_candidates_read_any on public.candidates
        as permissive for select to authenticated using (true);
      create policy legacy_candidates_update_any on public.candidates
        as permissive for update to authenticated using (true) with check (true);
      create policy legacy_profiles_read_any on public.profiles
        as permissive for select to authenticated using (true);
    `);

    await db.exec(await readMigration('20261011100000_recruiter_auth.sql'));
    await db.exec(await readMigration('20261011110000_recruiter_admin_approval.sql'));

    const confirmedAt = '2026-10-20T00:00:00Z';
    await db.query(`
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
        ($1, 'admin@example.invalid', $2, '{"full_name":"Owner","role":"admin","approval_status":"approved"}'),
        ($3, 'pending@example.invalid', $2, '{"full_name":"Pending person","role":"admin","approval_status":"approved"}'),
        ($4, 'approve@example.invalid', $2, '{"full_name":"Approval target"}'),
        ($5, 'reject@example.invalid', $2, '{"full_name":"Rejection target"}'),
        ($6, 'race@example.invalid', $2, '{"full_name":"Concurrent target"}'),
        ($7, 'unconfirmed-admin@example.invalid', null, '{"full_name":"Unconfirmed admin"}'),
        ($8, 'pending-admin@example.invalid', $2, '{"full_name":"Pending admin"}')
    `, [userIds.admin, confirmedAt, userIds.pending, userIds.targetApprove, userIds.targetReject, userIds.targetRace, userIds.unconfirmedAdmin, userIds.pendingAdmin]);

    // Only the fixture owner provisions test admins; the public signup trigger remains fixed.
    await db.query(`update public.profiles set role = 'admin', approval_status = 'approved' where id = $1`, [userIds.admin]);
    await db.query(`update public.profiles set role = 'admin', approval_status = 'approved' where id = $1`, [userIds.unconfirmedAdmin]);
    await db.query(`update public.profiles set role = 'admin', approval_status = 'pending' where id = $1`, [userIds.pendingAdmin]);
    // Set a deterministic old timestamp in the isolated fixture so the decision's
    // updated_at trigger can be asserted without relying on wall-clock sleeps.
    await db.exec('alter table public.profiles disable trigger profiles_set_updated_at;');
    await db.query(`update public.profiles set updated_at = $2 where id in ($1, $3, $4)`, [userIds.targetApprove, timestampBaseline, userIds.targetReject, userIds.targetRace]);
    await db.exec('alter table public.profiles enable trigger profiles_set_updated_at;');

    await db.query(`insert into public.candidates (id, owner_id, full_name) values ($1, $2, 'Synthetic test candidate')`, [candidateId, userIds.pending]);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function asAuthenticated(db, userId, callback) {
  await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
  try {
    return await callback();
  } finally {
    await db.exec('reset role; reset request.jwt.claim.sub;');
  }
}

async function expectPgError(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code, `expected PostgreSQL error ${code}`);
}

async function testSignupProfileAndMetadata(db) {
  const profiles = await db.query(`select id, display_name, role, approval_status from public.profiles order by id`);
  assert.equal(profiles.rows.length, Object.keys(userIds).length, 'each Auth user gets exactly one profile');
  const attackerSignup = profiles.rows.find((row) => row.id === userIds.pending);
  assert.deepEqual(attackerSignup, {
    id: userIds.pending,
    display_name: 'Pending person',
    role: 'recruiter',
    approval_status: 'pending',
  }, 'user-controlled role/status metadata must be ignored');

  const grants = await db.query(`select
    has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE') as can_update_role,
    has_column_privilege('authenticated', 'public.profiles', 'approval_status', 'UPDATE') as can_update_approval,
    has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') as can_update_display_name`);
  assert.deepEqual(grants.rows[0], {
    can_update_role: false,
    can_update_approval: false,
    can_update_display_name: true,
  });
  await expectPgError(asAuthenticated(db, userIds.pending, () => db.query(
    `update public.profiles set role = 'admin', approval_status = 'approved' where id = $1`,
    [userIds.pending],
  )), '42501');
}

async function testRestrictiveRls(db) {
  const policies = await db.query(`select policyname, permissive from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'candidates'
      and policyname in ('legacy_candidates_read_any', 'devrank_auth_candidates_approval_gate')
    order by policyname`);
  assert.deepEqual(policies.rows, [
    { policyname: 'devrank_auth_candidates_approval_gate', permissive: 'RESTRICTIVE' },
    { policyname: 'legacy_candidates_read_any', permissive: 'PERMISSIVE' },
  ]);

  const visibleToPendingRecruiter = await asAuthenticated(db, userIds.pending, () => db.query(
    `select id from public.candidates where id = $1`, [candidateId],
  ));
  assert.deepEqual(visibleToPendingRecruiter.rows, [], 'restrictive policy blocks legacy broad SELECT');

  const updateByPendingRecruiter = await asAuthenticated(db, userIds.pending, () => db.query(
    `update public.candidates set full_name = 'Tampered' where id = $1 returning id`, [candidateId],
  ));
  assert.deepEqual(updateByPendingRecruiter.rows, [], 'restrictive policy blocks legacy broad UPDATE');
  const unchanged = await db.query(`select full_name from public.candidates where id = $1`, [candidateId]);
  assert.equal(unchanged.rows[0].full_name, 'Synthetic test candidate');
}

async function testAdminGuards(db) {
  const functionPrivileges = await db.query(`select
    has_function_privilege('anon', 'public.decide_recruiter_application(uuid,text)', 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', 'public.decide_recruiter_application(uuid,text)', 'EXECUTE') as authenticated_execute`);
  assert.deepEqual(functionPrivileges.rows[0], { anon_execute: false, authenticated_execute: true });

  await expectPgError(asAuthenticated(db, userIds.pending, () => db.query(
    `select public.decide_recruiter_application($1, 'approved')`, [userIds.targetApprove],
  )), '42501');
  await expectPgError(asAuthenticated(db, userIds.unconfirmedAdmin, () => db.query(
    `select public.decide_recruiter_application($1, 'approved')`, [userIds.targetApprove],
  )), '42501');
  await expectPgError(asAuthenticated(db, userIds.pendingAdmin, () => db.query(
    `select public.decide_recruiter_application($1, 'approved')`, [userIds.targetApprove],
  )), '42501');

  const audit = await db.query(`select count(*)::integer as count from public.audit_logs`);
  assert.equal(audit.rows[0].count, 0, 'unauthorized decisions write no audit event');
  const unchanged = await db.query(`select approval_status from public.profiles where id = $1`, [userIds.targetApprove]);
  assert.equal(unchanged.rows[0].approval_status, 'pending');
}

async function testApproveAndReject(db) {
  const before = await db.query(`select updated_at from public.profiles where id = $1`, [userIds.targetApprove]);
  assert.equal(new Date(before.rows[0].updated_at).toISOString(), new Date(timestampBaseline).toISOString());

  const approval = await asAuthenticated(db, userIds.admin, async () => {
    await db.exec('begin;');
    try {
      const result = await db.query(`select public.decide_recruiter_application($1, 'approved') as decided`, [userIds.targetApprove]);
      await db.exec('reset role;');
      const row = await db.query(`select approval_status, updated_at, transaction_timestamp() as tx_time
        from public.profiles where id = $1`, [userIds.targetApprove]);
      await db.exec('commit;');
      return { result, row: row.rows[0] };
    } catch (error) {
      try { await db.exec('rollback;'); } catch { /* transaction may already be aborted */ }
      throw error;
    }
  });
  assert.deepEqual(approval.result.rows, [{ decided: true }]);
  assert.equal(approval.row.approval_status, 'approved');
  assert.equal(new Date(approval.row.updated_at).toISOString(), new Date(approval.row.tx_time).toISOString(), 'updated_at trigger records decision transaction time');
  assert.ok(new Date(approval.row.updated_at) > new Date(before.rows[0].updated_at));

  const rejection = await asAuthenticated(db, userIds.admin, async () => {
    await db.exec('begin;');
    try {
      const result = await db.query(`select public.decide_recruiter_application($1, 'rejected') as decided`, [userIds.targetReject]);
      await db.exec('reset role;');
      const row = await db.query(`select approval_status, updated_at, transaction_timestamp() as tx_time
        from public.profiles where id = $1`, [userIds.targetReject]);
      await db.exec('commit;');
      return { result, row: row.rows[0] };
    } catch (error) {
      try { await db.exec('rollback;'); } catch { /* transaction may already be aborted */ }
      throw error;
    }
  });
  assert.deepEqual(rejection.result.rows, [{ decided: true }]);
  assert.equal(rejection.row.approval_status, 'rejected');
  assert.equal(new Date(rejection.row.updated_at).toISOString(), new Date(rejection.row.tx_time).toISOString(), 'rejection updates the profile timestamp');
  assert.ok(new Date(rejection.row.updated_at) > new Date(timestampBaseline));

  const events = await db.query(`select owner_id, entity_id, action, entity_type,
      metadata->>'approval_status' as status, metadata->>'display_name' as display_name
    from public.audit_logs order by action`);
  assert.deepEqual(events.rows, [
    { owner_id: userIds.admin, entity_id: userIds.targetApprove, action: 'recruiter_approved', entity_type: 'recruiter', status: 'approved', display_name: 'Approval target' },
    { owner_id: userIds.admin, entity_id: userIds.targetReject, action: 'recruiter_rejected', entity_type: 'recruiter', status: 'rejected', display_name: 'Rejection target' },
  ]);
}

async function testSelfRepeatedAndConcurrentDecisions(db) {
  const eventCountBefore = (await db.query(`select count(*)::integer as count from public.audit_logs`)).rows[0].count;
  await expectPgError(asAuthenticated(db, userIds.admin, () => db.query(
    `select public.decide_recruiter_application($1, 'rejected')`, [userIds.admin],
  )), '42501');
  await expectPgError(asAuthenticated(db, userIds.admin, () => db.query(
    `select public.decide_recruiter_application($1, 'rejected')`, [userIds.pendingAdmin],
  )), 'P0002');
  await expectPgError(asAuthenticated(db, userIds.admin, () => db.query(
    `select public.decide_recruiter_application($1, 'rejected')`, [userIds.targetApprove],
  )), 'P0002');
  const afterFailures = await db.query(`select approval_status from public.profiles where id = $1`, [userIds.targetApprove]);
  assert.equal(afterFailures.rows[0].approval_status, 'approved');
  assert.equal((await db.query(`select count(*)::integer as count from public.audit_logs`)).rows[0].count, eventCountBefore);

  const outcomes = await asAuthenticated(db, userIds.admin, () => Promise.allSettled([
    db.query(`select public.decide_recruiter_application($1, 'approved')`, [userIds.targetRace]),
    db.query(`select public.decide_recruiter_application($1, 'approved')`, [userIds.targetRace]),
  ]));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'only one competing decision succeeds');
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason?.code === 'P0002').length, 1);
  const raceEvents = await db.query(`select count(*)::integer as count from public.audit_logs where entity_id = $1`, [userIds.targetRace]);
  assert.equal(raceEvents.rows[0].count, 1, 'only the successful decision emits an audit row');
  const raceStatus = await db.query(`select approval_status from public.profiles where id = $1`, [userIds.targetRace]);
  assert.equal(raceStatus.rows[0].approval_status, 'approved');
}

const db = await createDatabase();
try {
  await testSignupProfileAndMetadata(db);
  console.log('PASS: signup trigger creates one recruiter/pending profile and ignores privilege metadata; column grants block self-promotion.');
  await testRestrictiveRls(db);
  console.log('PASS: pre-existing permissive candidate policies cannot bypass the recruiter approval gate.');
  await testAdminGuards(db);
  console.log('PASS: only authenticated-executor confirmed/approved admins can decide; unauthorized attempts change no rows or audit records.');
  await testApproveAndReject(db);
  console.log('PASS: approvals/rejections persist status, updated_at, and matching transactional audit events.');
  await testSelfRepeatedAndConcurrentDecisions(db);
  console.log('PASS: self, repeated, and competing decisions cannot create false success or duplicate audit events.');
  console.log('PGlite ran the real four migration files and PostgreSQL functions, triggers, grants, and RLS policies in an isolated in-memory database. It stubs auth.uid(); it does not run Supabase Auth, PostgREST, or independent concurrent database connections. API authorization tests cover unconfirmed/pending callers with mocked verified identities.');
} finally {
  await db.close();
}
