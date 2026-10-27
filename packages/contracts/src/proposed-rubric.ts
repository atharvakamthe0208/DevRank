import { z } from 'zod';

/** Historical proposal metadata. The activated policy is finalRubric (v4) below. */
export const proposedRubricId = 'github_leetcode_proposal_v1' as const;
export const proposedRubricStatus = 'proposed' as const;
export const proposedRubricTimezone = 'UTC' as const;

export const proposedRubricCategories = [
  { id: 'project_portfolio', displayName: 'Project Portfolio', proposedWeight: 20, source: 'github', definition: 'Role-relevant public projects and portfolio material; repository popularity is not quality.' },
  { id: 'technical_skills', displayName: 'Technical Skills', proposedWeight: 20, source: 'github', definition: 'Technologies evidenced by attributable repository language metadata and separately assessed technical work.' },
  { id: 'development_activity', displayName: 'Development Activity', proposedWeight: 15, source: 'github', definition: 'Attributable commit history and activity patterns; counts do not establish code quality.' },
  { id: 'collaboration', displayName: 'Collaboration', proposedWeight: 10, source: 'github', definition: 'Attributable pull-request, issue, and review activity; volume does not establish collaboration quality.' },
  { id: 'current_year_contributions', displayName: 'Current-Year Contributions', proposedWeight: 10, source: 'github', definition: 'Attributable contribution volume and distribution during the UTC calendar year.' },
  { id: 'problem_solving_dsa', displayName: 'DSA & Problem-Solving', proposedWeight: 25, source: 'leetcode', definition: 'LeetCode solved-by-difficulty and contest evidence, when available; counts do not establish reasoning quality.' },
] as const;

export const proposedRubricCategorySchema = z.enum([
  'project_portfolio', 'technical_skills', 'development_activity', 'collaboration',
  'current_year_contributions', 'problem_solving_dsa',
]);
export type ProposedRubricCategory = z.infer<typeof proposedRubricCategorySchema>;

export const proposedRubricSchema = z.object({
  id: z.literal(proposedRubricId),
  status: z.literal(proposedRubricStatus),
  timezone: z.literal(proposedRubricTimezone),
  categories: z.array(z.object({
    id: proposedRubricCategorySchema,
    displayName: z.string().min(1),
    proposedWeight: z.number().min(0).max(100),
    source: z.enum(['github', 'leetcode']),
    definition: z.string().min(1),
  }).strict()).length(6),
}).strict().superRefine((value, context) => {
  const expectedIds = proposedRubricCategories.map(({ id }) => id);
  if (new Set(value.categories.map(({ id }) => id)).size !== expectedIds.length
    || expectedIds.some((id) => !value.categories.some((category) => category.id === id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'The proposal must contain each of its six categories exactly once.' });
  }
  for (const category of value.categories) {
    const canonical = proposedRubricCategories.find(({ id }) => id === category.id);
    if (canonical && (category.source !== canonical.source || category.proposedWeight !== canonical.proposedWeight)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Proposal sources and weights must match the reviewed draft.' });
    }
  }
  const total = value.categories.reduce((sum, category) => sum + category.proposedWeight, 0);
  if (total !== 100) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Draft weights must total 100.' });
});
export const proposedRubric = proposedRubricSchema.parse({
  id: proposedRubricId,
  status: proposedRubricStatus,
  timezone: proposedRubricTimezone,
  categories: proposedRubricCategories,
});

/** Active policy for new v4 evaluations. Existing v1/v2/v3 snapshots retain their original categories. */
export const finalRubricId = 'github_leetcode_v4' as const;
export const finalRubricSchema = z.object({
  id: z.literal(finalRubricId),
  status: z.literal('active'),
  timezone: z.literal(proposedRubricTimezone),
  categories: z.array(z.object({
    id: proposedRubricCategorySchema, displayName: z.string().min(1), weight: z.number().min(0).max(100),
    source: z.enum(['github', 'leetcode']), definition: z.string().min(1),
  }).strict()).length(6),
}).strict().superRefine((value, context) => {
  const ids = proposedRubricCategories.map(({ id }) => id);
  if (new Set(value.categories.map(({ id }) => id)).size !== ids.length
    || ids.some((id) => !value.categories.some((category) => category.id === id))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'The active rubric must contain each of its six categories exactly once.' });
  }
  for (const category of value.categories) {
    const canonical = proposedRubricCategories.find(({ id }) => id === category.id);
    if (canonical && (category.weight !== canonical.proposedWeight || category.source !== canonical.source)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Active rubric weights and sources must match the approved v4 policy.' });
    }
  }
  if (value.categories.reduce((sum, category) => sum + category.weight, 0) !== 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Active rubric weights must total 100.' });
  }
});
export type FinalRubric = z.infer<typeof finalRubricSchema>;
export const finalRubric: FinalRubric = finalRubricSchema.parse({
  id: finalRubricId,
  status: 'active' as const,
  timezone: proposedRubricTimezone,
  categories: proposedRubricCategories.map(({ id, displayName, proposedWeight, source, definition }) => ({
    id, displayName, weight: proposedWeight, source, definition,
  })),
});
