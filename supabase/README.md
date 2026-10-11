# Supabase

Version-controlled database migrations belong in `migrations/`. The schema and recruiter authorization migrations are versioned proposals; apply them in timestamp order after reviewing the target project's existing constraints, grants, and RLS policies. Use Supabase Auth user IDs as references rather than duplicating credentials. The app and API use the publishable/anon key with user sessions; no service-role key is used. See `../docs/authentication.md` for setup and first-admin provisioning.
