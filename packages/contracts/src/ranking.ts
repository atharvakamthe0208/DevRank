import { z } from 'zod';
import { roleIdSchema, scoringVersionSchema } from './scoring.js';

export const rankingQuerySchema = z.object({
  roleId: roleIdSchema,
  scoringVersion: scoringVersionSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const candidateRankingSchema = z.object({
  candidateId: z.string().uuid(),
  rank: z.number().int().positive(),
  score: z.number().finite().min(0).max(100),
  evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();

export const rankingResponseSchema = z.object({
  roleId: roleIdSchema,
  scoringVersion: scoringVersionSchema,
  items: z.array(candidateRankingSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
  excluded: z.object({
    incomplete: z.number().int().nonnegative(),
    scoringVersionMismatch: z.number().int().nonnegative(),
    missingScore: z.number().int().nonnegative(),
    invalidSnapshot: z.number().int().nonnegative(),
  }).strict(),
}).strict();

export type CandidateRanking = z.infer<typeof candidateRankingSchema>;
export type RankingQuery = z.infer<typeof rankingQuerySchema>;
export type RankingResponse = z.infer<typeof rankingResponseSchema>;
