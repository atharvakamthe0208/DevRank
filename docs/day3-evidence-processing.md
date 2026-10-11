# Day 3 evidence processing

## Implemented flow

`apps/api/src/modules/evidence-processing/index.ts` adds separate validation, normalization, and category-mapping steps. `processCandidateEvidence` runs those steps and passes only mapped, schema-valid evidence to the existing Day 2 `scoreCandidate` function:

```text
Raw candidate evidence
  → candidate envelope validation
  → per-item evidence validation
  → optional configured normalization
  → explicit evidence-type category mapping
  → Day 2 category and overall scoring
  → Day 1 evaluation response validation
```

No API route or Day 1 response fields changed. The return value wraps the normal `evaluation` with `rejectedEvidence`, `unmappedEvidence`, and `unnormalizedEvidence` processing reports. The evaluation itself validates against the existing `evaluationResponseSchema`.

## Evidence validation and error handling

Each evidence item must have a non-empty `evidenceId`, supported `evidenceType`, `source`, `description`, allowed `verificationStatus`, and `availability`. `originalValue` may be a non-empty string, finite number, or boolean. `normalizedValue`, when supplied, must be finite and in the inclusive 0–100 range. `observedAt` must be a valid ISO date-time. A raw item may omit `categoryId` before mapping; if supplied, it must be a known Day 1 category. Extra fields are rejected. Evidence-level confidence is not part of the existing contract and is rejected as unsupported; category confidence remains optional in the response schema and the deterministic scorer does not invent it.

Validation behavior:

- Candidate envelope errors (including invalid candidate ID, unknown target role, or a non-array evidence field) fail the whole call with a field-specific `EvidenceProcessingError`.
- An invalid evidence item is reported with its original array index, ID when readable, and one or more field errors. That item is excluded; other valid evidence continues.
- Every occurrence of a duplicate evidence ID is rejected. This avoids silently selecting one potentially conflicting item.
- An invalid mapping configuration fails the whole call. An invalid role-weight configuration is reported by the scoring module and also fails the whole call.
- A valid item with an unsupported raw normalization rule or an unmapped type is not rejected as malformed: it is retained in an explicit unnormalized or unmapped report and is not used to create an unsupported score.

No invalid value is converted to zero. The current API does not expose this pipeline yet; these are module-level rules until backend endpoint behavior is agreed.

## Normalization rules and limitations

There are no repository-approved rules for converting raw assessment values to normalized scores. Therefore there are **no default raw-value transformations**. Existing `normalizedValue` values are validated and passed through without applying another transformation. `originalValue` is preserved as supplied. If the caller provides a deterministic rule for a particular evidence type, the rule may produce a 0–100 normalized value; the result is range-checked. A failed or out-of-range custom rule rejects only that item and reports the error.

For example, a caller could supply an explicitly agreed rubric rule that maps `4/5` to `4 ÷ 5 × 100 = 80`. The test uses a local example rule only; the project has not adopted that rubric. A percentage, project count, verbal rating, or assessment result is never compared or converted automatically. Missing evidence remains missing, and raw evidence without a rule remains unnormalized. A category with no valid normalized evidence is insufficient under the Day 2 policy.

## Category mapping

`config/evidence-category-mapping.json` is the shared explicit mapping. Supported rules are:

| Evidence type | Category ID |
| --- | --- |
| `technical_screen` | `technical_skills` |
| `coding_assessment` | `problem_solving_dsa` |
| `project` | `relevant_project_experience` |
| `work_sample` | `practical_assessment_performance` |
| `structured_interview` | `communication_skills` |
| `learning_record` | `learning_adaptability` |
| `portfolio` | `relevant_project_experience` |
| `other` | unmapped (`null`) |

If an item already supplies a category that conflicts with its type's configured mapping, the item is reported as unmapped rather than reassigned silently. Evidence IDs are preserved. The Day 1 evidence schema has one `categoryId`, so the current mapping assigns at most one category per item. Mapping one item into multiple categories would require a contract change and team review.

## Example

Raw input excerpt:

```json
{
  "evidenceId": "raw-tech",
  "evidenceType": "technical_screen",
  "source": "Synthetic rubric",
  "description": "Technical fundamentals sample",
  "originalValue": "4/5",
  "verificationStatus": "unverified",
  "availability": "available"
}
```

With an explicitly supplied test rule for a five-point rubric, the processed Day 1 evidence becomes:

```json
{
  "evidenceId": "raw-tech",
  "evidenceType": "technical_screen",
  "source": "Synthetic rubric",
  "description": "Technical fundamentals sample",
  "originalValue": "4/5",
  "normalizedValue": 80,
  "verificationStatus": "unverified",
  "categoryId": "technical_skills",
  "availability": "available"
}
```

This transformation is a test example, not an approved project normalization rule. With no supplied rule, the same raw value is preserved without `normalizedValue`, and no category score is fabricated. On the complete synthetic example using explicit test-only rules, the Day 2 scorer returns scoring version `1.0.0`, category scores `80, 75, 78, 82, 80, 72`, and overall score `78.1` for Software Developer. Partial inputs preserve available category scores and omit the overall score.

## Files created or changed

- `apps/api/src/modules/evidence-processing/index.ts`: item validation, optional normalization, mapping, processing result, and Day 2 scorer integration.
- `config/evidence-category-mapping.json`: explicit evidence-type mapping.
- `packages/contracts/src/evidence.ts`: exports the existing evidence type and verification status schemas for reuse; existing field shapes are unchanged.
- `apps/api/test/evidence-processing.test.ts`: validation, mapping, normalization, complete/partial pipeline, determinism, and error-policy tests.
- `docs/day3-evidence-processing.md`: this implementation and integration guide.

## Verification results

Executed on 2026-10-11:

- `npm test --workspace @devrank/api` — passed, 30 tests across evidence processing (15), Day 2 scoring (13), and API compatibility (2).
- `npm test --workspace @devrank/contracts` — passed, 8 Day 1 contract regression tests.
- `npm run build --workspace @devrank/contracts` — passed after the shared evidence enum exports.
- `npm run build --workspace @devrank/api` — passed.
- `npm run typecheck --workspace @devrank/api` — passed.
- `npm run typecheck --workspace @devrank/web` — passed.

Vitest may require filesystem access outside the Windows sandbox because its resolver can return `EPERM` for workspace source files. The tests were executed with the needed access. This does not change the API contract.

Commands:

```sh
npm test --workspace @devrank/api
npm test --workspace @devrank/contracts
npm run build --workspace @devrank/contracts
npm run build --workspace @devrank/api
npm run typecheck --workspace @devrank/web
```

## Integration notes and decisions awaiting agreement

The backend can call `processCandidateEvidence(candidate)` and consume its `evaluation` result plus the processing reports. A caller can provide `normalizationRules`, `categoryMapping`, and `roleWeights`; absent a caller mapping, the checked-in mapping file is loaded. No frontend or API route change is required for this module-level integration.

Before production use, the team should agree on actual normalization rubrics, confirm the type-to-category table, decide how to surface item-level rejection reports in a future endpoint, and review the rule that rejects every duplicate-ID occurrence. Multi-category mapping is not supported by the current single-category evidence contract. No teammate approval is claimed.
