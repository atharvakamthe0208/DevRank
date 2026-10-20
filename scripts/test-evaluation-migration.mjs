import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/', import.meta.url);
const readMigration = async (name) => (await readFile(new URL(name, migrationPath), 'utf8')).replace(/^\uFEFF/, '');
const bootstrapSql = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb,
    email_confirmed_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
`;

const historicalMigrations = [
  '20261010000000_initial_devrank_schema.sql',
  '20261011000000_candidate_api_fields.sql',
  '20261011100000_recruiter_auth.sql',
  '20261011110000_recruiter_admin_approval.sql',
];
const resultAndRoleMigrations = [
  '20261012000000_evaluation_results.sql',
  '20261013000000_configured_role_evaluations.sql',
];
const reconciliation = await readMigration('20261014000000_reconcile_evaluation_persistence.sql');
const candidateDeletion = await readMigration('20261017185551_permanent_candidate_deletion.sql');

const ownerId = '00000000-0000-4000-8000-000000000001';
const otherOwnerId = '00000000-0000-4000-8000-000000000002';
const candidateId = '10000000-0000-4000-8000-000000000001';
const otherCandidateId = '10000000-0000-4000-8000-000000000002';
const roleProfileId = '20000000-0000-4000-8000-000000000001';
const existingEvaluationId = '30000000-0000-4000-8000-000000000001';
const comparisonId = '40000000-0000-4000-8000-000000000001';

async function createFixture({ currentSchema = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(bootstrapSql);
    for (const file of [...historicalMigrations, ...(currentSchema ? resultAndRoleMigrations : [])]) {
      await db.exec(await readMigration(file));
    }
    await db.exec(`
      insert into auth.users (id, email) values
        ('${ownerId}', 'owner-1@example.invalid'),
        ('${otherOwnerId}', 'owner-2@example.invalid');
      insert into public.candidates (id, owner_id, full_name) values
        ('${candidateId}', '${ownerId}', 'Synthetic Candidate One'),
        ('${otherCandidateId}', '${otherOwnerId}', 'Synthetic Candidate Two');
      insert into public.role_profiles (id, owner_id, name, weights)
        values ('${roleProfileId}', '${ownerId}', 'software_developer', '{}'::jsonb);
      insert into public.evaluations
        (id, owner_id, candidate_id, role_profile_id, status, overall_score, scoring_version, evidence_snapshot)
      values
        ('${existingEvaluationId}', '${ownerId}', '${candidateId}', '${roleProfileId}',
         '${currentSchema ? 'insufficient_evidence' : 'pending'}', null, '1.0.0', '[]'::jsonb);
    `);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function catalogSnapshot(db) {
  const [foreignKeys, indexes, policies, rls] = await Promise.all([
    db.query(`select conname, pg_get_constraintdef(oid, true) as definition, convalidated
      from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass and contype = 'f'
      order by conname`),
    db.query(`select indexname, indexdef from pg_catalog.pg_indexes
      where schemaname = 'public' and tablename = 'evaluations' order by indexname`),
    db.query(`select policyname, permissive, roles, cmd, qual, with_check from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'evaluations' order by policyname`),
    db.query(`select relrowsecurity, relforcerowsecurity from pg_catalog.pg_class
      where oid = 'public.evaluations'::regclass`),
  ]);
  return {
    foreignKeys: foreignKeys.rows,
    indexes: indexes.rows,
    policies: policies.rows,
    rls: rls.rows[0],
  };
}

async function verifyEvaluationPrivileges(db) {
  const result = await db.query(`select
    has_table_privilege('anon', 'public.evaluations', 'SELECT') as anon_select,
    has_table_privilege('anon', 'public.evaluations', 'INSERT') as anon_insert,
    has_table_privilege('anon', 'public.evaluations', 'UPDATE') as anon_update,
    has_table_privilege('anon', 'public.evaluations', 'DELETE') as anon_delete,
    has_table_privilege('authenticated', 'public.evaluations', 'SELECT') as authenticated_select,
    has_table_privilege('authenticated', 'public.evaluations', 'INSERT') as authenticated_insert,
    has_table_privilege('authenticated', 'public.evaluations', 'UPDATE') as authenticated_update,
    has_table_privilege('authenticated', 'public.evaluations', 'DELETE') as authenticated_delete,
    has_table_privilege('authenticated', 'public.evaluations', 'TRUNCATE') as authenticated_truncate,
    has_table_privilege('service_role', 'public.evaluations', 'TRUNCATE') as service_role_truncate,
    (select count(*) from pg_catalog.pg_class t
      cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) acl
      where t.oid = 'public.evaluations'::regclass and acl.grantee = 0) as public_acl_entries`);
  assert.deepEqual(result.rows[0], {
    anon_select: false,
    anon_insert: false,
    anon_update: false,
    anon_delete: false,
    authenticated_select: true,
    authenticated_insert: true,
    authenticated_update: true,
    authenticated_delete: true,
    authenticated_truncate: false,
    service_role_truncate: true,
    public_acl_entries: 0,
  }, 'effective table privileges must match the repository ACL model');
}

async function verifySchemaFixture(currentSchema) {
  const db = await createFixture({ currentSchema });
  try {
    const beforeCatalog = await catalogSnapshot(db);
    const beforeRow = await db.query(`select id, owner_id, candidate_id, role_profile_id, status,
      overall_score, scoring_version, evidence_snapshot from public.evaluations where id = '${existingEvaluationId}'`);

    await db.exec(reconciliation);

    const columns = await db.query(`select column_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'evaluations'
        and column_name in ('evaluation_result', 'role_weights_snapshot', 'target_role', 'role_profile_id')
      order by column_name`);
    assert.deepEqual(columns.rows, [
      { column_name: 'evaluation_result', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'role_profile_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'role_weights_snapshot', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'target_role', data_type: 'text', is_nullable: 'YES' },
    ]);

    const statusCheck = await db.query(`select pg_get_constraintdef(oid, true) as definition, convalidated
      from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass
        and conname = 'evaluations_status_check' and contype = 'c'`);
    assert.equal(statusCheck.rows.length, 1);
    assert.equal(statusCheck.rows[0].convalidated, true);
    assert.match(statusCheck.rows[0].definition, /insufficient_evidence/);

    assert.deepEqual(await catalogSnapshot(db), beforeCatalog, 'FKs, indexes, RLS mode, and policies must be preserved');
    await verifyEvaluationPrivileges(db);
    const afterRow = await db.query(`select id, owner_id, candidate_id, role_profile_id, status,
      overall_score, scoring_version, evidence_snapshot, evaluation_result, role_weights_snapshot, target_role
      from public.evaluations where id = '${existingEvaluationId}'`);
    assert.deepEqual(afterRow.rows[0], {
      ...beforeRow.rows[0],
      evaluation_result: null,
      role_weights_snapshot: null,
      target_role: null,
    }, 'the existing evaluation must be preserved without fabricated snapshots or scores');

    await db.exec(`
      insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
      values ('${ownerId}', '${candidateId}', null, 'software_developer', 'insufficient_evidence');
      insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
      values ('${ownerId}', '${candidateId}', '${roleProfileId}', 'software_developer', 'completed');
      insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
      values ('${ownerId}', '${candidateId}', null, 'software_developer', 'in_progress'),
             ('${ownerId}', '${candidateId}', null, 'software_developer', 'pending'),
             ('${ownerId}', '${candidateId}', null, 'software_developer', 'failed');
    `);

    await assert.rejects(
      db.query(`insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
        values ('${otherOwnerId}', '${otherCandidateId}', '${roleProfileId}', 'software_developer', 'completed')`),
      (error) => error.code === '23503',
      'cross-owner role-profile reference must be rejected by the composite FK',
    );
    await assert.rejects(
      db.query(`insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
        values ('${ownerId}', '${candidateId}', null, 'software_developer', null)`),
      (error) => error.code === '23502',
      'NULL status must be rejected',
    );
    await assert.rejects(
      db.query(`insert into public.evaluations (owner_id, candidate_id, role_profile_id, target_role, status)
        values ('${ownerId}', '${candidateId}', null, 'software_developer', 'cancelled')`),
      (error) => error.code === '23514',
      'statuses outside the reviewed vocabulary must be rejected',
    );

    const beforeRerun = await db.query('select count(*)::integer as count from public.evaluations');
    await db.exec(reconciliation);
    const afterRerun = await db.query('select count(*)::integer as count from public.evaluations');
    assert.deepEqual(afterRerun.rows, beforeRerun.rows, 'rerun must not alter existing or newly inserted rows');
    assert.deepEqual(await catalogSnapshot(db), beforeCatalog, 'rerun must preserve ownership/security catalog objects');
    await verifyEvaluationPrivileges(db);
    await verifyPermanentCandidateDeletion(db);
    console.log(`PASS: complete migration, ${currentSchema ? 'current five-status' : 'legacy four-status'} fixture, row preservation, role paths, FK/status rejection, rerun, and permanent candidate deletion with owner/approval RLS checks.`);
  } finally {
    await db.close();
  }
}

async function verifyPermanentCandidateDeletion(db) {
  await db.exec(candidateDeletion);
  await db.exec(candidateDeletion);
  const functionGrant = await db.query(`select
    has_function_privilege('anon', 'public.delete_candidate_and_data(uuid)', 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', 'public.delete_candidate_and_data(uuid)', 'EXECUTE') as authenticated_execute`);
  assert.deepEqual(functionGrant.rows[0], { anon_execute: false, authenticated_execute: true });

  await db.exec(`
    update public.profiles set approval_status = 'approved' where id in ('${ownerId}', '${otherOwnerId}');
    insert into public.platform_evidence (candidate_id, owner_id, source, availability, raw_evidence)
      values ('${candidateId}', '${ownerId}', 'leetcode', 'available', '{"solved": 3}'::jsonb);
    insert into public.comparisons (id, owner_id, name)
      values ('${comparisonId}', '${ownerId}', 'Synthetic comparison');
    insert into public.category_scores (evaluation_id, owner_id, category_key, score)
      values ('${existingEvaluationId}', '${ownerId}', 'technical_skills', 50);
    insert into public.ai_analyses (evaluation_id, owner_id, provider, output)
      values ('${existingEvaluationId}', '${ownerId}', 'fixture', '{"summary":"fixture"}'::jsonb);
    insert into public.comparison_candidates (comparison_id, owner_id, candidate_id, evaluation_id, position)
      values ('${comparisonId}', '${ownerId}', '${candidateId}', '${existingEvaluationId}', 1);
  `);

  await db.exec(`set request.jwt.claim.sub = '${otherOwnerId}'; set role authenticated;`);
  const crossOwnerAttempt = await db.query(`select public.delete_candidate_and_data('${candidateId}') as deleted`);
  assert.deepEqual(crossOwnerAttempt.rows, [{ deleted: false }], 'another authenticated owner must not delete this candidate');
  await db.exec('reset role; reset request.jwt.claim.sub;');
  const preserved = await db.query(`select
    (select count(*)::integer from public.candidates where id = '${candidateId}') as candidates,
    (select count(*)::integer from public.platform_evidence where candidate_id = '${candidateId}') as evidence,
    (select count(*)::integer from public.evaluations where candidate_id = '${candidateId}') as evaluations,
    (select count(*)::integer from public.category_scores where evaluation_id = '${existingEvaluationId}') as scores,
    (select count(*)::integer from public.ai_analyses where evaluation_id = '${existingEvaluationId}') as analyses,
    (select count(*)::integer from public.comparison_candidates where candidate_id = '${candidateId}') as comparison_memberships`);
  assert.deepEqual(preserved.rows[0], {
    candidates: 1,
    evidence: 1,
    evaluations: 6,
    scores: 1,
    analyses: 1,
    comparison_memberships: 1,
  }, 'a cross-owner attempt must leave candidate data intact');

  await db.exec(`update public.profiles set approval_status = 'pending' where id = '${ownerId}'; set request.jwt.claim.sub = '${ownerId}'; set role authenticated;`);
  const unapprovedAttempt = await db.query(`select public.delete_candidate_and_data('${candidateId}') as deleted`);
  assert.deepEqual(unapprovedAttempt.rows, [{ deleted: false }], 'the restrictive recruiter-approval policy must remain effective');
  await db.exec('reset role; reset request.jwt.claim.sub;');

  await db.exec(`update public.profiles set approval_status = 'approved' where id = '${ownerId}'; set request.jwt.claim.sub = '${ownerId}'; set role authenticated;`);
  const ownAttempt = await db.query(`select public.delete_candidate_and_data('${candidateId}') as deleted`);
  assert.deepEqual(ownAttempt.rows, [{ deleted: true }], 'the authenticated approved owner must be able to delete the candidate');
  await db.exec('reset role; reset request.jwt.claim.sub;');
  const deleted = await db.query(`select
    (select count(*)::integer from public.candidates where id = '${candidateId}') as candidates,
    (select count(*)::integer from public.platform_evidence where candidate_id = '${candidateId}') as evidence,
    (select count(*)::integer from public.evaluations where candidate_id = '${candidateId}') as evaluations,
    (select count(*)::integer from public.category_scores where evaluation_id = '${existingEvaluationId}') as scores,
    (select count(*)::integer from public.ai_analyses where evaluation_id = '${existingEvaluationId}') as analyses,
    (select count(*)::integer from public.comparison_candidates where candidate_id = '${candidateId}') as comparison_memberships,
    (select count(*)::integer from public.comparisons where id = '${comparisonId}') as comparisons`);
  assert.deepEqual(deleted.rows[0], {
    candidates: 0,
    evidence: 0,
    evaluations: 0,
    scores: 0,
    analyses: 0,
    comparison_memberships: 0,
    comparisons: 1,
  }, 'candidate-owned records and memberships must be removed while comparison containers are preserved');

  const secondDelete = await db.query(`select public.delete_candidate_and_data('${candidateId}') as deleted`);
  assert.deepEqual(secondDelete.rows, [{ deleted: false }], 'deleting an already-removed candidate returns false without side effects');
}

