# Resume screening API

The screening API is implemented, but the reported persistence error had a second confirmed cause: read-only metadata requests to the configured Supabase project returned PostgREST `PGRST205` for `screening_sessions` and `resume_screenings`; Storage returned `NoSuchBucket` for `private-resumes`. No rows or files were read during diagnosis. The schema and bucket migrations have not been applied to that project. The controller now maps missing-table/column errors to migration-specific messages. The upload route accepts `jobTitle`, `jobDescription`, and repeated `resumes` multipart file fields; saved details are retrieved from `GET /api/screenings/:id`.

## Processing flow

- Both endpoints require the existing Supabase bearer-token authentication and approved-recruiter middleware.
- The upload accepts at most 20 PDF/DOCX files, each at most 10 MB. Multer writes to a per-request OS temporary directory that is removed after the response; uploads are then stored in the private `private-resumes` Supabase bucket.
- Server-side MIME and file-signature checks precede parsing. Text is extracted with `pdf-parse` and Mammoth. Scanned/image-only PDFs are reported as failed because OCR is not enabled.
- Groq extracts explicit job requirements and evaluates each resume against them. All provider output is Zod-validated. A positive match must cite an exact excerpt present in the extracted resume. Candidate names are shown only when the proposed name matches a deterministic, verified name heading or explicit name label in the resume text.
- The deterministic `resume-job-match-1.0.0` scorer calculates the result; AI cannot provide or change numerical scores. Unsupported excerpts become insufficient evidence. Individual files can fail while the rest of the batch completes.
- The recruiter-scoped Supabase JWT is used to upload private resume files and create owner-scoped session/result records. The server-only worker claims persisted `screening_jobs` using `claim_screening_jobs`, processes two resumes concurrently per bounded claim, retries transient AI rate-limit/unavailable failures using the existing retry RPC (up to three retries), and updates each result independently. `GET /api/screenings/:id` remains recruiter-owner scoped and is polled by the frontend until terminal status.

## Required configuration and database setup

- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `apps/api/.env`.
- `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/.env` for the server-side durable screening worker. It must never be added to frontend env files or logged.
- `GROQ_API_KEY` in `apps/api/.env` to extract requirements and evaluate resumes. `GROQ_MODEL` and `AI_TIMEOUT_MS` use existing defaults if unset.
- Apply pending migrations in timestamp order, including `20261017000000_bulk_resume_screening.sql`, `20261017130000_add_resume_screening_persistence.sql`, and `20261019000000_screening_idempotency.sql`. They create screening tables, owner-scoped RLS, the private bucket, and request idempotency. Do not make the bucket public. No candidate, evaluation, evidence, or recruiter schemas are changed.
- The migration already defines the private queue table, claim RPC, and retry RPC; no schema migration is added by this change. The API worker must run continuously and requires the service-role key.

## Limitations

Extracted resume text is not persisted; only the private original file, a verified candidate name, and evidence-grounded evaluation output are saved. There is no OCR or automatic retention/deletion schedule. Define and implement a retention/deletion policy before production use. The Groq provider receives job/resume text; obtain appropriate data-processing approval before sending candidate PII to a third party.

## Local verification

```sh
npm run build --workspace @devrank/contracts
npm run build --workspace @devrank/api
npm run build --workspace @devrank/web
npm run test --workspace @devrank/api
npm run test --workspace @devrank/web
```

Link the Supabase CLI to the intended project and run `npx supabase db push` to apply pending migrations in order, or execute the pending SQL migration files in timestamp order in the Supabase SQL Editor. Then run the API and Vite frontend using the repository's normal `npm run dev` workflow.
