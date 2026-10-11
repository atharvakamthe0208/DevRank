# Day 1 scoring contract

## Implemented behavior

This contract is a shared starting point for frontend and backend work. It adds six scoring categories, normalized evidence and candidate input types, preliminary weights for three roles, an evaluation response schema, five synthetic fixtures, and contract tests. It does not implement an evaluation API route, persistence, an AI provider, or production scoring. The current API still exposes only `GET /health` and its JSON 404 fallback.

All shared validators and TypeScript types are exported by `@devrank/contracts`. The package uses Zod already present in this repository, avoiding another dependency. The shared typed contract is the authoritative machine-readable format; JSON fixtures are examples. Names, emails, protected attributes, and unrelated personal details are excluded. Scores are decision support only and are never an automatic hiring decision.

## Categories

| ID | Display name | Definition and evidence examples |
| --- | --- | --- |
| `technical_skills` | Technical Skills | Role-relevant languages, tools, and engineering concepts; structured technical screens, verified work samples. |
| `problem_solving_dsa` | Problem-Solving and DSA | Reasoning, algorithm selection, and trade-offs; coding or structured problem-solving assessments. |
| `relevant_project_experience` | Relevant Project Experience | Relevance, depth, and evidenced impact of projects; portfolio or project review. |
| `practical_assessment_performance` | Practical Assessment Performance | Performance on a completed, relevant work sample or assessment. |
| `communication_skills` | Communication Skills | Clarity and structure in technical explanations and collaboration; structured interview rubric. |
| `learning_adaptability` | Learning Ability and Adaptability | Evidence of learning tools/concepts and adapting to constraints; specific learning examples. |

Category scores are normalized to 0–100. An absent value is not zero. `status: "insufficient_evidence"` and a category ID in `missingEvidence` explicitly record gaps; no score is emitted for that category. Category explanation is concise display text grounded in the referenced evidence. Confidence is optional, between 0 and 1, and should be omitted if the underlying method cannot support it.

## Evidence normalization rules

Evidence has an opaque ID, type, named source, factual description, optional raw value, optional normalized 0–100 value, verification status, optional ISO timestamp, category ID, and availability. Keep raw values distinct from normalized values. Store only what is needed to evaluate the job-related evidence. `availability: "missing"` has no normalized value and must not be transformed to zero. A normalized score must come from a documented rubric or mapping; do not infer completion or fabricate evidence. Verification status describes whether the source was checked, not the score's certainty.

## Preliminary role weights

Weights are in `config/role-weights.json` and are percentage points (each role totals exactly 100). They are preliminary engineering defaults for demonstration, not scientifically validated or final hiring criteria. Their broad rationale is to give role-relevant technical work, problem solving, and projects meaningful weight while retaining practical performance, communication, and learning signals; AI/ML emphasizes technical and learning evidence, while data analysis gives communication comparable weight to learning. The team must agree on the weights and category mapping before using them in hiring.

| Category | Software Developer | AI/ML Engineer | Data Analyst |
| --- | ---: | ---: | ---: |
| Technical Skills | 25% | 25% | 20% |
| Problem-Solving and DSA | 20% | 15% | 15% |
| Relevant Project Experience | 20% | 20% | 20% |
| Practical Assessment Performance | 15% | 15% | 15% |
| Communication Skills | 10% | 10% | 15% |
| Learning Ability and Adaptability | 10% | 15% | 15% |

`roleWeightsSchema` validates exactly six known, non-negative weights totaling 100 for every role. Keep weight changes in the single config file; do not modify the scoring formula to tune a role.

## Overall calculation and status

When all six categories have evidence-backed scores, overall score is `sum(category score × role weight / 100)`, rounded to two decimal places. If one or more categories are missing, return category scores that do have evidence, list the missing categories, set `evaluationStatus` to `insufficient_evidence`, and omit `overallScore` and overall confidence. This conservative completeness gate is a proposed Day 1 policy for team review, not an existing production behavior. AI explanations may summarize the validated result but cannot change scores, weights, evidence, or status.

## Output schema example

This valid JSON illustrates insufficient evidence: there is one score, one missing category, and no overall score.

