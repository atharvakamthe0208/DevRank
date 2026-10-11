# Proposed candidate evaluation API contract

## Current API and compatibility

The API currently exposes only `GET /health` and a JSON 404 response. There is no candidate evaluation route or existing evaluation request/response format to replace. The proposal below does not add a route or change `/health`; it defines the shared payload for owners to adopt after review. Frontend and backend owners must agree on the route, authentication, persistence, and rollout before an endpoint is implemented. This is a proposal, not team approval.

## Shared source of truth

Use the Zod schemas and inferred TypeScript types exported by `@devrank/contracts`: `candidateInputSchema`, `evidenceSchema`, `roleWeightConfigurationSchema`, and `evaluationResponseSchema`. Contract `schemaVersion` is `1.0.0`; the deterministic scoring configuration and outputs identify `scoringVersion: "1.0.0"`. The response schema accepts this field optionally for compatibility, while new scorer output always includes it. Candidate IDs are opaque strings. Role IDs and scoring category IDs are fixed enums. Evidence and AI explanations are separate fields; AI text never supplies or changes a numeric score. The contract intentionally carries no candidate name, email, demographic data, or other personal attributes.

## Proposed request

```json
{
  "candidateId": "synthetic-candidate-001",
  "targetRole": "software_developer",
  "evidence": [
    {
      "evidenceId": "c001-tech",
      "evidenceType": "technical_screen",
      "source": "Synthetic structured technical screen",
      "description": "Strong TypeScript and API fundamentals",
      "originalValue": "4/5 rubric",
      "normalizedValue": 80,
      "verificationStatus": "unverified",
      "categoryId": "technical_skills",
      "availability": "available"
    },
    {
      "evidenceId": "c001-dsa",
      "evidenceType": "coding_assessment",
      "source": "Synthetic coding sample",
      "description": "No assessment supplied",
      "verificationStatus": "unverified",
      "categoryId": "problem_solving_dsa",
      "availability": "missing"
    }
  ]
}
```

The example is illustrative and intentionally incomplete across six categories, so it must not produce an overall score. `observedAt` is an optional ISO timestamp. Raw `originalValue` is preserved only when available; `normalizedValue` is a 0–100 value produced by a documented deterministic normalization step. Missing evidence is represented by `availability: "missing"` and has no normalized value. Verification means source checking status, not a guarantee that a score is correct.

## Proposed response

```json
{
  "schemaVersion": "1.0.0",
  "scoringVersion": "1.0.0",
  "candidateId": "synthetic-candidate-001",
  "targetRole": "software_developer",
  "categoryScores": [
    { "categoryId": "technical_skills", "displayName": "Technical Skills", "score": 80, "confidence": 0.8, "status": "scored", "evidenceRefs": ["c001-tech"], "explanation": "The supplied screen supports this score." },
    { "categoryId": "problem_solving_dsa", "displayName": "Problem-Solving and DSA", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No problem-solving evidence supplied." },
    { "categoryId": "relevant_project_experience", "displayName": "Relevant Project Experience", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No project evidence supplied." },
    { "categoryId": "practical_assessment_performance", "displayName": "Practical Assessment Performance", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No work sample supplied." },
    { "categoryId": "communication_skills", "displayName": "Communication Skills", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No structured interview evidence supplied." },
    { "categoryId": "learning_adaptability", "displayName": "Learning Ability and Adaptability", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No learning example supplied." }
  ],
  "roleWeightsUsed": { "technical_skills": 25, "problem_solving_dsa": 20, "relevant_project_experience": 20, "practical_assessment_performance": 15, "communication_skills": 10, "learning_adaptability": 10 },
  "evidence": [{ "evidenceId": "c001-tech", "evidenceType": "technical_screen", "source": "Synthetic technical screen", "description": "Strong TypeScript and API fundamentals", "originalValue": "4/5 rubric", "normalizedValue": 80, "verificationStatus": "unverified", "categoryId": "technical_skills", "availability": "available" }],
  "strengths": ["Synthetic example: technical screen"],
  "skillGaps": ["Problem-solving evidence is not available"],
  "recommendations": ["Collect a structured problem-solving sample"],
  "missingEvidence": ["problem_solving_dsa", "relevant_project_experience", "practical_assessment_performance", "communication_skills", "learning_adaptability"],
  "calculationExplanation": "Overall score is omitted until all six categories have evidence.",
  "evaluationStatus": "insufficient_evidence",
  "aiExplanation": { "summary": "Example explanation grounded in supplied evidence.", "strengths": ["Synthetic example: technical screen"], "skillGaps": ["Problem-solving evidence is not available"], "recommendations": ["Collect a structured problem-solving sample"] },
  "decisionSupportNotice": "Decision support only; not an automatic hiring decision."
}
```

The sample above is a schema-valid insufficient-evidence response. It omits `overallScore`, while preserving the one supported category score. A completed response requires evidence for all six categories and includes that score. `evidenceRefs` must reference evidence items in the response. Confidence is optional and must only be supplied when the scoring method supports it. AI explanation text is separate from evidence-backed facts.

## Validation and errors

The shared schemas reject unknown category/role identifiers, out-of-range scores (0–100), out-of-range confidence (0–1), a missing normalized value on available evidence only when a scorer requires one, a value attached to missing evidence, missing categories, invalid role weight totals, negative weights, and dangling evidence references. Each role must define exactly six non-negative weights totaling 100. API owners should continue using the current standard `apiErrorSchema` for errors; this proposal does not define new HTTP status codes.

## Integration actions for owners

- **Frontend (Aryan):** import candidate and response types from `@devrank/contracts`; use the five fixtures for UI states; render missing evidence distinctly from a score of zero; keep AI explanation visually distinct from evidence and numeric results.
- **Backend (Atharva):** review the proposal before adding an endpoint; validate request/response with shared schemas; agree on route, auth, persistence, and error behavior; do not expose secrets or include unnecessary personal data.
- **Scoring/AI (Priya):** implement deterministic normalization and weighted scoring behind the API; validate any generated explanation against the response schema; never let AI change scores.
- **All owners:** review the preliminary category definitions, weights, and insufficient-evidence policy before adopting them. No approval is recorded here.

Fixtures are in `fixtures/dummy-candidates.json` and `fixtures/expected-evaluations.json`; weights are in `config/role-weights.json`.
