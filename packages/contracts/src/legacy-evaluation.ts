import { z } from 'zod';
import { confidenceSchema, roleIdSchema, scoreSchema } from './scoring.js';

const v2ScoringCategorySchema = z.enum([
  'technical_skills', 'problem_solving_dsa', 'relevant_project_experience',
  'practical_assessment_performance', 'learning_adaptability',
]);
const v2RoleWeightsSchema = z.record(v2ScoringCategorySchema, z.number().finite().min(0).max(100)).superRefine((weights, context) => {
  if (Object.keys(weights).length !== 5 || Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 1e-8) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Historical v2 role weights must contain five categories totaling 100.' });
  }
});
const v2EvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  evidenceType: z.enum(['technical_screen', 'coding_assessment', 'project', 'work_sample', 'structured_interview', 'learning_record', 'portfolio', 'other']),
  source: z.string().min(1), description: z.string().min(1),
  originalValue: z.union([z.string(), z.number(), z.boolean()]).optional(), normalizedValue: scoreSchema.optional(),
  verificationStatus: z.enum(['verified', 'partially_verified', 'unverified']), observedAt: z.string().datetime().optional(),
  categoryId: v2ScoringCategorySchema, availability: z.enum(['available', 'missing']),
}).superRefine((item, context) => {
  if (item.availability === 'missing' && item.normalizedValue !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['normalizedValue'], message: 'Missing historical evidence cannot have a normalized value.' });
});
const v2CategoryScoreSchema = z.object({
  categoryId: v2ScoringCategorySchema, displayName: z.string().min(1), score: scoreSchema.optional(),
  confidence: confidenceSchema.optional(), status: z.enum(['scored', 'insufficient_evidence']),
  evidenceRefs: z.array(z.string().min(1)), explanation: z.string().min(1),
}).superRefine((item, context) => {
  if (item.status === 'scored' && item.score === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Scored historical categories require a score.' });
  if (item.status === 'insufficient_evidence' && item.score !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Insufficient historical categories cannot have a score.' });
});

/** Read-only validator for v2 five-category snapshots; never used by v3 scoring. */
export const previousEvaluationResponseV2Schema = z.object({
  schemaVersion: z.literal('2.0.0'), scoringVersion: z.literal('2.0.0').optional(),
  candidateId: z.string().min(1), targetRole: roleIdSchema, overallScore: scoreSchema.optional(),
  categoryScores: z.array(v2CategoryScoreSchema).length(5), roleWeightsUsed: v2RoleWeightsSchema,
  evidence: z.array(v2EvidenceSchema), confidence: confidenceSchema.optional(), strengths: z.array(z.string()),
  skillGaps: z.array(z.string()), recommendations: z.array(z.string()), missingEvidence: z.array(v2ScoringCategorySchema),
  calculationExplanation: z.string().min(1), evaluationStatus: z.enum(['completed', 'insufficient_evidence']),
  aiExplanation: z.object({ summary: z.string(), strengths: z.array(z.string()), skillGaps: z.array(z.string()), recommendations: z.array(z.string()) }),
  decisionSupportNotice: z.literal('Decision support only; not an automatic hiring decision.'),
}).superRefine((response, context) => {
  const ids = response.categoryScores.map(({ categoryId }) => categoryId);
  if (new Set(ids).size !== 5 || Object.keys(response.roleWeightsUsed).length !== 5) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores'], message: 'A v2 snapshot must contain all five unique categories.' });
  const missing = response.categoryScores.filter(({ status }) => status === 'insufficient_evidence').map(({ categoryId }) => categoryId).sort();
  if ([...response.missingEvidence].sort().join('|') !== missing.join('|')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingEvidence'], message: 'v2 missingEvidence must match its category statuses.' });
  if (response.evaluationStatus === 'insufficient_evidence' && response.overallScore !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'Insufficient-evidence v2 snapshots cannot have an overall score.' });
  const evidence = new Map(response.evidence.map(({ evidenceId, categoryId }) => [evidenceId, categoryId]));
  for (const [index, category] of response.categoryScores.entries()) {
    if (category.evidenceRefs.some((reference) => evidence.get(reference) !== category.categoryId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores', index, 'evidenceRefs'], message: 'v2 evidence references must exist and match their category.' });
  }
});
export type PreviousEvaluationResponseV2 = z.infer<typeof previousEvaluationResponseV2Schema>;

const legacyScoringCategorySchema = z.enum([
  'technical_skills',
  'problem_solving_dsa',
  'relevant_project_experience',
  'practical_assessment_performance',
  'communication_skills',
  'learning_adaptability',
]);

const legacyRoleWeightsSchema = z.record(legacyScoringCategorySchema, z.number().finite().min(0).max(100)).superRefine((weights, context) => {
  if (Object.keys(weights).length !== 6) context.addIssue({ code: z.ZodIssueCode.custom, message: 'A historical v1 role must contain six weights.' });
  if (Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 1e-8) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Historical v1 role weights must total 100.' });
  }
});

const legacyEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  evidenceType: z.enum(['technical_screen', 'coding_assessment', 'project', 'work_sample', 'structured_interview', 'learning_record', 'portfolio', 'other']),
  source: z.string().min(1),
  description: z.string().min(1),
  originalValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  normalizedValue: scoreSchema.optional(),
  verificationStatus: z.enum(['verified', 'partially_verified', 'unverified']),
  observedAt: z.string().datetime().optional(),
  categoryId: legacyScoringCategorySchema,
  availability: z.enum(['available', 'missing']),
}).superRefine((evidence, context) => {
  if (evidence.availability === 'missing' && evidence.normalizedValue !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['normalizedValue'], message: 'Missing historical evidence cannot have a normalized value.' });
  }
});