async function verifyRollback({ invalidValue, column, setupSql, expectedError, label }) {
  const db = await createFixture();
  try {
    await db.exec(`alter table public.evaluations add column evaluation_result jsonb;
      alter table public.evaluations add column role_weights_snapshot jsonb;
      alter table public.evaluations add column target_role text;
      ${setupSql}`);
    const before = await db.query(`select role_profile_id is not null as profile_required, status
      from public.evaluations where id = '${existingEvaluationId}'`);
    await assert.rejects(db.exec(reconciliation), expectedError);
    // Explicit transaction files leave an errored session aborted until rollback.
    try { await db.exec('rollback'); } catch { /* Some PGlite errors already roll back the failed exec. */ }

    const after = await db.query(`select role_profile_id is not null as profile_required, status,
      ${column}::text as invalid_value from public.evaluations where id = '${existingEvaluationId}'`);
    assert.equal(after.rows[0].profile_required, before.rows[0].profile_required);
    assert.equal(after.rows[0].status, before.rows[0].status);
    assert.equal(after.rows[0].invalid_value, invalidValue);
    const statusConstraint = await db.query(`select pg_get_constraintdef(oid, true) as definition
      from pg_catalog.pg_constraint where conrelid = 'public.evaluations'::regclass
        and conname = 'evaluations_status_check'`);
    assert.equal(statusConstraint.rows[0].definition.includes('cancelled'), label === 'unsupported status');
    console.log(`PASS: ${label} preflight aborts and transaction rollback preserves schema/data.`);
  } finally {
    await db.close();
  }
}

