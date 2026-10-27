# Day 5 — Backend AI analysis

## Scoring contract

AI analysis uses a persisted deterministic evaluation under the active five-category scoring v2 contract. The deterministic scorer remains the only author of scores, category weights, scoring version, and evaluation status. AI provides a separate explanation and does not write to the evaluation record. AI failures do not alter the persisted result. Missing category evidence remains missing; it is not treated as zero. Historical six-category v1 snapshots are not sent to the active v2 analysis path.

## Endpoint

`POST /api/evaluations/:id/ai-analysis` accepts an empty JSON body (or no body). It requires a valid Supabase bearer token and an approved recruiter profile. The API loads the evaluation through the owner-scoped repository and does not accept candidate evidence or scores from the client.

The response is one of:

- `200 { "status": "completed", "evaluation": <persisted evaluation>, "analysis": <validated analysis> }`
- `200 { "status": "insufficient_evidence", "evaluation": <persisted evaluation>, "analysis": null }`

The analysis contains a concise summary, evidence-referenced strengths and weaknesses, role relevance, and evidence-referenced recommendations. Every reference must identify evidence included in the bounded provider input or an existing scoring category. The analysis does not provide a hiring decision. When evidence is insufficient, Groq is not called.

The API returns controlled errors for missing provider configuration, provider failures, and invalid structured output. These errors do not update or invalidate the persisted evaluation. The service uses LangChain `ChatGroq` structured output, performs backend schema and reference validation, and retries transient provider errors at most once. Candidate text is treated as untrusted prompt data, bounded, and scrubbed for common email, URL, and phone patterns before it is sent to Groq.

## Configuration

Set these values in `apps/api/.env`; do not place the API key in Vite or browser configuration:

```dotenv
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=openai/gpt-oss-120b
AI_TIMEOUT_MS=12000
```

The API can start without the key. AI requests return `503 AI_NOT_CONFIGURED` until it is set. Unit tests mock the provider and require no Groq credential. No live Groq request was used by the routine test suite.
