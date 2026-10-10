# Database schema

The proposed initial schema is in `supabase/migrations/20261010000000_initial_devrank_schema.sql`. It is prepared for review and has **not** been applied to a Supabase project.

It defines:

- `profiles`, keyed directly to `auth.users.id`; Supabase's managed auth table is not duplicated.
- `candidates`, owned by an auth user and separate from recruiter profile details.
- `platform_evidence`, with raw and normalized JSON kept separate and source availability recorded.
- `role_profiles`, with owner-scoped JSON weights and no seeded/final weight values.
- `evaluations` and `category_scores`, linked to candidates/roles owned by the same recruiter; category identifiers remain open pending shared-contract agreement.
- `ai_analyses`, stored separately from deterministic scores.
- `comparisons` and `comparison_candidates`, owner-scoped with optional evaluated candidate links.
- `audit_logs`, minimal append-only metadata without copying evidence or secrets.

RLS is enabled on all tables. Policies limit records to `auth.uid()` and cross-table foreign keys enforce common ownership. `authenticated` grants are limited to required operations; AI outputs and audit rows have no update/delete policies. The API is configured to use the public Supabase key plus a verified user JWT, not a service-role key. Review retention, audit-event writers, and final category keys with the team before applying the migration. No destructive or live database operation was run; connectivity remains unverified without valid credentials.
