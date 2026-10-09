import { z } from 'zod';

export const evaluationRequestSchema = z.object({ candidateId: z.string().uuid(), roleProfileId: z.string().uuid() });
export const evaluationStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export const evaluationSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  roleProfileId: z.string().uuid(),
  status: evaluationStatusSchema,
  createdAt: z.string().datetime(),
});
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
