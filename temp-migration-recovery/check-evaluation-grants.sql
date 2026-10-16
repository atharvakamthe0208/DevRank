SELECT
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'evaluations'
ORDER BY grantee, privilege_type;

SELECT
  has_table_privilege('anon', 'public.evaluations', 'SELECT') AS anon_select,
  has_table_privilege('anon', 'public.evaluations', 'INSERT') AS anon_insert,
  has_table_privilege('anon', 'public.evaluations', 'UPDATE') AS anon_update,
  has_table_privilege('anon', 'public.evaluations', 'DELETE') AS anon_delete,
  has_table_privilege('authenticated', 'public.evaluations', 'SELECT') AS auth_select,
  has_table_privilege('authenticated', 'public.evaluations', 'INSERT') AS auth_insert,
  has_table_privilege('authenticated', 'public.evaluations', 'UPDATE') AS auth_update,
  has_table_privilege('authenticated', 'public.evaluations', 'DELETE') AS auth_delete;

SELECT
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC'
       ELSE pg_get_userbyid(acl.grantee)
  END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class AS c
CROSS JOIN LATERAL aclexplode(
  COALESCE(c.relacl, acldefault('r', c.relowner))
) AS acl
WHERE c.oid = 'public.evaluations'::regclass
ORDER BY grantee, privilege_type;
