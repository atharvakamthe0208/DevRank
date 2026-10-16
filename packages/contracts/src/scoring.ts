import { z } from 'zod';

export const schemaVersion = '2.0.0' as const;
export const scoringVersion = '2.0.0' as const;
export const scoringVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Scoring version must use semantic version format (major.minor.patch).');
export const scoringCategories = [
  { id: 'technical_skills', displayName: 'Technical Skills', description: 'Demonstrated proficiency in role-relevant languages, tools, and engineering concepts.' },
  { id: 'problem_solving_dsa', displayName: 'Problem-Solving / DSA', description: 'Ability to reason through problems, select algorithms, and explain trade-offs.' },
  { id: 'relevant_project_experience', displayName: 'Relevant Project Experience', description: 'Depth, relevance, and verifiable impact of work on related projects.' },
  { id: 'practical_assessment_performance', displayName: 'Practical Assessment Performance', description: 'Performance on a completed, role-relevant practical assessment.' },
  { id: 'learning_adaptability', displayName: 'Learning & Adaptability', description: 'Evidence of learning new tools or concepts and adapting to changing constraints.' },
] as const;

export const scoringCategorySchema = z.enum(scoringCategories.map(({ id }) => id) as [string, ...string[]]);
export type ScoringCategory = z.infer<typeof scoringCategorySchema>;
export const scoreSchema = z.number().finite().min(0).max(100);
export const confidenceSchema = z.number().finite().min(0).max(1);
export const roleIds = ['software_developer', 'ai_ml_engineer', 'data_analyst'] as const;
export const roleIdSchema = z.enum(roleIds);

export const roleWeightsSchema = z.record(scoringCategorySchema, z.number().finite().min(0).max(100))
  .superRefine((weights, context) => {
    const keys = Object.keys(weights);
    if (keys.length !== scoringCategories.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Every role must define exactly five category weights.' });
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 1e-8) context.addIssue({ code: z.ZodIssueCode.custom, message: `Role weights must total 100; received ${total}.` });
  });

export const roleWeightConfigurationSchema = z.object({ schemaVersion: z.literal(schemaVersion), scoringVersion: scoringVersionSchema, preliminary: z.literal(true), roles: z.record(roleIdSchema, roleWeightsSchema) });
export type RoleWeightConfiguration = z.infer<typeof roleWeightConfigurationSchema>;
export const categoryScoreSchema = z.object({
  categoryId: scoringCategorySchema,
  displayName: z.string().min(1),
  score: scoreSchema.optional(),
  confidence: confidenceSchema.optional(),
  status: z.enum(['scored', 'insufficient_evidence']),
  evidenceRefs: z.array(z.string().min(1)),
  explanation: z.string().min(1),
}).superRefine((value, context) => {
  if (value.status === 'scored' && value.score === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'A scored category requires a score.' });
  if (value.status === 'insufficient_evidence' && value.score !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Do not assign a score when evidence is insufficient.' });
});
export type RoleWeights = z.infer<typeof roleWeightsSchema>;
export type CategoryScore = z.infer<typeof categoryScoreSchema>;
