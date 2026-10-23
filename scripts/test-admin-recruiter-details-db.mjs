import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const readMigration = async (name) => (await readFile(new URL(name, migrations), 'utf8')).replace(/^\uFEFF/, '');
const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  recruiter: '00000000-0000-4000-8000-000000000002',
  otherRecruiter: '00000000-0000-4000-8000-000000000003',
};
const candidateIds = {
  first: '10000000-0000-4000-8000-000000000001',
  second: '10000000-0000-4000-8000-000000000002',
  other: '10000000-0000-4000-8000-000000000003',
};
const evaluationIds = Array.from({ length: 25 }, (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
const screeningSessionIds = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
];

const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema storage;
    create table storage.buckets (
      id text primary key,
      name text not null,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text
    );
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select string_to_array(name, '/')
    $$;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      email_confirmed_at timestamptz,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    grant usage on schema storage to anon, authenticated, service_role;
    grant execute on function storage.foldername(text) to anon, authenticated, service_role;
  `);
  for (const name of [
    '20261010000000_initial_devrank_schema.sql',
    '20261011100000_recruiter_auth.sql',
    '20261011110000_recruiter_admin_approval.sql',
    '20261012000000_evaluation_results.sql',
    '20261017130000_add_resume_screening_persistence.sql',
    '20261023000000_recruiter_profile_details.sql',
    '20261024004141_admin_recruiter_details_analytics.sql',
  ]) await db.exec(await readMigration(name));

  await db.query(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at) values
    ($1, 'admin@example.invalid', now(), '{}', now() - interval '90 days'),
    ($2, 'recruiter@example.invalid', now(), '{"full_name":"Target Recruiter"}', now() - interval '60 days'),
    ($3, 'other@example.invalid', now(), '{"full_name":"Other Recruiter"}', now() - interval '40 days')`, [ids.admin, ids.recruiter, ids.otherRecruiter]);
  await db.query(`update public.profiles set role = 'admin', approval_status = 'approved' where id = $1`, [ids.admin]);
  await db.query(`update public.profiles set approval_status = 'approved', company_name = 'Example Org', location_city = 'Pune' where id = $1`, [ids.recruiter]);
  await db.query(`update public.profiles set approval_status = 'approved' where id = $1`, [ids.otherRecruiter]);

  await db.query(`insert into public.candidates (id, owner_id, full_name) values
    ($1, $2, 'Candidate A'), ($3, $2, 'Candidate B'), ($4, $5, 'Private Other Candidate')`,
    [candidateIds.first, ids.recruiter, candidateIds.second, candidateIds.other, ids.otherRecruiter]);
  const roleId = '40000000-0000-4000-8000-000000000001';
  await db.query(`insert into public.role_profiles (id, owner_id, name) values ($1, $2, 'Engineer')`, [roleId, ids.recruiter]);
  const otherRoleId = '40000000-0000-4000-8000-000000000002';
  await db.query(`insert into public.role_profiles (id, owner_id, name) values ($1, $2, 'Other role')`, [otherRoleId, ids.otherRecruiter]);
  const evaluationRows = [
    [evaluationIds[0], candidateIds.first, 'completed', 80],
    [evaluationIds[1], candidateIds.first, 'completed', 90],
    [evaluationIds[2], candidateIds.second, 'in_progress', null],
    [evaluationIds[3], candidateIds.second, 'insufficient_evidence', null],
    [evaluationIds[4], candidateIds.second, 'failed', null],
  ];
  for (let index = 5; index < evaluationIds.length; index += 1) evaluationRows.push([evaluationIds[index], candidateIds.second, 'pending', null]);
  for (const [id, candidateId, status, score] of evaluationRows) {
    await db.query(`insert into public.evaluations (id, owner_id, candidate_id, role_profile_id, status, overall_score, created_at)
      values ($1, $2, $3, $4, $5, $6, now() - ($7 * interval '1 minute'))`,
      [id, ids.recruiter, candidateId, roleId, status, score, evaluationRows.indexOf(evaluationRows.find((row) => row[0] === id))]);
  }
  await db.query(`insert into public.evaluations (owner_id, candidate_id, role_profile_id, status, overall_score)
    values ($1, $2, $3, 'completed', 12)`, [ids.otherRecruiter, candidateIds.other, otherRoleId]);

  await db.query(`insert into public.screening_sessions (id, owner_id, job_title, job_description, status, created_at) values
    ($1, $2, 'Engineer', repeat('Role description ', 4), 'completed', now() - interval '10 minutes'),
    ($3, $2, 'Engineer', repeat('Role description ', 4), 'processing', now() - interval '8 minutes'),
    ($4, $5, 'Engineer', repeat('Role description ', 4), 'completed', now() - interval '5 minutes')`,
    [screeningSessionIds[0], ids.recruiter, screeningSessionIds[1], screeningSessionIds[2], ids.otherRecruiter]);
  for (let index = 0; index < 3; index += 1) {
    await db.query(`insert into public.resume_screenings (session_id, owner_id, storage_path, original_filename, mime_type, file_size, sha256, status, processed_at)
      values ($1, $2, $3, 'resume.pdf', 'application/pdf', 100, $4, $5, $6)`,
      [screeningSessionIds[0], ids.recruiter, `test/${index}.pdf`, String(index).padStart(64, '0'), index < 2 ? 'completed' : 'failed', index < 2 ? new Date(Date.now() - index * 60_000).toISOString() : null]);
  }
  await db.query(`insert into public.audit_logs (owner_id, action, entity_type, entity_id, created_at) values
    ($1, 'recruiter_approved', 'recruiter', $2, now() - interval '1 minute'),
    ($1, 'recruiter_rejected', 'recruiter', $3, now())`, [ids.admin, ids.recruiter, ids.otherRecruiter]);

  const grants = await db.query(`select
    has_function_privilege('anon', 'public.get_admin_recruiter_details(uuid)', 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', 'public.get_admin_recruiter_details(uuid)', 'EXECUTE') as authenticated_execute`);
  assert.deepEqual(grants.rows[0], { anon_execute: false, authenticated_execute: true }, 'RPC execute is limited to authenticated callers');

  async function asUser(userId, callback) {
    await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated`);
    try { return await callback(); } finally { await db.exec('reset role; reset request.jwt.claim.sub'); }
  }
  const response = await asUser(ids.admin, () => db.query(`select public.get_admin_recruiter_details($1) as details`, [ids.recruiter]));
  const details = response.rows[0].details;
  assert.equal(details.profile.email, 'recruiter@example.invalid');
  assert.equal(details.profile.companyName, 'Example Org');
  assert.equal(details.profile.emailConfirmed, true);
  assert.deepEqual(details.stats, {
    totalEvaluations: 25,
    completedEvaluations: 2,
    inProgressEvaluations: 1,
    distinctCandidatesEvaluated: 2,
    resumeScreeningsInitiated: 2,
    completedResumeScreenings: 2,
    averageCompletedEvaluationScore: 85,
    recentActivityCount30Days: 30,
  });
  assert.equal(details.recentActivity.length, 20, 'recent activity is capped at 20 items');
  const activityTimes = details.recentActivity.map((event) => Date.parse(event.occurredAt));
  assert.deepEqual(activityTimes, [...activityTimes].sort((left, right) => right - left), 'activity is newest-first');
  assert(details.recentActivity.every((event) => event.id !== `audit:${ids.otherRecruiter}`), 'another recruiter\'s audit event is excluded');

  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values
    ('00000000-0000-4000-8000-000000000004', 'unconfirmed@example.invalid', null)`);
  await db.query(`update public.profiles set role = 'admin', approval_status = 'approved' where id = '00000000-0000-4000-8000-000000000004'`);
  await assert.rejects(asUser('00000000-0000-4000-8000-000000000004', () => db.query(`select public.get_admin_recruiter_details($1)`, [ids.recruiter])), (error) => error?.code === '42501');
  await assert.rejects(asUser(ids.recruiter, () => db.query(`select public.get_admin_recruiter_details($1)`, [ids.otherRecruiter])), (error) => error?.code === '42501');
  await assert.rejects(asUser(ids.admin, () => db.query(`select public.get_admin_recruiter_details($1)`, [ids.admin])), (error) => error?.code === 'P0002');

  console.log('Admin recruiter details database integration tests passed (PGlite, actual migrations and function).');
} finally {
  await db.close();
}
