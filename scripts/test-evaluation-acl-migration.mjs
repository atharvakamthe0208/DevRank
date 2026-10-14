import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261014000000_reconcile_evaluation_persistence.sql', import.meta.url), 'utf8');
const marker = '-- Supabase installations commonly apply default table ACLs';
const markerIndex = migration.indexOf(marker);
const blockStart = migration.indexOf('do $$', markerIndex);
const blockEnd = migration.indexOf('$$;', blockStart);
assert.notEqual(markerIndex, -1, 'ACL normalization marker is present');
assert.notEqual(blockStart, -1, 'ACL normalization DO block is present');
assert.notEqual(blockEnd, -1, 'ACL normalization DO block terminates');
const aclBlock = migration.slice(blockStart, blockEnd + 3);

async function fixture({ anonDefault = true, publicDefault = false } = {}) {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(`alter default privileges in schema public grant all on tables to ${anonDefault ? 'anon, ' : ''}authenticated, service_role${publicDefault ? ', public' : ''};`);
  await db.exec('create table public.evaluations(id integer primary key); grant select, insert, update, delete on public.evaluations to authenticated;');
  return db;
}

const db = await fixture();
try {
  const original = await db.query(`
    select has_table_privilege('anon', 'public.evaluations', 'SELECT') as anon_select,
           has_table_privilege('authenticated', 'public.evaluations', 'TRUNCATE') as authenticated_truncate,
           (select count(*) from pg_class t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
            where t.oid = 'public.evaluations'::regclass and a.grantee = 'anon'::regrole) as anon_direct_acl_count,
           exists (
             select 1 from pg_class t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
             where t.oid = 'public.evaluations'::regclass and a.grantee = 0
           ) as public_acl_entry
  `);
  assert.equal(original.rows[0].anon_select, true);
  assert.equal(original.rows[0].authenticated_truncate, true);
  assert.ok(original.rows[0].anon_direct_acl_count > 0, 'anon defaults appear as direct ACL entries');
  assert.equal(original.rows[0].public_acl_entry, false, 'PUBLIC has no direct ACL entry in the standard fixture');

  // This is the shape that triggered the old guard: default ACLs give anon and
  // authenticated table rights, while PUBLIC has no direct ACL row.
  const originalFailure = await db.query(`
    select has_table_privilege('anon', 'public.evaluations', 'SELECT')
        or has_table_privilege('anon', 'public.evaluations', 'INSERT')
        or has_table_privilege('anon', 'public.evaluations', 'UPDATE')
        or has_table_privilege('anon', 'public.evaluations', 'DELETE')
        or has_table_privilege('anon', 'public.evaluations', 'TRUNCATE')
        or has_table_privilege('anon', 'public.evaluations', 'REFERENCES')
        or has_table_privilege('anon', 'public.evaluations', 'TRIGGER')
        or has_table_privilege('authenticated', 'public.evaluations', 'TRUNCATE')
        or has_table_privilege('authenticated', 'public.evaluations', 'REFERENCES')
        or has_table_privilege('authenticated', 'public.evaluations', 'TRIGGER')
        or exists (
          select 1 from pg_class t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
          where t.oid = 'public.evaluations'::regclass and a.grantee = 0
        ) as old_guard_fails
  `);
  assert.equal(originalFailure.rows[0].old_guard_fails, true, 'original guard fails against Supabase-style defaults');

  await db.exec(aclBlock);
  const corrected = await db.query(`
    select has_table_privilege('anon', 'public.evaluations', 'SELECT') as anon_select,
           has_table_privilege('anon', 'public.evaluations', 'INSERT') as anon_insert,
           has_table_privilege('anon', 'public.evaluations', 'UPDATE') as anon_update,
           has_table_privilege('anon', 'public.evaluations', 'DELETE') as anon_delete,
           has_table_privilege('anon', 'public.evaluations', 'TRUNCATE') as anon_truncate,
           has_table_privilege('anon', 'public.evaluations', 'REFERENCES') as anon_references,
           has_table_privilege('anon', 'public.evaluations', 'TRIGGER') as anon_trigger,
           has_table_privilege('authenticated', 'public.evaluations', 'SELECT') as auth_select,
           has_table_privilege('authenticated', 'public.evaluations', 'INSERT') as auth_insert,
           has_table_privilege('authenticated', 'public.evaluations', 'UPDATE') as auth_update,
           has_table_privilege('authenticated', 'public.evaluations', 'DELETE') as auth_delete,
           has_table_privilege('authenticated', 'public.evaluations', 'TRUNCATE') as auth_truncate,
           has_table_privilege('authenticated', 'public.evaluations', 'REFERENCES') as auth_references,
           has_table_privilege('authenticated', 'public.evaluations', 'TRIGGER') as auth_trigger,
           has_table_privilege('service_role', 'public.evaluations', 'TRUNCATE') as service_role_truncate,
           (select count(*) from pg_class t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
            where t.oid = 'public.evaluations'::regclass and a.grantee = 0) as public_acl_count
  `);
  assert.deepEqual(corrected.rows[0], {
    anon_select: false, anon_insert: false, anon_update: false, anon_delete: false,
    anon_truncate: false, anon_references: false, anon_trigger: false,
    auth_select: true, auth_insert: true, auth_update: true, auth_delete: true,
    auth_truncate: false, auth_references: false, auth_trigger: false,
    service_role_truncate: true, public_acl_count: 0,
  });
  const maintain = await db.query(`
    select has_table_privilege('anon', 'public.evaluations', 'MAINTAIN') as anon_maintain,
           has_table_privilege('authenticated', 'public.evaluations', 'MAINTAIN') as auth_maintain
  `);
  assert.deepEqual(maintain.rows[0], { anon_maintain: false, auth_maintain: false });
  console.log('PASS: Supabase-style default grants reproduce the original precondition failure and normalize to authenticated CRUD only.');
} finally {
  await db.close();
}

