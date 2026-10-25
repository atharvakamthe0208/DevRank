# CSV candidate import

Recruiters can import candidates from a UTF-8 CSV on the Candidates page. The workflow supports column mapping, an editable preview, validation, owner-scoped potential-duplicate review, explicit confirmation, and per-row outcomes. Candidate creation is independent of GitHub and LeetCode synchronization; failed syncs do not roll back an import or replace saved platform evidence.

## Input and duplicate behavior

The first row contains headers. Common header aliases include candidate name, email, GitHub username/profile URL, and LeetCode username/profile URL. Name is required; contact and profile fields are optional. Only recognized HTTPS profile URLs are converted to usernames. The importer accepts files up to 1 MiB, 500 rows, 50 columns, and 500 characters per cell. Quoted fields support commas and escaped quotes. Malformed rows remain visible for correction and are not sent until valid.

Potential matches are owner-scoped and use case-insensitive exact matches on email, GitHub username, or LeetCode username. Names are not deduplication keys, and these fields are not global uniqueness constraints. The default skips potential matches; a recruiter may explicitly retain them as additional records. The importer never overwrites a matched candidate or their evidence. Rows without these identifiers cannot be matched by this heuristic.

## Importing Google Forms responses

1. In Google Sheets, open the form response spreadsheet and select its response tab (usually **Form Responses 1**).
2. Choose **File → Download → Comma-separated values (.csv)**. Keep the header row in the export.
3. In DevRank, open **Candidates → Import CSV**, choose the downloaded `.csv`, and check the detected name, email, GitHub, and LeetCode column mappings. Header matching ignores case and punctuation and recognizes the Google Forms labels `Full Name`, `Gmail Address`, `GitHub Username or Profile URL`, and `LeetCode Username or Profile URL`. The `Timestamp` column is ignored.
4. Review each row. For a recognized Google Forms layout, missing name, email, GitHub, or LeetCode values are shown as row errors and that row is not sent to the API. Correct a value in the preview if appropriate or fix the source CSV and upload it again. The existing DevRank CSV behavior remains: name is required, while email and profile fields may be omitted.
5. Run the duplicate check, review potential matches, and confirm the import. Candidate fields go through the existing authenticated preview and idempotent bulk-import API. Re-importing the same candidate is handled by the existing workspace-scoped duplicate policy; existing candidate data is not overwritten.

### Resume PDF handling

The form response cell is a Drive URL, not PDF bytes. The preview recognizes known Drive URL formats and displays the link, but no file is fetched before confirmation. A recruiter may keep using CSV-only import or enable **Download and screen supported Drive PDF links** in the confirmation step. Automatic screening requires an approved recruiter to authorize a Google account that can access the uploaded files, plus a target job title and description. A URL is never treated as permission.

### Configure Google Drive access

1. Create/select a Google Cloud project, enable **Google Drive API**, configure the OAuth consent screen, and create an OAuth client with application type **Web application**.
2. Add the API callback URL as an authorized redirect URI. Locally it is exactly `http://localhost:3000/api/google-drive/callback`. In production use the deployed HTTPS API URL followed by `/api/google-drive/callback`. It must exactly match `GOOGLE_DRIVE_REDIRECT_URI`.
3. Request only `https://www.googleapis.com/auth/drive.readonly`. `drive.file` is narrower but cannot reliably read pre-existing Google Forms upload files by ID unless they were individually opened/shared to the app. Google classifies `drive.readonly` as a restricted scope; production use may require Google verification and a security assessment. Do not publish a public integration until the applicable Google requirements are met.
4. Copy `apps/api/.env.example` to `apps/api/.env` and configure `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, and the exact `GOOGLE_DRIVE_REDIRECT_URI`. Generate independent values for the state and encryption keys; never commit them:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))" # GOOGLE_DRIVE_STATE_SECRET
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))" # GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY
   ```

   The state secret must be at least 32 characters. The encryption key must be the base64 encoding of exactly 32 random bytes. Keep both, the client secret, and Supabase service-role key on the API server only. `WEB_ORIGIN` and any needed exact `WEB_ORIGINS` entry must match the frontend origin so the OAuth state can return to the correct DevRank window.
5. Apply `supabase/migrations/20261025000000_google_drive_connections.sql` to the intended Supabase project. The table has RLS enabled and grants no direct access to browser roles; the API uses its server-only service-role client to store AES-256-GCM encrypted refresh tokens.
6. Restart the API. In the CSV import dialog, click **Authorize Google Drive**, sign in as the form owner or an account that has actual access to the files, and grant the requested read-only permission. The OAuth authorization-code callback stores the encrypted refresh token on the server. Google may require adding the recruiter account as a test user while the consent screen is in Testing mode. Reconnect if the account revokes access or Google returns an expired/revoked refresh token.

Google's Drive API returns a file's bytes using `files.get` with `alt=media`. DevRank extracts only a validated file ID from known Google Drive URL patterns, requests metadata and download from fixed Google API hosts, checks the authorized account's download capability, enforces the existing 10 MiB upload limit, and checks the PDF signature. It never fetches a CSV-provided host. Unsupported, oversized, deleted, or inaccessible files do not cancel candidate creation.

### Import and screen

1. Export the response sheet as CSV and use the existing **Candidates → Import CSV** preview and duplicate check.
2. In the confirmation section, enable automatic screening, connect Drive, and enter the job title and the job description (at least 50 characters). Screening begins only after **Confirm import and screen resumes**. Leave the option unchecked for the existing CSV-only behavior.
3. DevRank imports candidate details first through the existing idempotent candidate endpoint. The API then downloads eligible PDFs in batches into a private server temporary directory and submits the files through the existing private-storage and durable screening-job pipeline. Temporary files are removed after the screening endpoint has copied them into the private Supabase bucket and queued their jobs. Screening sessions are capped at 20 files. Each file is explicitly associated with the created candidate ID after the API verifies that candidate belongs to the signed-in recruiter. It does not match by name or email. Resume bytes are never sent back to the browser.
4. The result panel reports candidate import and each resume's separate status (downloaded, queued/processing, completed, inaccessible, unsupported, or failed). Drive failures do not delete candidates. Existing queue retry controls remain available in Resume Screening for retryable evaluation failures. If a Drive link fails, fix file sharing or reconnect the account, then retry the import workflow; duplicate candidates remain protected by the existing duplicate check.
5. A completed result is attached to the candidate's unified report as part of the screening record. Review that report to confirm the correct resume is associated. Do not use a candidate's name to make an association.

Google Forms file-upload questions may require respondents to sign in to a Google Account. The authorizing recruiter must separately be allowed to download the resulting file; being able to open the CSV does not itself prove Drive file access. No candidate password is requested. Tokens stay server-side and resume bytes are kept in the existing private resume bucket, never in public storage or application logs.

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
