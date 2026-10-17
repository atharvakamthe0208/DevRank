import { proposedRubric, type ProposedRubricCategory } from './proposed-rubric.js';
import { platformEvaluationEvidenceSchema, type PlatformEvaluationEvidence } from './platform-data.js';
import { z } from 'zod';

export type ProposedReportValue = string | number | boolean;
export type ProposedReportCategory = {
  categoryId: ProposedRubricCategory;
  displayName: string;
  weight: number;
  source: 'github' | 'leetcode';
  status: 'scored' | 'partial' | 'unavailable';
  score?: number;
  weightedPoints?: number;
  metrics: Record<string, ProposedReportValue>;
  formula: string;
};
export type ProposedEvaluationReport = {
  rubricId: typeof proposedRubric.id;
  status: 'complete' | 'partial';
  overallScore?: number;
  categories: ProposedReportCategory[];
  notice: string;
};

export const proposedReportValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export const proposedReportCategorySchema = z.object({
  categoryId: z.enum(['project_portfolio', 'technical_skills', 'development_activity', 'collaboration', 'current_year_contributions', 'problem_solving_dsa']),
  displayName: z.string().min(1), weight: z.number().min(0).max(100), source: z.enum(['github', 'leetcode']),
  status: z.enum(['scored', 'partial', 'unavailable']), score: z.number().finite().min(0).max(100).optional(),
  weightedPoints: z.number().finite().min(0).max(100).optional(), metrics: z.record(proposedReportValueSchema), formula: z.string().min(1),
}).strict();
export const proposedEvaluationReportSchema = z.object({
  rubricId: z.literal(proposedRubric.id), status: z.enum(['complete', 'partial']), overallScore: z.number().finite().min(0).max(100).optional(),
  categories: z.array(proposedReportCategorySchema).length(6), notice: z.string().min(1),
}).strict().superRefine((report, context) => {
  if ((report.status === 'complete') !== (report.overallScore !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'A weighted draft total is only present when all categories are scoreable.' });
  if (report.categories.some(({ status, score, weightedPoints }) => (status === 'scored') !== (score !== undefined)
    || (score === undefined) !== (weightedPoints === undefined))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Only complete category evidence may produce an index and weighted points.' });
  if (report.status === 'complete' && report.categories.some(({ status }) => status !== 'scored')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'A complete weighted total requires all six category indexes.' });
  const expectedIds = proposedRubric.categories.map(({ id }) => id);
  if (new Set(report.categories.map(({ categoryId }) => categoryId)).size !== expectedIds.length
    || expectedIds.some((id) => !report.categories.some((category) => category.categoryId === id))) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'A report must include each proposal category exactly once.' });
  for (const item of report.categories) {
    const canonical = proposedRubric.categories.find(({ id }) => id === item.categoryId);
    if (!canonical || item.weight !== canonical.proposedWeight || item.source !== canonical.source || item.displayName !== canonical.displayName) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Report categories must match the reviewed proposal.' });
    }
    if (item.score !== undefined && item.weightedPoints !== undefined
      && Math.abs(item.weightedPoints - Math.round(item.score * item.weight) / 100) >= 0.005) context.addIssue({ code: z.ZodIssueCode.custom, path: ['categories'], message: 'Weighted points must match the category index and proposed weight.' });
  }
  if (report.overallScore !== undefined) {
    const expectedTotal = Math.round(report.categories.reduce((sum, item) => sum + (item.weightedPoints ?? 0), 0) * 100) / 100;
    if (Math.abs(report.overallScore - expectedTotal) >= 0.005) context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'Weighted total must equal the sum of category weighted points.' });
  }
});

export function parseProposedPlatformEvidence(value: unknown): PlatformEvaluationEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = platformEvaluationEvidenceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

const target = { project_portfolio: 10, technical_skills: 5, development_activity: 250, collaboration: 50, problem_solving_dsa: 300 } as const;
const proposalNotice = 'Draft evidence index only. It is not an engineering-quality or hiring score, is not approved policy, does not affect active v3 results or rankings, and cannot be compared across different snapshot dates or evidence coverage.';

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finiteCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizedLog(value: number, cap: number): number {
  return Math.round(Math.min(100, Math.log1p(value) / Math.log1p(cap) * 100) * 100) / 100;
}

function sumNumericKeys(value: unknown, keys: string[]): { total: number; complete: boolean; available: number } {
  const source = record(value) ?? {};
  const values = keys.map((key) => finiteCount(source[key]));
  return { total: values.reduce<number>((sum, item) => sum + (item ?? 0), 0), complete: values.every((item) => item !== undefined), available: values.filter((item) => item !== undefined).length };
}

/**
 * Deterministic, proposal-only normalizations. These indexes summarize evidence volume/breadth,
 * not competence. A complete weighted proposal score is withheld unless every category is scoreable.
 */
