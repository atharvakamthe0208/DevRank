import { z } from 'zod';
import { buildFinalEvaluationReport } from './proposed-report.js';
import { finalRubric, finalRubricId } from './proposed-rubric.js';
import { evaluationResponseSchema } from './evaluation-response.js';
import { roleIdSchema, scoringVersionSchema, scoringVersion, scoreSchema } from './scoring.js';
import type { FinalReportCategory, FinalEvaluationReport } from './proposed-report.js';
import type { PlatformEvaluationEvidence } from './platform-data.js';

export const providerRankingMode = 'github_leetcode' as const;
export const providerRankingWeights = { github: 50, leetcode: 50 } as const;
export const githubRankingCategories = finalRubric.categories.filter(({ source }) => source === 'github');

const githubCategoryIds = new Set<string>(githubRankingCategories.map(({ id }) => id));
const expectedEvidenceTypes: Record<string, PlatformEvaluationEvidence['evidenceType']> = {
  project_portfolio: 'repository_snapshot',
  technical_skills: 'repository_snapshot',
  development_activity: 'development_activity',
  collaboration: 'collaboration_activity',
  current_year_contributions: 'current_year_contributions',
  problem_solving_dsa: 'solved_statistics',
};

export const providerRankingQuerySchema = z.object({
  roleId: roleIdSchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const providerRankingItemSchema = z.object({
  candidateId: z.string().uuid(),
  candidateName: z.string().min(1),
  evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime({ offset: true }),
  rank: z.number().int().positive().optional(),
  githubScore: scoreSchema.optional(),
  githubCoverage: z.object({
    availableCategories: z.number().int().min(0).max(5),
    totalCategories: z.literal(5),
    status: z.enum(['complete', 'partial', 'unavailable']),
  }).strict(),
  leetcodeScore: scoreSchema.optional(),
  combinedScore: scoreSchema.optional(),
  status: z.enum(['ranked', 'incomplete']),
  missingProviders: z.array(z.enum(['github', 'leetcode'])).max(2),
}).strict().superRefine((item, context) => {
  const githubCount = item.githubCoverage.availableCategories;
  const expectedCoverage = githubCount === 0 ? 'unavailable' : githubCount === 5 ? 'complete' : 'partial';
  if (item.githubCoverage.status !== expectedCoverage || (item.githubScore !== undefined) !== (githubCount > 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['githubCoverage'], message: 'GitHub coverage must match the available category scores.' });
  }
  const expectedMissing = [
    ...(item.githubScore === undefined ? ['github' as const] : []),
    ...(item.leetcodeScore === undefined ? ['leetcode' as const] : []),
  ];
  if (item.missingProviders.join('|') !== expectedMissing.join('|')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingProviders'], message: 'Missing providers must match unavailable provider scores.' });
  }
  const bothAvailable = item.githubScore !== undefined && item.leetcodeScore !== undefined;
  if ((item.status === 'ranked') !== bothAvailable
    || (item.rank !== undefined) !== bothAvailable
    || (item.combinedScore !== undefined) !== bothAvailable) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Only candidates with both provider scores receive a combined score and rank.' });
  }
  if (bothAvailable && item.combinedScore !== undefined
    && Math.abs(item.combinedScore - ((item.githubScore! + item.leetcodeScore!) / 2)) >= 1e-8) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['combinedScore'], message: 'Combined score must use equal 50/50 provider weights.' });
  }
});

export const providerRankingResponseSchema = z.object({
  mode: z.literal(providerRankingMode),
  roleId: roleIdSchema,
  rubricId: z.literal(finalRubricId),
  scoringVersion: scoringVersionSchema,
  providerWeights: z.object({ github: z.literal(50), leetcode: z.literal(50) }).strict(),
  items: z.array(providerRankingItemSchema).max(100),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  rankedTotal: z.number().int().nonnegative(),
  incompleteTotal: z.number().int().nonnegative(),
}).strict().superRefine((response, context) => {
  if (response.items.some((item) => item.status === 'ranked' && item.rank! > response.rankedTotal)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Ranks must fit within the ranked candidate total.' });
  }
  const seen = new Set<string>();
  for (const item of response.items) {
    if (seen.has(item.candidateId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'A candidate may appear only once.' });
    seen.add(item.candidateId);
  }
});

