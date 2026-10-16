import { z } from 'zod';

/** Draft taxonomy for GitHub/LeetCode context. These weights are proposals only. */
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

export const proposedRubricCategorySchema = z.enum(proposedRubricCategories.map(({ id }) => id) as [string, ...string[]]);
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
