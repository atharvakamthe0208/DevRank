import { z } from 'zod';

import { evaluationResponseSchema } from './evaluation-response.js';
import { legacyEvaluationResponseV1Schema } from './legacy-evaluation.js';

export const evaluationRequestSchema = z.object({ roleProfileId: z.string().uuid() }).strict();
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
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type PersistedEvaluation = z.infer<typeof persistedEvaluationSchema>;
