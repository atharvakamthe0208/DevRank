# CSV candidate import

Recruiters can import candidates from a UTF-8 CSV on the Candidates page. The workflow supports column mapping, an editable preview, validation, owner-scoped potential-duplicate review, explicit confirmation, and per-row outcomes. Candidate creation is independent of GitHub and LeetCode synchronization; failed syncs do not roll back an import or replace saved platform evidence.

## Input and duplicate behavior

The first row contains headers. Common header aliases include candidate name, email, GitHub username/profile URL, and LeetCode username/profile URL. Name is required; contact and profile fields are optional. Only recognized HTTPS profile URLs are converted to usernames. The importer accepts files up to 1 MiB, 500 rows, 50 columns, and 500 characters per cell. Quoted fields support commas and escaped quotes. Malformed rows remain visible for correction and are not sent until valid.

Potential matches are owner-scoped and use case-insensitive exact matches on email, GitHub username, or LeetCode username. Names are not deduplication keys, and these fields are not global uniqueness constraints. The default skips potential matches; a recruiter may explicitly retain them as additional records. The importer never overwrites a matched candidate or their evidence. Rows without these identifiers cannot be matched by this heuristic.

## Durable retry protection

The migrations `20261020211405_candidate_bulk_import_idempotency.sql` and `20261021093336_candidate_bulk_import_sha256_digest.sql` add an owner-scoped receipt and transactional import RPC. Receipts store the request digest, digest version, and row outcomes/IDs, not uploaded CSV contents. Version 1 receipts retain their original MD5 comparison so valid historical retries continue to work. New receipts use version 2 SHA-256 over PostgreSQL's canonical `jsonb` text representation plus the duplicate policy. Reusing a key with an altered payload or duplicate policy is rejected. A database uniqueness key and row locks prevent concurrent calls from creating the same batch twice.

## Verification

Run the isolated SQL coverage with `npm run test:candidate-import:db`. It uses disposable PGlite and covers digest versions, equivalent canonical JSON, replay, key mismatch, ownership, duplicates, and row failures. To test real local Supabase Auth/PostgREST behavior, start the local stack and apply migrations locally only:

```powershell
.\node_modules\.bin\supabase start
.\node_modules\.bin\supabase migration up --local
.\node_modules\.bin\supabase status
```

Confirm all reported endpoints are loopback. Supply the local API URL, anon key, and service-role key to the integration test process without committing them, then run `npm run test:candidate-import:local`. That script refuses a non-loopback Supabase URL and cleans up its temporary Auth users. Use the web app against the same disposable stack to check upload, mapping, edits, duplicate decisions, confirmation, row results, and safe retries. Browser verification is manual and is not covered by automated tests. Never link or push these migrations to a hosted project as part of local testing.
