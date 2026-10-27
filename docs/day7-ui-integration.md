# Day 7 UI integration

## Delivered

- Added the recruiter Insights screen at `/dashboard/reports`, backed by the approved-recruiter `/api/dashboard`, `/api/evaluations/roles`, and `/api/rankings` endpoints and shared response schemas.
- Added comparison controls for two to five recent, supported evaluation runs using `POST /api/comparisons`. The UI submits only candidate and evaluation IDs; the API remains responsible for ownership, role, evidence, and scoring-configuration checks.
- Added loading, retryable error, empty, submission, and comparison result states. Incomplete evidence remains unscored; rankings display only the compatible results returned by the API.
- Renamed the workspace navigation item to Insights and made collapsed tablet navigation labels available through accessible names, focus, and hover tooltips.
- Linked the dashboard to the implemented Insights screen instead of stating that rankings are unavailable.

## Scope and limitations

Comparison choices use the most recent supported evaluation for each candidate from the API's ten-entry recent-activity window. A candidate without a recent evaluation is not available in this comparison picker. The API can reject comparisons across incompatible roles or scoring configurations; the UI reports that without attempting to alter the evaluation data.

Comparison and ranking still depend on the separately audited evaluation persistence schema. This UI does not apply or repair migrations and cannot make those endpoints available if the required columns are missing from the configured database. Role weights remain preliminary and results are decision support only.

## Verification

The root `npm run typecheck`, `npm test`, and `npm run build` validate this change. Tests use fixtures/mocks and do not contact a live Supabase project. The production build may report its existing JavaScript chunk-size warning.
