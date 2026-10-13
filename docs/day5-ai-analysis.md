# Day 5 — Five-category scoring and evidence-grounded AI analysis

## Summary and approval status

The active scoring contract now contains exactly five categories. `communication_skills` is not accepted as an active category. Structured-interview evidence maps to `null` in `config/evidence-category-mapping.json`; Day 3 processing reports it as unmapped instead of assigning it to another score. Historical v1 records are supported only by a read-only compatibility schema.

The category removal changes both the scoring policy and the evaluation response shape. The active scoring and contract schema versions are therefore `2.0.0`. No SRS was present in the repository, and no team sign-off for the category change, revised preliminary weights, or scoring policy was found. Confirm the intended SRS/product requirement with the team before using these criteria for hiring.

## Active categories

| ID | Display name | Role in scoring |
|---|---|---|
| `technical_skills` | Technical Skills | Role-relevant technical knowledge supported by mapped evidence. |
| `problem_solving_dsa` | Problem-Solving and DSA | Structured problem-solving and algorithmic evidence. |
| `relevant_project_experience` | Relevant Project Experience | Relevant project/portfolio evidence. |
| `practical_assessment_performance` | Practical Assessment Performance | Completed work-sample evidence. |
| `learning_adaptability` | Learning Ability and Adaptability | Evidence of learning or adapting to changed constraints. |

No replacement category was added. Communication Skills is not scored or inferred. A structured interview is preserved by the evidence-processing result as unmapped and is excluded from numeric scoring.

## Preliminary role-weight changes

The Day 4 weights assigned 10 percentage points (Software Developer), 10 (AI/ML Engineer), and 15 (Data Analyst) to the removed category. Removing those values left totals of 90, 90, and 85. The current configuration proportionally rescales each role's remaining weights to total 100, preserving their relative proportions. The algorithm calculates each exact proportional percentage, floors to hundredths, then distributes remaining hundredths by largest fractional remainder; category order breaks ties. All role values remain preliminary and unapproved.

| Category | Software Developer | AI/ML Engineer | Data Analyst |
|---|---:|---:|---:|
| Technical Skills | 27.78% | 27.78% | 23.53% |
| Problem-Solving and DSA | 22.22% | 16.67% | 17.65% |
| Relevant Project Experience | 22.22% | 22.22% | 23.53% |
| Practical Assessment Performance | 16.67% | 16.67% | 17.65% |
| Learning Ability and Adaptability | 11.11% | 16.66% | 17.64% |
| **Total** | **100.00%** | **100.00%** | **100.00%** |

This is an explicit normalization of the prior preliminary ratios, not a claim that the new weights are approved hiring policy. The scorer still averages valid normalized evidence per category, rounds category and overall values to two decimals, and omits the overall score unless all five categories have scoreable evidence. Missing evidence is never zero.

## Versioning and compatibility

- `schemaVersion` changed from `1.0.0` to `2.0.0` because the evaluation response now requires five categories rather than six.
- `scoringVersion` changed from `1.0.0` to `2.0.0`; new outputs and `config/role-weights.json` identify this version.
- Only scoring version `2.0.0` is supported for new calculations. Requests for v1 or unknown versions fail safely.
- `legacyEvaluationResponseV1Schema` is a separate read-only validator used by persisted evaluation responses. It allows old v1 snapshots to remain readable; it is not used for candidate inputs, current scoring, or current weights.
- Historical formula/config snapshots are not archived in this repository. Retained v1 output is readable, but scores cannot be recalculated or historically reproduced from this code.
- Existing role profiles stored with six weights do not match the v2 contract and currently fail role configuration validation (HTTP 422). No database migration or automatic rewrite was made; an owner must explicitly update those stored profiles before evaluating with them.
- Shared consumers need to adopt the v2 contract. The evaluation response adds optional `aiAnalysis`; the existing `aiExplanation` field remains for compatibility. Confirm API/client owners are ready for the category/schema version change before rollout.

## AI service architecture and configuration

`apps/api/src/modules/ai/index.ts` calls Groq's OpenAI-compatible chat-completions endpoint using the Node runtime's built-in `fetch`; no package was added. The model is selected through backend-only `GROQ_MODEL`. `GROQ_API_KEY` stays in API environment configuration and must not be placed in Vite/browser variables. `AI_ANALYSIS_TIMEOUT_MS` defaults to 10 seconds and is bounded to 100–60,000 ms. These names are documented in `apps/api/.env.example`.

The existing evaluation repository invokes the optional analysis service after deterministic scoring and attaches the result under `aiAnalysis`. This does not add an API route. If analysis is missing or fails, the evaluation's deterministic fields and database write continue; analysis status is separate from evaluation status. The API's existing evaluation create route is the current integration point.

The provider request includes only:

- Target role, deterministic evaluation status/version, category IDs/statuses/scores, and missing category IDs.
- Available evidence IDs, type, category, verification status, normalized value when present, and a bounded description.

