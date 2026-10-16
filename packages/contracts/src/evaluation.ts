import { z } from 'zod';
import { roleIdSchema, roleWeightsSchema } from './scoring.js';
import { evaluationResponseSchema } from './evaluation-response.js';
import { legacyEvaluationResponseV1Schema } from './legacy-evaluation.js';

export const evaluationRoleSchema = z.object({
  id: roleIdSchema,
  displayName: z.string().min(1),
  weights: roleWeightsSchema,
});
export const evaluationRolesResponseSchema = z.object({ roles: z.array(evaluationRoleSchema).min(1) });
export const evaluationRunRequestSchema = z.object({ candidateId: z.string().uuid(), roleId: roleIdSchema }).strict();
export const evaluationRunResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['completed', 'insufficient_evidence']),
  candidate: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
  role: evaluationRoleSchema,
  evaluatedAt: z.string().datetime({ offset: true }),
  evaluation: evaluationResponseSchema,
  evidenceLimitations: z.array(z.string()),
}).strict();

/** Request used by the candidate-scoped API for an owner-defined role profile. */
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
  roleProfileId: z.string().uuid().nullable(),
  status: evaluationStatusSchema,
  createdAt: z.string().datetime({ offset: true }),
});
export const persistedEvaluationSchema = z.object({
  id: z.string().uuid(), candidateId: z.string().uuid(), roleProfileId: z.string().uuid().nullable(),
  targetRole: roleIdSchema, status: z.enum(['completed', 'insufficient_evidence']),
  createdAt: z.string().datetime({ offset: true }), result: evaluationResponseSchema,
});
/** Read contract for persisted rows. V1 snapshots remain explicitly legacy and are never fed to v2 scoring. */
export const persistedEvaluationReadSchema = z.union([
  persistedEvaluationSchema,
  z.object({
    id: z.string().uuid(), candidateId: z.string().uuid(), roleProfileId: z.string().uuid().nullable(),
    targetRole: roleIdSchema, status: evaluationStatusSchema,
    createdAt: z.string().datetime({ offset: true }), result: legacyEvaluationResponseV1Schema,
  }).strict(),
]);
export const candidateEvaluationsResponseSchema = z.object({ items: z.array(persistedEvaluationReadSchema).max(20) }).strict();
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>;
export type RoleProfileOption = z.infer<typeof roleProfileOptionSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type PersistedEvaluation = z.infer<typeof persistedEvaluationSchema>;
export type PersistedEvaluationRead = z.infer<typeof persistedEvaluationReadSchema>;
export type EvaluationRole = z.infer<typeof evaluationRoleSchema>;
export type EvaluationRolesResponse = z.infer<typeof evaluationRolesResponseSchema>;
export type EvaluationRunRequest = z.infer<typeof evaluationRunRequestSchema>;
export type EvaluationRunResponse = z.infer<typeof evaluationRunResponseSchema>;
