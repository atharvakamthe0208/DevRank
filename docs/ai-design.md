# AI design

AI integration lives in `apps/api/src/modules/ai`; prompts, provider calls, credentials, and output validation stay server-side. The API uses LangChain's `ChatGroq` structured-output integration. AI receives a bounded view of a persisted deterministic evaluation and returns explanations; it never calculates or updates scores, weights, status, or scoring version.

## Evaluation analysis endpoint

`POST /api/evaluations/:id/ai-analysis` accepts no request fields. It requires a valid Supabase bearer token and an approved recruiter profile. The API loads the evaluation using the authenticated recruiter's ownership scope. The response is either:

- `200 { status: "completed", evaluation, analysis }`: the original persisted evaluation plus a separate validated AI explanation.
- `200 { status: "insufficient_evidence", evaluation, analysis: null }`: returned without contacting Groq when deterministic scoring has no overall score or usable evidence.

Analysis includes a summary, evidence-referenced strengths and weaknesses, role relevance, and evidence-referenced recommendations. References must match supplied evidence IDs or the existing scoring category identifiers. It does not provide a hiring decision. Invalid provider output returns `502 AI_INVALID_RESPONSE`; missing credentials returns `503 AI_NOT_CONFIGURED`; provider authentication, network, and rate-limit failures return controlled `503` errors. Timeouts and transient provider failures are bounded. No AI output is persisted, so provider failures cannot modify a stored evaluation.

Set these variables in `apps/api/.env` (never in the Vite app):

```dotenv
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b
AI_TIMEOUT_MS=12000
```

The API can start without `GROQ_API_KEY`; only the analysis endpoint is unavailable until configured. Never log or expose the key. Automated tests mock the provider and do not require a live Groq credential.

## Recruiter presentation

After running a persisted evaluation, recruiters can choose **Generate AI analysis** on the evaluation page. The web client posts an empty JSON object to the authenticated `POST /api/evaluations/:id/ai-analysis` endpoint and validates the response with `aiAnalysisResponseSchema`. It presents the summary, cited strengths and weaknesses, role relevance, recommendations, and supporting evidence descriptions. References are resolved against the persisted evaluation's evidence and category records; unknown references are not displayed as source material.

The UI reports insufficient evidence when the API returns `analysis: null`, and shows a retry action for provider or network errors. Missing API configuration is called out without exposing provider details. AI output remains explanatory and does not change deterministic scores or create a hiring recommendation outside the evidence-referenced recommendations in the shared contract.
