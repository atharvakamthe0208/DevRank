import { z } from 'zod';

export const scoringCategorySchema = z.enum(['problem_solving', 'code_quality', 'consistency', 'project_impact']);
export const roleWeightsSchema = z.record(scoringCategorySchema, z.number().min(0).max(1));
export const categoryScoreSchema = z.object({ category: scoringCategorySchema, score: z.number().min(0).max(100), rationale: z.string().optional() });
export const deterministicScoreSchema = z.object({ score: z.number().min(0).max(100), categories: z.array(categoryScoreSchema) });
export type RoleWeights = z.infer<typeof roleWeightsSchema>;
export type DeterministicScore = z.infer<typeof deterministicScoreSchema>;