await verifySchemaFixture(false);
await verifySchemaFixture(true);
await verifyRollback({
  invalidValue: '[]',
  column: 'evaluation_result',
  setupSql: `update public.evaluations set evaluation_result = '[]'::jsonb where id = '${existingEvaluationId}';`,
  expectedError: /non-object value/,
  label: 'invalid evaluation_result JSON shape',
});
await verifyRollback({
  invalidValue: 'unsupported_role',
  column: 'target_role',
  setupSql: `update public.evaluations set target_role = 'unsupported_role' where id = '${existingEvaluationId}';`,
  expectedError: /unsupported roles/,
  label: 'unsupported target role',
});
await verifyRollback({
  invalidValue: 'cancelled',
  column: 'status',
  setupSql: `alter table public.evaluations drop constraint evaluations_status_check;
    alter table public.evaluations add constraint evaluations_status_check
      check (status in ('pending', 'in_progress', 'completed', 'failed', 'cancelled'));
    update public.evaluations set status = 'cancelled' where id = '${existingEvaluationId}';`,
  expectedError: /outside the reviewed contract vocabulary/,
  label: 'unsupported status',
});

console.log('PGlite is an in-memory PostgreSQL WASM runtime. These tests execute the full SQL migration but do not emulate Supabase Auth/PostgREST, hosted extensions, network behavior, native locking/durability, or live RLS sessions.');
