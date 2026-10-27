# Recruiter authentication and admin approval

DevRank is recruiter-only. Public signup creates a Supabase Auth user and exactly one profile with role `recruiter` and status `pending`. Signup metadata can supply only `full_name`, saved to `profiles.display_name`. No signup field or request can grant approval or administrator access. A recruiter must confirm email and be approved before accessing dashboard pages or candidate APIs.

## Apply the database migrations

Review the existing schema and apply migrations in timestamp order to the intended Supabase project:

1. `supabase/migrations/20261010000000_initial_devrank_schema.sql`
2. `supabase/migrations/20261011000000_candidate_api_fields.sql`
3. `supabase/migrations/20261011100000_recruiter_auth.sql`
4. `supabase/migrations/20261011110000_recruiter_admin_approval.sql`

The final two migrations do not drop tables or application data. The recruiter migration adds profile status, signup triggers, and restrictive approval RLS policies. It preserves existing policies while adding restrictive policies that require ownership and approved recruiter status, so older permissive policies cannot bypass the new gate. It also removes anonymous/public table grants on protected tables. Before applying, inspect any nonstandard constraints or grants in the target project; invalid preexisting role/status values make the migration fail and roll back.

## Supabase Auth dashboard

1. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy `anon` key). Use those values in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `apps/web/.env`, and in `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `apps/api/.env`. Also set `VITE_API_BASE_URL=http://localhost:3000/api` and `WEB_ORIGIN=http://localhost:5173` in their respective workspace env files. The API loads `apps/api/.env` explicitly, while Vite reads `apps/web/.env`; root `.env` is not loaded by these workspace scripts. A missing API `SUPABASE_ANON_KEY` causes `/api/auth/me` to return `AUTH_CONFIGURATION_MISSING`; copy the public publishable/anon key into the API variable, then restart the API. Never use a secret/service-role key in the browser or these environment examples.
2. In **Authentication → Providers → Email**, enable email/password and keep email confirmation enabled. Set the minimum password length to at least 12 characters, matching the signup/reset validation in the app.
3. In **Authentication → URL Configuration**, use `http://localhost:5173` as the local Site URL and allow `http://localhost:*/auth/callback` and `http://localhost:*/reset-password` so confirmation/reset links return to the active Vite port. Supabase supports `*` wildcards in redirect URL allow-list patterns; keep production entries exact HTTPS URLs. Signup's `emailRedirectTo` and password reset's `redirectTo` use `window.location.origin`; the Supabase JS client persists sessions and detects confirmation query/hash data on `/auth/callback`.
4. Verify the confirmation and reset email templates. Configure custom SMTP under **Project Settings → Authentication → SMTP Settings** for production delivery; no SMTP credentials are read from or stored in this repository.

This local checkout has ignored workspace `.env` files, and the API/web settings were checked without displaying their key values. The configured URL host is present in both workspace files; the live Supabase dashboard settings, migration state, redirect allow-list, and SMTP delivery could not be verified from this repository. Do not assume email delivery or profile trigger setup works until you test confirmation and password reset using a non-production account.

## Provision the first administrator

There is no public admin signup or automatic first-user promotion. First, the project owner creates an account through `/signup` and confirms its email. After the four migrations are applied, the **project owner** performs this one-time bootstrap in the trusted Supabase SQL Editor, replacing the address with the owner's verified email:

```sql
update public.profiles
set role = 'admin', approval_status = 'approved'
where id = (
  select id from auth.users
  where lower(email) = lower('owner@example.com')
    and email_confirmed_at is not null
)
and role = 'recruiter'
and approval_status = 'pending'
returning id, display_name, role, approval_status;
```

Verify that exactly the intended owner account is returned. Do not run this for other users. Sign in as that owner and open `/admin/recruiters`; future recruiter applications can be approved or rejected in the admin panel without more SQL. The panel writes an audit event for each decision. Database functions independently require an approved, email-confirmed admin, accept only `approved` or `rejected`, restrict targets to pending recruiter profiles, and prevent self-decisions. Recruiters cannot alter their own role or status, and administrators are not managed through the public panel.

## Test locally

1. Copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`, then fill in your own Project URL and public key locally. Do not paste secrets into chat or commit populated env files.
2. Apply migrations in order, configure Auth redirects/confirmation, and run `npm run dev` from the repository root.
3. Open `http://localhost:5173/signup`, create a recruiter account, then confirm the email using Supabase's message. The account should see the pending-access page.
4. Provision the first administrator as above. As that administrator, open `/admin/recruiters`, approve the test recruiter, and confirm it appears as approved.
5. Refresh the recruiter session or sign in again. The recruiter should reach `/dashboard`; `/api/candidates` should reject pending, rejected, unconfirmed, or signed-out users. Reject another test applicant and verify the rejected message and API denial.
6. Test **Log out**, **Forgot password**, the `/reset-password` link, an expired confirmation/reset link, and direct visits to protected pages after logout.

### Automated recruiter approval database tests

Run `npm run test:recruiter-approval:db` to execute the four migrations listed above in a fresh in-memory PGlite database. The test creates synthetic Auth rows, adds broad legacy permissive policies before the recruiter-auth migration, and exercises the actual SQL signup trigger, admin decision functions, grants, `updated_at` trigger, audit insert, and RLS behavior. It never connects to a local or hosted Supabase project.

PGlite uses PostgreSQL semantics for the tested SQL, but this harness supplies a small `auth.users` table and `auth.uid()` function. It does not exercise Supabase Auth confirmation flows, PostgREST RPC/session behavior, hosted project grants/extensions, or independent concurrent connections. The paired API auth/admin tests use mocked verified identities and RPC responses; they are not database integration tests. The repository currently has no full local Supabase Auth/RLS integration suite. For end-to-end confirmation and access checks, follow steps 1–6 above using only a disposable local Supabase stack or a dedicated development project.

The dashboard currently contains sample candidate displays; existing candidate CRUD is separately protected and RLS-scoped. These authentication changes do not replace the sample dashboard data with candidate persistence.
