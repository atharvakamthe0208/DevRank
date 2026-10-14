import { z } from 'zod';
import { roleIdSchema, roleWeightsSchema } from './scoring.js';
import { evaluationResponseSchema } from './evaluation-response.js';
import { legacyEvaluationResponseV1Schema } from './legacy-evaluation.js';

export const evaluationRequestSchema = z.object({ roleProfileId: z.string().uuid() }).strict();
export const roleProfileOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  usable: z.boolean(),
  targetRole: roleIdSchema.optional(),
  weights: roleWeightsSchema.optional(),
}).strict().superRefine((profile, context) => {
  if (profile.usable && (!profile.targetRole || !profile.weights)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Usable role profiles need a supported role and valid category weights.' });
});
export const roleProfileListResponseSchema = z.object({ items: z.array(roleProfileOptionSchema) }).strict();
export const evaluationIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const evaluationStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed']);
export const evaluationSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  roleProfileId: z.string().uuid(),
  status: evaluationStatusSchema,
  createdAt: z.string().datetime(),
});
export const persistedEvaluationSchema = z.object({
  id: z.string().uuid(), candidateId: z.string().uuid(), roleProfileId: z.string().uuid(),
  status: z.enum(['completed', 'insufficient_evidence']), createdAt: z.string().datetime({ offset: true }),
  result: z.union([evaluationResponseSchema, legacyEvaluationResponseV1Schema]),
});
export const candidateEvaluationsResponseSchema = z.object({ items: z.array(persistedEvaluationSchema).max(20) }).strict();
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type RoleProfileOption = z.infer<typeof roleProfileOptionSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type PersistedEvaluation = z.infer<typeof persistedEvaluationSchema>;