const legacyCategoryScoreSchema = z.object({
  categoryId: legacyScoringCategorySchema,
  displayName: z.string().min(1),
  score: scoreSchema.optional(),
  confidence: confidenceSchema.optional(),
  status: z.enum(['scored', 'insufficient_evidence']),
  evidenceRefs: z.array(z.string().min(1)),
  explanation: z.string().min(1),
}).superRefine((item, context) => {
  if (item.status === 'scored' && item.score === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Scored historical categories require a score.' });
  if (item.status === 'insufficient_evidence' && item.score !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Insufficient historical categories cannot have a score.' });
});

/** Read-only validator for persisted v1 snapshots; never used by current scoring inputs. */
export const legacyEvaluationResponseV1Schema = z.object({
  schemaVersion: z.literal('1.0.0'),
  scoringVersion: z.literal('1.0.0').optional(),
  candidateId: z.string().min(1),
  targetRole: roleIdSchema,
  overallScore: scoreSchema.optional(),
  categoryScores: z.array(legacyCategoryScoreSchema).length(6),
  roleWeightsUsed: legacyRoleWeightsSchema,
  evidence: z.array(legacyEvidenceSchema),
  confidence: confidenceSchema.optional(),
  strengths: z.array(z.string()),
  skillGaps: z.array(z.string()),
  recommendations: z.array(z.string()),
  missingEvidence: z.array(legacyScoringCategorySchema),
  calculationExplanation: z.string().min(1),
  evaluationStatus: z.enum(['completed', 'insufficient_evidence']),
  aiExplanation: z.object({ summary: z.string(), strengths: z.array(z.string()), skillGaps: z.array(z.string()), recommendations: z.array(z.string()) }),
  decisionSupportNotice: z.literal('Decision support only; not an automatic hiring decision.'),
}).superRefine((response, context) => {
  const categoryIds = response.categoryScores.map(({ categoryId }) => categoryId);
  if (new Set(categoryIds).size !== 6 || Object.keys(response.roleWeightsUsed).length !== 6) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores'], message: 'A historical v1 snapshot must contain all six unique categories.' });
  }
  const missing = response.categoryScores.filter(({ status }) => status === 'insufficient_evidence').map(({ categoryId }) => categoryId).sort();
  if ([...response.missingEvidence].sort().join('|') !== missing.join('|')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingEvidence'], message: 'Historical missingEvidence must match its category statuses.' });
  }
  if (response.evaluationStatus === 'insufficient_evidence' && response.overallScore !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'Historical insufficient-evidence snapshots cannot have an overall score.' });
  }
  const evidence = new Map(response.evidence.map(({ evidenceId, categoryId }) => [evidenceId, categoryId]));
  for (const [index, category] of response.categoryScores.entries()) {
    if (category.evidenceRefs.some((reference) => evidence.get(reference) !== category.categoryId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['categoryScores', index, 'evidenceRefs'], message: 'Historical evidence references must exist and match their category.' });
    }
  }
});

export type LegacyEvaluationResponseV1 = z.infer<typeof legacyEvaluationResponseV1Schema>;