It excludes candidate IDs, evidence source labels, raw `originalValue`, timestamps, and unrelated stored profile fields. Descriptions have email/URL/phone-like strings redacted and are shortened to 1,200 characters; at most 100 evidence items are submitted. Candidate-controlled text remains untrusted even after redaction.

## Structured analysis output

The shared Zod contract in `packages/contracts/src/ai-analysis.ts` accepts a successful analysis with:

- `status`: `completed` or `insufficient_evidence`, required to match deterministic evaluation status.
- `summary`: concise evidence-limited evaluation summary.
- `strengths` and `developmentAreas`: findings with a non-empty `claim` and one or more evidence IDs.
- `roleSuitability`: a cited finding or `null` when no evidence-based explanation is appropriate.
- `evidenceReferences`: the exact unique set of references used by findings.
- `limitations`: explicit uncertainty or missing information.

The `aiAnalysisResultSchema` also represents controlled `unavailable` and `failed` states by a small reason code; no fake findings are created in those states. Strict Zod validation rejects extra properties such as scores, invalid types/statuses, missing fields, duplicate references, and unsupported statuses. The backend additionally verifies that every cited ID belongs to available evidence in this evaluation. Unknown references are rejected, not removed or replaced. The shared evaluation response checks that successful AI status does not overstate deterministic evidence status.

There are no numeric score or weight fields in the AI analysis schema. AI output is returned as a separate object and never merged into category scores or the overall score. The recruiter remains responsible for the decision.

## Grounding and failure behavior

Candidate evidence is serialized in a separate user message, not interpolated into system instructions. The system message treats every supplied string—including repository/README-derived descriptions and IDs—as untrusted data, prohibits unrelated actions and sensitive-trait inference, requires evidence references for each factual finding, and instructs the model not to create scores or hiring decisions. The response validator only accepts references from the current available-evidence list.

| Situation | Analysis result | Deterministic result |
|---|---|---|
| Missing key or model setting | `unavailable / not_configured`; no provider call | Preserved |
| All categories lack scoreable evidence (provider configured) | `insufficient_evidence`, empty findings, explicit missing-category limitations; no model call | Preserved, with no overall score |
| Provider timeout | `unavailable / timeout` | Preserved |
| Provider rate limit | `unavailable / rate_limited` | Preserved |
| Provider/network/server failure | `unavailable / provider_error` | Preserved |
| Invalid provider envelope or malformed/empty JSON | `failed / malformed_response` | Preserved |
| Missing fields, wrong types/status, or schema violation | `failed / invalid_output` | Preserved |
| Evidence reference not in this evaluation | `failed / invalid_evidence_reference` | Preserved |
| Invalid evaluation input | `failed / invalid_evaluation` | No AI analysis is attached; invalid input is not scored |

Failure logs contain only a reason code and, for HTTP responses, the status code. They do not log prompts, candidate evidence, API keys, provider bodies, stack traces, or raw exceptions. The repository has an additional catch around the optional analyzer so an unexpected analyzer exception also becomes a controlled unavailable result.

Prompt instructions and structural validation reduce risk; they cannot guarantee a model will never hallucinate or be influenced by adversarial content. A schema-valid claim can still be misleading. Recruiters must inspect cited evidence and limitations. No live provider request was made in tests; provider behavior is mocked.

## Tests and verification

`apps/api/test/ai-analysis.test.ts` mocks `fetch` and covers valid structured output, prompt-injection placement, PII redaction, unknown evidence IDs, malformed/empty output, missing fields, invalid types, missing configuration, timeout, rate limit, provider failure, empty evidence, invalid evaluation, and preservation of deterministic scores when analysis fails.

Scoring and contract tests cover exactly five active categories, rejection of the removed category, valid normalized weights, score boundaries, missing evidence, structured-interview unmapped reporting, v2 version behavior, and read-only v1 snapshot compatibility. Full command results are recorded after final verification below.

## Limitations, blockers, and coordination

- The repository contained no SRS. The SRS requirement to remove this category, if any, cannot be verified; product/team owners must reconcile the change with the approved requirements.
- No team approval for current categories or recalculated weights is recorded. The values remain preliminary.
- Existing database role-profile records with six-category weights need an explicit update before they pass v2 validation. No migration or silent transformation was performed.
- Groq credentials/model are not configured or tested live. Availability, cost, provider retention, model choice, and deployment egress need owner/privacy review.
- The AI service is integrated in the evaluation repository, but there is no new endpoint and no frontend display for `aiAnalysis`. API/web consumers should coordinate the contract change before relying on it.
- There is no historical v1 scorer/config snapshot archive; legacy data can be displayed, not recalculated.
- Input redaction is pattern-based and not a full personal-data detector. Prompt instructions do not guarantee truth. The feature is decision support only and is not validated for hiring use.
