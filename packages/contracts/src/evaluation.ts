import { z } from 'zod';
import { roleIdSchema, roleWeightsSchema } from './scoring.js';
import { evaluationResponseSchema } from './evaluation-response.js';

// Role IDs and weights come from the backend's validated role-weights.json.
export const evaluationRoleSchema = z.object({
  id: roleIdSchema,
  displayName: z.string().min(1),
  weights: roleWeightsSchema,
});
export const evaluationRolesResponseSchema = z.object({ roles: z.array(evaluationRoleSchema).min(1) });
export const evaluationRunRequestSchema = z.object({ candidateId: z.string().uuid(), roleId: roleIdSchema }).strict();
export const evaluationRunResponseSchema = z.object({
  candidate: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
  role: evaluationRoleSchema,
  evaluatedAt: z.string().datetime(),
  evaluation: evaluationResponseSchema,
  evidenceLimitations: z.array(z.string()),
}).strict();

/** Retained for the existing persisted-evaluation table's future contract. */
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
export type EvaluationRole = z.infer<typeof evaluationRoleSchema>;
export type EvaluationRolesResponse = z.infer<typeof evaluationRolesResponseSchema>;
export type EvaluationRunRequest = z.infer<typeof evaluationRunRequestSchema>;
export type EvaluationRunResponse = z.infer<typeof evaluationRunResponseSchema>;
