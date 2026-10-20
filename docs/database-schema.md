# Database schema

The initial schema and candidate API fields are versioned in `supabase/migrations/`; recruiter approval and admin review are added by `20261011100000_recruiter_auth.sql` and `20261011110000_recruiter_admin_approval.sql`. The live database was not inspected or modified during this task.

It defines:

- `profiles`, keyed directly to `auth.users.id`; Supabase's managed auth table is not duplicated.
- New public signup profiles are fixed to `recruiter` and `pending`; `admin` is reserved for one-time project-owner provisioning. Admin decisions are database-checked and audited.
- `candidates`, owned by an auth user and separate from recruiter profile details. The API supports permanent owner-scoped deletion: platform evidence and evaluations cascade from the candidate, and the deletion routine first removes comparison membership to satisfy the restrictive evaluation reference. Comparison containers remain.
- `platform_evidence`, with raw and normalized JSON kept separate and source availability recorded.
- `role_profiles`, with owner-scoped JSON weights and no seeded/final weight values.
- `evaluations` and `category_scores`, linked to candidates/roles owned by the same recruiter; category identifiers remain open pending shared-contract agreement.
- `ai_analyses`, stored separately from deterministic scores.
- `comparisons` and `comparison_candidates`, owner-scoped with optional evaluated candidate links.
- `audit_logs`, minimal append-only metadata without copying evidence or secrets.

RLS is enabled on the workspace tables. Existing policies remain; restrictive policies additionally require `auth.uid()` ownership and approved recruiter status, preventing older permissive policies from bypassing access checks. Admin review is mediated by database functions that verify the caller's confirmed, approved admin profile. The API verifies tokens with Supabase Auth and uses the public key plus the caller's JWT, not a service-role key. Migrations still need review and application to the target Supabase project.
