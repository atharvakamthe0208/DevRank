import { z } from 'zod';

export const schemaVersion = '4.0.0' as const;
export const scoringVersion = '4.0.1' as const;
export const scoringVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Scoring version must use semantic version format (major.minor.patch).');
export const scoringCategories = [
  { id: 'project_portfolio', displayName: 'Project Portfolio', description: 'GitHub public repository count proxy; does not measure quality.' },
  { id: 'technical_skills', displayName: 'Technical Skills', description: 'Distinct languages in saved GitHub repository metadata; breadth proxy only.' },
  { id: 'development_activity', displayName: 'Development Activity', description: 'Attributable commit volume proxy; does not measure code quality.' },
  { id: 'collaboration', displayName: 'Collaboration', description: 'GitHub pull request, issue, and review volume proxies; volume is not quality.' },
  { id: 'current_year_contributions', displayName: 'Current-Year Contributions', description: 'Active observed UTC calendar-week coverage for the current year.' },
  { id: 'problem_solving_dsa', displayName: 'DSA & Problem-Solving', description: 'LeetCode difficulty-weighted solved-problem evidence; not reasoning quality.' },
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
    if (keys.length !== scoringCategories.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Every role must define exactly six category weights.' });
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 1e-8) context.addIssue({ code: z.ZodIssueCode.custom, message: `Role weights must total 100; received ${total}.` });
  });

export const roleWeightConfigurationSchema = z.object({ schemaVersion: z.literal(schemaVersion), scoringVersion: z.literal(scoringVersion), status: z.literal('active'), roles: z.record(roleIdSchema, roleWeightsSchema) });
export type RoleWeightConfiguration = z.infer<typeof roleWeightConfigurationSchema>;
export const categoryScoreSchema = z.object({
  categoryId: scoringCategorySchema,
  displayName: z.string().min(1),
  score: scoreSchema.optional(),
  confidence: confidenceSchema.optional(),
  status: z.enum(['scored', 'insufficient_evidence']),
  /** Explicit policy marker for a scored zero with no evidence reference. */
  scoreBasis: z.enum(['optional_missing_zero']).optional(),
  evidenceRefs: z.array(z.string().min(1)),
  explanation: z.string().min(1),
}).superRefine((value, context) => {
  if (value.status === 'scored' && value.score === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'A scored category requires a score.' });
  if (value.status === 'insufficient_evidence' && value.score !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['score'], message: 'Do not assign a score when evidence is insufficient.' });
  if (value.scoreBasis === 'optional_missing_zero'
    && (value.categoryId !== 'problem_solving_dsa' || value.score !== 0 || value.status !== 'scored' || value.evidenceRefs.length !== 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scoreBasis'], message: 'Only an evidence-free DSA zero may use the optional-missing policy.' });
  }
});
export type RoleWeights = z.infer<typeof roleWeightsSchema>;
export type CategoryScore = z.infer<typeof categoryScoreSchema>;
