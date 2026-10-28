import { describe, expect, it } from 'vitest';
import { aggregateGitHubReport, buildFinalEvaluationReport, combineProviderScores, evaluationResponseSchema, finalEvaluationReportSchema, finalRubric, providerRankingResponseSchema, providerScoresFromEvaluation, scoringCategories, schemaVersion, scoringVersion, type FinalEvaluationReport, type PlatformEvaluationEvidence } from './index.js';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const githubIds = finalRubric.categories.filter(({ source }) => source === 'github').map(({ id }) => id);

function reportWithScores(scores: Partial<Record<string, number>>): FinalEvaluationReport {
  const categories = finalRubric.categories.map((category) => {
    const score = scores[category.id];
    return { categoryId: category.id, displayName: category.displayName, weight: category.weight, source: category.source,
      status: score === undefined ? 'unavailable' as const : 'scored' as const,
      ...(score !== undefined ? { score, weightedPoints: Math.round(score * category.weight) / 100 } : {}), metrics: {}, formula: 'Existing v4 evidence index.' };
  });
  return finalEvaluationReportSchema.parse({ rubricId: finalRubric.id, status: 'partial', categories, notice: 'Test report.' });
}

function evidence(source: 'github' | 'leetcode', categoryId: string, evidenceType: PlatformEvaluationEvidence['evidenceType'], normalizedValue: Record<string, unknown>, overrides: Partial<PlatformEvaluationEvidence> = {}): PlatformEvaluationEvidence {
  return {
    evidenceId: `${source}:${categoryId}`, candidateId, source, evidenceType,
    availability: 'available', observedAt: '2026-10-27T10:00:00.000Z', normalizedValue,
    verificationStatus: 'unverified', provenance: source === 'github' ? 'github_api' : 'alfa_leetcode_api',
    freshness: 'unassessed', limitations: ['Test provider snapshot.'],
    categoryMappings: [{ rubricId: 'github_leetcode_v4', categoryId: categoryId as PlatformEvaluationEvidence['categoryMappings'][number]['categoryId'], relation: 'supporting' }],
    ...overrides,
  };
}

function validEvaluation(platformEvidence: PlatformEvaluationEvidence[], expectedId = candidateId, extra: Record<string, unknown> = {}) {
  const report = buildFinalEvaluationReport(platformEvidence);
  const evidenceRows = report.categories.flatMap((category) => category.score === undefined ? [] : [{
    evidenceId: `v4-index:${category.categoryId}`, evidenceType: category.categoryId === 'project_portfolio' ? 'portfolio' as const : 'other' as const,
    source: `${category.source} · provider`, description: 'Saved v4 source index.', normalizedValue: category.score,
    verificationStatus: 'unverified' as const, categoryId: category.categoryId, availability: 'available' as const,
  }]);
  const categoryScores = scoringCategories.map((category) => {
    const index = report.categories.find(({ categoryId }) => categoryId === category.id)!;
    const row = evidenceRows.find(({ categoryId }) => categoryId === category.id);
    return index.score === undefined ? {
      categoryId: category.id, displayName: category.displayName, status: 'insufficient_evidence' as const,
      evidenceRefs: [], explanation: 'No score available.',
    } : {
      categoryId: category.id, displayName: category.displayName, status: 'scored' as const, score: index.score,
      evidenceRefs: [row!.evidenceId], explanation: 'Validated saved source evidence.',
    };
  });
  return evaluationResponseSchema.parse({
    schemaVersion, scoringVersion, candidateId: expectedId, targetRole: 'software_developer',
    ...(report.overallScore !== undefined ? { overallScore: report.overallScore } : {}), categoryScores,
    roleWeightsUsed: Object.fromEntries(finalRubric.categories.map(({ id, weight }) => [id, weight])),
    evidence: evidenceRows, platformEvidence, finalReport: report,
    strengths: [], skillGaps: [], recommendations: [],
    missingEvidence: categoryScores.filter(({ status }) => status === 'insufficient_evidence').map(({ categoryId }) => categoryId),
    calculationExplanation: 'Test snapshot.', evaluationStatus: report.overallScore === undefined ? 'insufficient_evidence' : 'completed',
    aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.', ...extra,
  });
}