const publicDefaultDb = await fixture({ publicDefault: true });
try {
  await publicDefaultDb.exec(aclBlock);
  const publicPrivileges = await publicDefaultDb.query(`
    select (select count(*) from pg_class t cross join lateral aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
            where t.oid = 'public.evaluations'::regclass and a.grantee = 0) as public_acl_count,
           has_table_privilege('anon', 'public.evaluations', 'SELECT') as anon_select
  `);
  assert.deepEqual(publicPrivileges.rows[0], { public_acl_count: 0, anon_select: false });
  console.log('PASS: PUBLIC defaults are removed only when catalogued in pg_default_acl.');
} finally {
  await publicDefaultDb.close();
}

const customGrantDb = await fixture({ anonDefault: false });
try {
  await customGrantDb.exec('grant select on public.evaluations to anon;');
  await assert.rejects(customGrantDb.exec(aclBlock), /anon has a non-default or grantable evaluations privilege/);
  console.log('PASS: unexpected anon grant not represented by pg_default_acl fails closed.');
} finally {
  await customGrantDb.close();
}

const customPublicGrantDb = await fixture({ anonDefault: false });
try {
  await customPublicGrantDb.exec('grant select on public.evaluations to public;');
  await assert.rejects(customPublicGrantDb.exec(aclBlock), /PUBLIC has a non-default or grantable evaluations privilege/);
  console.log('PASS: unexpected PUBLIC grant not represented by pg_default_acl fails closed.');
} finally {
  await customPublicGrantDb.close();
}

const inheritedGrantDb = await fixture({ anonDefault: false });
try {
  await inheritedGrantDb.exec('create role evaluation_reader; grant select on public.evaluations to evaluation_reader; grant evaluation_reader to anon;');
  await assert.rejects(inheritedGrantDb.exec(aclBlock), /anon or authenticated retains effective table privileges outside the repository model/);
  console.log('PASS: inherited anon privileges remain a hard failure after direct default grants are revoked.');
} finally {
  await inheritedGrantDb.close();
}