export type ProviderRankingQuery = z.infer<typeof providerRankingQuerySchema>;
export type ProviderRankingItem = z.infer<typeof providerRankingItemSchema>;
export type ProviderRankingResponse = z.infer<typeof providerRankingResponseSchema>;
export type ProviderScoreSummary = Pick<ProviderRankingItem, 'githubScore' | 'githubCoverage' | 'leetcodeScore'>;

export function combineProviderScores(githubScore: number | undefined, leetcodeScore: number | undefined) {
  if (githubScore === undefined || leetcodeScore === undefined) return undefined;
  const github = scoreSchema.safeParse(githubScore);
  const leetcode = scoreSchema.safeParse(leetcodeScore);
  if (!github.success || !leetcode.success) return undefined;
  return (github.data * providerRankingWeights.github + leetcode.data * providerRankingWeights.leetcode) / 100;
}

function githubAggregate(categories: FinalReportCategory[]) {
  const scores = githubRankingCategories.flatMap((canonical) => {
    const item = categories.find(({ categoryId }) => categoryId === canonical.id);
    return item?.source === 'github' && item.status === 'scored' && typeof item.score === 'number' && Number.isFinite(item.score)
      ? [{ weight: canonical.weight, score: item.score }]
      : [];
  });
  const weightTotal = scores.reduce((sum, item) => sum + item.weight, 0);
  return {
    ...(weightTotal > 0 ? { githubScore: scores.reduce((sum, item) => sum + item.weight * item.score, 0) / weightTotal } : {}),
    githubCoverage: {
      availableCategories: scores.length,
      totalCategories: 5 as const,
      status: scores.length === 0 ? 'unavailable' as const : scores.length === 5 ? 'complete' as const : 'partial' as const,
    },
  };
}

/**
 * Derive provider indexes only from the existing active-v4 evidence path.
 * LeetCode must be provider-synced (`alfa_leetcode_api`); recruiter-entered
 * statistics and the optional-missing DSA zero are intentionally unavailable.
 */
export function providerScoresFromEvaluation(value: unknown, expectedCandidateId: string): ProviderScoreSummary {
  const unavailable = { githubCoverage: { availableCategories: 0, totalCategories: 5 as const, status: 'unavailable' as const } };
  const parsed = evaluationResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.candidateId !== expectedCandidateId || parsed.data.scoringVersion !== scoringVersion
    || !parsed.data.platformEvidence || parsed.data.platformEvidence.some(({ candidateId }) => candidateId !== expectedCandidateId)) return unavailable;

  const evidence = parsed.data.platformEvidence.flatMap((item) => {
    const expectedSource = item.source === 'github' && item.provenance === 'github_api'
      ? 'github' : item.source === 'leetcode' && item.provenance === 'alfa_leetcode_api' ? 'leetcode' : undefined;
    if (!expectedSource) return [];
    const categoryMappings = item.categoryMappings.filter((mapping) => {
      const category = finalRubric.categories.find(({ id }) => id === mapping.categoryId);
      return mapping.rubricId === finalRubricId && mapping.relation === 'supporting'
        && category?.source === expectedSource
        && expectedEvidenceTypes[mapping.categoryId] === item.evidenceType
        && (expectedSource !== 'github' || githubCategoryIds.has(mapping.categoryId));
    });
    return categoryMappings.length ? [{ ...item, categoryMappings }] : [];
  });
  if (!evidence.length) return unavailable;

  let report: FinalEvaluationReport;
  try { report = buildFinalEvaluationReport(evidence); }
  catch { return unavailable; }
  const github = githubAggregate(report.categories);
  const dsa = report.categories.find(({ categoryId, source, status, score }) =>
    categoryId === 'problem_solving_dsa' && source === 'leetcode' && status === 'scored' && typeof score === 'number' && Number.isFinite(score));
  return { ...github, ...(dsa?.score !== undefined ? { leetcodeScore: dsa.score } : {}) };
}

/** Aggregate a previously validated v4 report; useful for deterministic tests and consumers. */
export function aggregateGitHubReport(report: FinalEvaluationReport) {
  return githubAggregate(report.categories);
}
