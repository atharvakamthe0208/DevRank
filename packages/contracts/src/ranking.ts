import { z } from 'zod';

export const candidateRankingSchema = z.object({
  candidateId: z.string().uuid(),
  rank: z.number().int().positive(),
  score: z.number().min(0).max(100),
});
export type CandidateRanking = z.infer<typeof candidateRankingSchema>;
