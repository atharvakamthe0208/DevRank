import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceRoleKey) {
  throw new Error('Local Supabase URL, anon key, and service role key are required.');
}
const hostname = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(hostname)) {
  throw new Error('Refusing to run candidate import integration tests against a nonlocal Supabase URL.');
}

const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const authUsers = [];
const suffix = randomUUID();
const userSpecs = [
  { label: 'approved', email: `csv-import-${suffix}@example.invalid`, password: `Local-${randomUUID()}-Aa1!`, confirmed: true, approved: true },
  { label: 'pending', email: `csv-import-pending-${suffix}@example.invalid`, password: `Local-${randomUUID()}-Aa1!`, confirmed: true, approved: false },
];

async function requireData(result, operation) {
  if (result.error) throw new Error(`${operation} failed: ${result.error.code ?? 'unknown'}`);
  return result.data;
}

try {
  const users = {};
  for (const spec of userSpecs) {
    const created = await admin.auth.admin.createUser({ email: spec.email, password: spec.password, email_confirm: spec.confirmed });
    const user = (await requireData(created, `create local ${spec.label} auth user`)).user;
    assert.ok(user?.id, `local ${spec.label} auth user must have an ID`);
    assert.equal(user.email, spec.email, `local ${spec.label} auth user must match the generated test address`);
    authUsers.push(user.id);
    users[spec.label] = user;
    if (spec.approved) {
      await requireData(await admin.from('profiles').update({ approval_status: 'approved' }).eq('id', user.id), 'approve local test recruiter');
    }
  }

  const login = await admin.auth.signInWithPassword({ email: userSpecs[0].email, password: userSpecs[0].password });
  const session = await requireData(login, 'sign in local approved recruiter');
  const recruiter = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await recruiter.auth.setSession(session.session);

  const key = randomUUID();
  const rows = [{ rowNumber: 2, candidate: { name: 'SHA Digest Local Fixture', email: `fixture-${suffix}@example.invalid` } }];
  const first = await recruiter.rpc('candidate_bulk_import', {
    p_rows: rows,
    p_idempotency_key: key,
    p_skip_duplicates: true,
    p_preview: false,
  });
  const firstResult = await requireData(first, 'first import call');
  assert.equal(firstResult.createdCount, 1);

  const reorderedEquivalentRows = [{ candidate: { email: rows[0].candidate.email, name: rows[0].candidate.name }, rowNumber: 2 }];
  const replay = await recruiter.rpc('candidate_bulk_import', {
    p_rows: reorderedEquivalentRows,
    p_idempotency_key: key,
    p_skip_duplicates: true,
    p_preview: false,
  });
  assert.deepEqual(await requireData(replay, 'equivalent payload replay'), firstResult);

  const changed = await recruiter.rpc('candidate_bulk_import', {
    p_rows: [{ rowNumber: 2, candidate: { name: 'Changed Payload' } }],
    p_idempotency_key: key,
    p_skip_duplicates: true,
    p_preview: false,
  });
  assert.equal(changed.error?.code, '22023', 'changed payload must be rejected for an existing key');

  const receipt = await admin.from('candidate_import_batches')
    .select('request_digest,request_digest_version,result')
    .eq('owner_id', users.approved.id)
    .eq('idempotency_key', key)
    .single();
  assert.equal(receipt.error?.code, '42501', 'receipt table must remain inaccessible through PostgREST, including to service_role clients');

  const candidateRows = await admin.from('candidates').select('id').eq('owner_id', users.approved.id).eq('email', rows[0].candidate.email);
  assert.equal((await requireData(candidateRows, 'count imported local candidate rows')).length, 1, 'retry must not create a duplicate row');

  const pendingLogin = await admin.auth.signInWithPassword({ email: userSpecs[1].email, password: userSpecs[1].password });
  const pendingSession = await requireData(pendingLogin, 'sign in local pending recruiter');
  const pendingClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await pendingClient.auth.setSession(pendingSession.session);
  const denied = await pendingClient.rpc('candidate_bulk_import', {
    p_rows: [{ rowNumber: 2, candidate: { name: 'Must Not Import' } }],
    p_idempotency_key: randomUUID(),
    p_skip_duplicates: true,
    p_preview: false,
  });
  assert.equal(denied.error?.code, '42501', 'pending recruiter must be denied by the database RPC');

  console.log('Local Supabase SHA-256 receipts, canonical JSONB replay, changed-payload rejection, duplicate prevention, and pending-recruiter denial passed.');
} finally {
  for (const userId of authUsers) {
    const deleted = await admin.auth.admin.deleteUser(userId);
    if (deleted.error) console.error(`Warning: failed to remove local test auth user (${deleted.error.code ?? 'unknown'}).`);
  }
}
