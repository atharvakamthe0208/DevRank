import { z } from 'zod';
import { evaluationResponseSchema } from './evaluation-response.js';
import { evaluationStatusSchema } from './evaluation.js';
import { roleIdSchema, scoringVersionSchema } from './scoring.js';

export const candidateComparisonSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(2).max(5),
  evaluationIds: z.array(z.string().uuid()).min(2).max(5),
}).strict().superRefine(({ candidateIds, evaluationIds }, context) => {
  if (candidateIds.length !== evaluationIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluationIds'], message: 'Provide one evaluation ID for each candidate ID.' });
  if (new Set(candidateIds).size !== candidateIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['candidateIds'], message: 'Candidate IDs must be unique.' });
  if (new Set(evaluationIds).size !== evaluationIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['evaluationIds'], message: 'Evaluation IDs must be unique.' });
});

export const candidateComparisonResponseSchema = z.object({
  roleId: roleIdSchema,
  scoringVersion: scoringVersionSchema,
  items: z.array(z.object({
    candidateId: z.string().uuid(),
    evaluationId: z.string().uuid(),
    status: evaluationStatusSchema,
    result: evaluationResponseSchema,
  }).strict()).min(2).max(5),
}).strict();

export type CandidateComparison = z.infer<typeof candidateComparisonSchema>;
export type CandidateComparisonResponse = z.infer<typeof candidateComparisonResponseSchema>;