describe('GitHub + LeetCode provider ranking contract', () => {
  it('aggregates all five GitHub indexes using their existing weights normalized by 75', () => {
    const scores = Object.fromEntries(githubIds.map((id, index) => [id, [80, 60, 100, 40, 20][index]]));
    const aggregate = aggregateGitHubReport(reportWithScores(scores));
    expect(aggregate.githubScore).toBe((20 * 80 + 20 * 60 + 15 * 100 + 10 * 40 + 10 * 20) / 75);
    expect(aggregate.githubCoverage).toEqual({ availableCategories: 5, totalCategories: 5, status: 'complete' });
  });

  it('normalizes only available GitHub category weights and includes a genuine zero', () => {
    const aggregate = aggregateGitHubReport(reportWithScores({ project_portfolio: 0, collaboration: 80 }));
    expect(aggregate.githubScore).toBe((20 * 0 + 10 * 80) / 30);
    expect(aggregate.githubCoverage).toEqual({ availableCategories: 2, totalCategories: 5, status: 'partial' });
  });

  it('leaves the GitHub aggregate unavailable when all five categories are missing', () => {
    expect(aggregateGitHubReport(reportWithScores({}))).toEqual({
      githubCoverage: { availableCategories: 0, totalCategories: 5, status: 'unavailable' },
    });
  });

  it('rejects out-of-range category indexes and malformed category contracts', () => {
    expect(() => reportWithScores({ project_portfolio: 101 })).toThrow();
  });

  it('derives LeetCode only from supported provider-synced solved statistics', () => {
    const synced = evidence('leetcode', 'problem_solving_dsa', 'solved_statistics', { statistics: { easySolved: 10, mediumSolved: 20, hardSolved: 5, problemsSolved: 35 } });
    const result = providerScoresFromEvaluation(validEvaluation([synced]), candidateId);
    expect(result.leetcodeScore).toBeGreaterThan(0);
    expect(result.githubCoverage.status).toBe('unavailable');

    const enteredByRecruiter = evidence('leetcode', 'problem_solving_dsa', 'candidate_reported_statistics', { statistics: { problemsSolved: 100 } }, { provenance: 'candidate_provided' });
    expect(providerScoresFromEvaluation(validEvaluation([enteredByRecruiter]), candidateId).leetcodeScore).toBeUndefined();
  });

  it('rejects candidate-mismatched evidence and a result belonging to another candidate', () => {
    const source = evidence('github', 'project_portfolio', 'repository_snapshot', { publicRepositoryCount: 10 });
    const mismatched = { ...source, candidateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    expect(providerScoresFromEvaluation(validEvaluation([mismatched]), candidateId).githubScore).toBeUndefined();
    expect(providerScoresFromEvaluation(validEvaluation([source], 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), candidateId).githubScore).toBeUndefined();
  });

  it('does not use resume score fields when deriving provider indexes', () => {
    const providerEvidence = [evidence('github', 'project_portfolio', 'repository_snapshot', { publicRepositoryCount: 10 }),
      evidence('leetcode', 'problem_solving_dsa', 'solved_statistics', { statistics: { easySolved: 100, mediumSolved: 100, hardSolved: 100, problemsSolved: 300 } })];
    const withoutResume = providerScoresFromEvaluation(validEvaluation(providerEvidence, candidateId, { resumeScore: null }), candidateId);
    const withResume = providerScoresFromEvaluation(validEvaluation(providerEvidence, candidateId, { resumeScore: 12 }), candidateId);
    expect(withResume).toEqual(withoutResume);
  });

  it('combines validated provider indexes at 75/25, rounds to two decimals, and requires GitHub evidence', () => {
    expect(combineProviderScores(80, 60)).toBe(75);
    expect(combineProviderScores(0, 80)).toBe(20);
    expect(combineProviderScores(80, 100)).toBe(85);
    expect(combineProviderScores(80, undefined)).toBe(60);
    expect(combineProviderScores(80.12, 60.34)).toBe(75.18);
    expect(combineProviderScores(undefined, 80)).toBeUndefined();
    expect(combineProviderScores(undefined, undefined)).toBeUndefined();
    expect(combineProviderScores(101, 80)).toBeUndefined();
  });

  it('allows ranking by valid GitHub score while preserving unavailable LeetCode metadata', () => {
    const response = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion,
      providerWeights: { github: 75, leetcode: 25 },
      items: [{ candidateId, candidateName: 'Candidate', evaluationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        evaluatedAt: '2026-10-27T10:00:00.000Z', rank: 1, githubScore: 80,
        githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' },
        combinedScore: 60, status: 'ranked', missingProviders: ['leetcode'] }],
      page: 1, pageSize: 20, rankedTotal: 1, incompleteTotal: 0,
    });
    expect(response.items[0]).toMatchObject({ rank: 1, combinedScore: 60, status: 'ranked', missingProviders: ['leetcode'] });
    expect(response.items[0]).not.toHaveProperty('leetcodeScore');
  });
});
