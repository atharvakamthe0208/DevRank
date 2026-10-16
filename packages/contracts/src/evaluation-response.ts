import { z } from 'zod';
import { schemaVersion, scoringVersionSchema, roleIdSchema, roleWeightsSchema, scoringCategorySchema, scoringCategories, scoreSchema, confidenceSchema, categoryScoreSchema } from './scoring.js';
import { evidenceSchema } from './evidence.js';
import { platformEvaluationEvidenceSchema } from './platform-data.js';

export const candidateInputSchema = z.object({ candidateId: z.string().min(1), targetRole: roleIdSchema, evidence: z.array(evidenceSchema) });
export const evaluationResponseSchema = z.object({
  schemaVersion: z.literal(schemaVersion),
  scoringVersion: scoringVersionSchema.optional(),
  candidateId: z.string().min(1),
  targetRole: roleIdSchema,
  overallScore: scoreSchema.optional(),
  categoryScores: z.array(categoryScoreSchema).length(scoringCategories.length),
  roleWeightsUsed: roleWeightsSchema,
  evidence: z.array(evidenceSchema),
  platformEvidence: z.array(platformEvaluationEvidenceSchema).optional(),
  confidence: confidenceSchema.optional(),
  strengths: z.array(z.string()),
  skillGaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  missingEvidence: z.array(scoringCategorySchema),
  calculationExplanation: z.string().min(1),
  evaluationStatus: z.enum(['completed', 'insufficient_evidence']),
  aiExplanation: z.object({ summary: z.string(), strengths: z.array(z.string()), skillGaps: z.array(z.string()), recommendations: z.array(z.string()) }),
  decisionSupportNotice: z.literal('Decision support only; not an automatic hiring decision.'),
}).superRefine((result, context) => {
  const categoryIds = result.categoryScores.map(({ categoryId }) => categoryId);
  if (new Set(categoryIds).size !== scoringCategories.length || scoringCategories.some(({ id }) => !categoryIds.includes(id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores'], message: 'Include each scoring category exactly once.' });
  }
  const missingFromScores = result.categoryScores.filter((item) => item.status === 'insufficient_evidence').map((item) => item.categoryId).sort();
  if ([...result.missingEvidence].sort().join('|') !== missingFromScores.join('|')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingEvidence'], message: 'missingEvidence must exactly match the insufficient-evidence categories.' });
  }
  if (result.categoryScores.some((item) => item.status === 'insufficient_evidence') && result.evaluationStatus !== 'insufficient_evidence') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluationStatus'], message: 'Missing category evidence must be reflected in the evaluation status.' });
  }
  if (result.evaluationStatus === 'insufficient_evidence' && result.overallScore !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'Insufficient-evidence evaluations must omit overallScore.' });
  }
  const ids = new Set(result.evidence.map(({ evidenceId }) => evidenceId));
  for (const [index, category] of result.categoryScores.entries()) {
    if (category.evidenceRefs.some((id) => !ids.has(id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores', index, 'evidenceRefs'], message: 'Evidence references must point to evidence included in this response.' });
    if (category.status === 'scored' && category.evidenceRefs.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores', index, 'evidenceRefs'], message: 'A scored category must reference supporting evidence.' });
    if (category.evidenceRefs.some((id) => result.evidence.find((item) => item.evidenceId === id)?.categoryId !== category.categoryId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores', index, 'evidenceRefs'], message: 'Evidence references must match the score category.' });
    }
  }
});
export type CandidateInput = z.infer<typeof candidateInputSchema>;
export type EvaluationResponse = z.infer<typeof evaluationResponseSchema>;