```json
{
  "schemaVersion": "1.0.0",
  "scoringVersion": "1.0.0",
  "candidateId": "synthetic-candidate-demo",
  "targetRole": "software_developer",
  "categoryScores": [
    { "categoryId": "technical_skills", "displayName": "Technical Skills", "score": 80, "confidence": 0.8, "status": "scored", "evidenceRefs": ["demo-tech"], "explanation": "A supplied technical screen supports this score." },
    { "categoryId": "problem_solving_dsa", "displayName": "Problem-Solving and DSA", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No assessment was supplied." },
    { "categoryId": "relevant_project_experience", "displayName": "Relevant Project Experience", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No project evidence was supplied." },
    { "categoryId": "practical_assessment_performance", "displayName": "Practical Assessment Performance", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No work sample was supplied." },
    { "categoryId": "communication_skills", "displayName": "Communication Skills", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No structured communication evidence was supplied." },
    { "categoryId": "learning_adaptability", "displayName": "Learning Ability and Adaptability", "status": "insufficient_evidence", "evidenceRefs": [], "explanation": "No learning example was supplied." }
  ],
  "roleWeightsUsed": { "technical_skills": 25, "problem_solving_dsa": 20, "relevant_project_experience": 20, "practical_assessment_performance": 15, "communication_skills": 10, "learning_adaptability": 10 },
  "evidence": [{ "evidenceId": "demo-tech", "evidenceType": "technical_screen", "source": "Synthetic screen", "description": "Sample only", "normalizedValue": 80, "verificationStatus": "unverified", "categoryId": "technical_skills", "availability": "available" }],
  "strengths": ["Synthetic sample: technical fundamentals"],
  "skillGaps": ["Evidence is not available for five categories"],
  "recommendations": ["Collect the missing role-relevant evidence"],
  "missingEvidence": ["problem_solving_dsa", "relevant_project_experience", "practical_assessment_performance", "communication_skills", "learning_adaptability"],
  "calculationExplanation": "Overall score is omitted until evidence is available in all six categories.",
  "evaluationStatus": "insufficient_evidence",
  "aiExplanation": { "summary": "Synthetic sample summary based on supplied evidence only.", "strengths": ["Technical fundamentals"], "skillGaps": ["Five categories lack evidence"], "recommendations": ["Collect missing evidence"] },
  "decisionSupportNotice": "Decision support only; not an automatic hiring decision."
}
```

## Synthetic fixture set

All records are obviously synthetic and deterministic. Candidate 001 is a balanced software developer; 002 emphasizes ML project work; 003 is a communication-strong data analyst; 004 has five scored categories and missing communication evidence; 005 has no collected evidence. `expected-evaluations.json` records category outcomes and the three complete weighted scores (78.1, 83.4, 83.2); candidates 004 and 005 intentionally have no overall score. These fixtures can drive UI states, integration examples, and automated contract tests.

## Files and ownership / API coordination

- `packages/contracts/src/`: shared Zod schemas and inferred types, replacing the earlier four-category scoring enum.
- `config/role-weights.json`: the only preliminary role-weight configuration.
- `fixtures/`: five candidate inputs and deterministic expected outcomes.
- `packages/contracts/test/contracts.test.ts`: schema, weight, score, confidence, missing-evidence, output, and fixture tests.
- `docs/api-contract.md`: existing API inventory and proposed request/response integration contract.

No routes are changed. The old API format is simply `/health` returning `{ "status": "ok" }`, with a structured 404 for other paths; no evaluation API existed. The proposed candidate request and evaluation response are in `docs/api-contract.md`. Frontend and backend owners need to adopt the shared types and agree on endpoint, auth, error handling, and persistence. Team agreement is still needed on weights, evidence sources, normalization rubrics, minimum evidence policy, confidence calibration, and the API route. Do not treat this document as approval from another owner.

## Tests and known limits

Run `npm test --workspace @devrank/contracts` for contract tests, then `npm run build --workspace @devrank/contracts`, `npm run build --workspace @devrank/api`, `npm run build --workspace @devrank/web`, and `npm run typecheck` for workspace validation. Actual results are reported in the implementation handoff after execution. Weights and candidate scores are illustrative. No provider integration, live evidence verification, endpoint, database persistence, fairness review, or validated hiring science is included. Confidence values in examples are synthetic only.
