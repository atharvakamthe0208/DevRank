# Resume screening comparison and reports

The screening results page now supports comparison and exports directly from the saved screening result API. No new database tables or migration are needed.

## Endpoints

- `GET /api/screenings/:id` reads the saved session and resume outcomes.
- `GET /api/screenings/:id/ranking` returns the session's saved results with an API-computed descending rank, including failed and unscored results separately.
- `POST /api/screenings/:id/compare` accepts `{ "resumeIds": ["...", "..."] }` and returns selected completed candidate details, a same-session ranking, and an unranked list.
- `POST /api/screenings/:id/report` accepts the same body and returns a validated snapshot containing the saved screening details and selected IDs.

All routes require an authenticated, approved recruiter. The API uses the recruiter's Supabase access token for reads, so existing row-level security and screening ownership policies scope the session. IDs are checked against the requested session, and failed resumes cannot be selected for comparison. Scores are read from persisted deterministic evaluations; absent scores remain unranked.

The ranking sorts all successfully scored resumes in that screening context, descending by deterministic resume job-match score. Equal scores share a rank. Failed and unscored resumes are listed separately. This is decision support, not a hiring decision.

## Downloads

CSV is assembled from the validated report snapshot returned by the API and includes persisted status, candidate label, score, matched requirements, missing/unsupported requirements, and processing errors. The PDF action opens the browser print dialog for a print-optimized version of the report; choose **Save as PDF** in that dialog. This uses browser-native PDF support because the repository did not contain a PDF library. Candidate excerpts are included only when present in the saved, validated result. Private storage paths and resume files are never included.

The ranking table uses a compact score-color hint: 75–100 high, 50–74 medium, and below 50 low. These bands are presentation-only and are not validated hiring criteria. The table also supports name/filename search, name or descending-score sorting, select-all for eligible visible rows, and an expandable details view for evidence.

## Remaining live setup

The pre-existing bulk screening migration and private `private-resumes` Storage bucket/policies must be applied before new screening submissions can persist. These endpoints do not require any additional schema changes. Live Supabase behavior still depends on applying those migrations and configuring the project URL and public anon key for the API.