export function buildProposedEvaluationReport(evidence: PlatformEvaluationEvidence[]): ProposedEvaluationReport {
  const mapped = (id: ProposedRubricCategory) => evidence.filter((item) => item.categoryMappings.some((mapping) => mapping.rubricId === proposedRubric.id && mapping.categoryId === id));
  const firstValue = (id: ProposedRubricCategory, type: PlatformEvaluationEvidence['evidenceType']) => mapped(id).find((item) => item.evidenceType === type);
  const categories: ProposedReportCategory[] = proposedRubric.categories.map((category) => {
    const row: ProposedReportCategory = { categoryId: category.id, displayName: category.displayName, weight: category.proposedWeight, source: category.source, status: 'unavailable', metrics: {}, formula: '' };
    if (category.id === 'project_portfolio') {
      const repo = firstValue(category.id, 'repository_snapshot');
      const count = finiteCount(repo?.normalizedValue.publicRepositoryCount);
      if (count !== undefined) {
        row.metrics.publicRepositoryCount = count;
        const repos = Array.isArray(repo?.normalizedValue.repositories) ? repo.normalizedValue.repositories : [];
        const names = repos.flatMap((item) => {
          const name = record(item)?.name;
          return typeof name === 'string' && name.trim() ? [name.trim()] : [];
        });
        if (names.length) row.metrics.repositoriesObserved = names.join(', ');
        if (repo?.availability === 'available') {
          row.score = normalizedLog(count, target.project_portfolio);
          row.status = 'scored';
        } else row.status = 'partial';
      }
      row.formula = `log1p(public repository count) / log1p(${target.project_portfolio}), capped at 100; quantity proxy only.`;
    } else if (category.id === 'technical_skills') {
      const repo = firstValue(category.id, 'repository_snapshot');
      const repos = Array.isArray(repo?.normalizedValue.repositories) ? repo.normalizedValue.repositories : [];
      const languages = [...new Set(repos.flatMap((item) => {
        const language = record(item)?.primaryLanguage;
        return typeof language === 'string' && language.trim() ? [language.trim()] : [];
      }))].sort((a, b) => a.localeCompare(b));
      if (languages.length > 0) {
        row.metrics.distinctRepositoryLanguages = languages.length;
        row.metrics.languagesObserved = languages.join(', ');
        if (repo?.availability === 'available'
          && repo.normalizedValue.repositoriesTruncated !== true
          && finiteCount(repo.normalizedValue.publicRepositoryCount) !== undefined
          && finiteCount(repo.normalizedValue.publicRepositoryCount)! <= repos.length) {
          row.score = Math.round(Math.min(100, languages.length / target.technical_skills * 100) * 100) / 100;
          row.status = 'scored';
        } else row.status = 'partial';
      }
      row.formula = `distinct observed repository languages / ${target.technical_skills}, capped at 100; language breadth proxy only.`;
    } else if (category.id === 'development_activity') {
      const activity = firstValue(category.id, 'development_activity');
      const commits = finiteCount(activity?.normalizedValue.totalCommitContributions);
      if (commits !== undefined) {
        row.metrics.commitContributions = commits;
        const days = finiteCount(activity?.normalizedValue.activeCommitDays);
        const weeks = finiteCount(activity?.normalizedValue.activeCommitWeeks);
        const repositoryCount = finiteCount(activity?.normalizedValue.repositoriesWithCommitContributions);
        if (days !== undefined) row.metrics.activeCommitDays = days;
        if (weeks !== undefined) row.metrics.activeCommitWeeks = weeks;
        if (repositoryCount !== undefined) row.metrics.repositoriesWithCommitContributions = repositoryCount;
        if (activity?.availability === 'available') {
          row.score = normalizedLog(commits, target.development_activity);
          row.status = 'scored';
        } else row.status = 'partial';
      } else if (activity && activity.availability === 'partial') row.status = 'partial';
      row.formula = `log1p(attributable commit contributions) / log1p(${target.development_activity}), capped at 100.`;
    } else if (category.id === 'collaboration') {
      const activity = firstValue(category.id, 'collaboration_activity');
      const items = sumNumericKeys(activity?.normalizedValue, ['pullRequestsOpened', 'issuesOpened', 'reviewsSubmitted']);
      const source = record(activity?.normalizedValue) ?? {};
      for (const key of ['pullRequestsOpened', 'issuesOpened', 'reviewsSubmitted']) {
        const value = finiteCount(source[key]);
        if (value !== undefined) row.metrics[key] = value;
      }
      if (items.complete && activity?.availability === 'available') {
        row.score = Math.round((['pullRequestsOpened', 'issuesOpened', 'reviewsSubmitted'].reduce((sum, key) => sum + normalizedLog(finiteCount(source[key])!, target.collaboration), 0) / 3) * 100) / 100;
        row.status = 'scored';
      } else if (activity && (items.available > 0 || activity.availability === 'partial')) row.status = 'partial';
      row.formula = `mean of the three separate log1p(activity count) / log1p(${target.collaboration}) indexes; all three signals required.`;
    } else if (category.id === 'current_year_contributions') {
      const current = firstValue(category.id, 'current_year_contributions');
      const total = finiteCount(current?.normalizedValue.totalContributions);
      const coverage = finiteCount(current?.normalizedValue.activeWeekCoveragePercent);
      if (total !== undefined) {
        row.metrics.year = finiteCount(current?.normalizedValue.year) ?? 'Unavailable';
        row.metrics.timezone = typeof current?.normalizedValue.timezone === 'string' ? current.normalizedValue.timezone : 'Unavailable';
        row.metrics.totalContributions = total;
        row.metrics.observedThrough = typeof current?.normalizedValue.observedThrough === 'string' ? current.normalizedValue.observedThrough : 'Unavailable';
        for (const key of ['observedWeeks', 'activeWeeks', 'activeWeekCoveragePercent', 'contributionsPerObservedWeek']) {
          const value = finiteCount(current?.normalizedValue[key]);
          if (value !== undefined) row.metrics[key] = value;
        }
        const types = record(current?.normalizedValue.contributionTypes);
        for (const key of ['commits', 'pullRequestsOpened', 'issuesOpened', 'reviewsSubmitted']) {
          const value = finiteCount(types?.[key]);
          if (value !== undefined) row.metrics[`calendarType_${key}`] = value;
        }
        if (current?.availability === 'available' && coverage !== undefined) {
          row.score = Math.round(Math.min(100, coverage) * 100) / 100;
          row.status = 'scored';
        } else row.status = 'partial';
      } else if (current && (current.availability === 'partial' || current.availability === 'available')) row.status = 'partial';
      row.formula = 'active observed UTC weeks / observed UTC weeks × 100; distribution index only. Calendar and contribution-type totals are shown as context, not scored here.';
    } else {
      const solved = firstValue(category.id, 'solved_statistics') ?? firstValue(category.id, 'candidate_reported_statistics');
      const contest = firstValue(category.id, 'contest_statistics');
      const stats = record(solved?.normalizedValue.statistics) ?? {};
      const points = finiteCount(stats.easySolved) !== undefined && finiteCount(stats.mediumSolved) !== undefined && finiteCount(stats.hardSolved) !== undefined
        ? finiteCount(stats.easySolved)! + 2 * finiteCount(stats.mediumSolved)! + 3 * finiteCount(stats.hardSolved)!
        : finiteCount(stats.problemsSolved);
      if (points !== undefined) {
        row.metrics.easySolved = finiteCount(stats.easySolved) ?? 'Unavailable';
        row.metrics.mediumSolved = finiteCount(stats.mediumSolved) ?? 'Unavailable';
        row.metrics.hardSolved = finiteCount(stats.hardSolved) ?? 'Unavailable';
        row.metrics.difficultyWeightedSolved = points;
        if (solved?.availability === 'available') {
          row.score = normalizedLog(points, target.problem_solving_dsa);
          row.status = 'scored';
        } else row.status = 'partial';
      } else if ((solved && solved.availability === 'partial') || (contest && contest.availability === 'available')) row.status = 'partial';
      if (contest?.availability === 'available') {
        const contestStats = record(contest.normalizedValue.statistics) ?? {};
        for (const key of ['contestsAttended', 'contestRating', 'contestGlobalRanking', 'contestTopPercentage']) {
          const value = finiteCount(contestStats[key]);
          if (value !== undefined) row.metrics[key] = value;
        }
      }
      row.formula = `difficulty-weighted solved count (easy=1, medium=2, hard=3), falling back to provider total when difficulty breakdown is absent; log1p(points) / log1p(${target.problem_solving_dsa}), capped at 100. Contest data is context only.`;
    }
    const savedSource = mapped(category.id)[0];
    if (savedSource) row.metrics.sourceCapturedAt = savedSource.observedAt;
    if (row.score !== undefined) row.weightedPoints = Math.round(row.score * row.weight / 100 * 100) / 100;
    return row;
  });
  const complete = categories.every(({ status, score }) => status === 'scored' && score !== undefined);
  return proposedEvaluationReportSchema.parse({
    rubricId: proposedRubric.id,
    status: complete ? 'complete' : 'partial',
    ...(complete ? { overallScore: Math.round(categories.reduce((sum, category) => sum + (category.weightedPoints ?? 0), 0) * 100) / 100 } : {}),
    categories,
    notice: proposalNotice,
  });
}
