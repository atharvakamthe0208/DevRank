import { z } from 'zod';

export const candidateComparisonSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(2).max(5),
  evaluationIds: z.array(z.string().uuid()).min(2).max(5),
});
export type CandidateComparison = z.infer<typeof candidateComparisonSchema>;
