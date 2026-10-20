import { describe, expect, it } from 'vitest';
import { buildProposedEvaluationReport, proposedRubricCategorySchema, type PlatformEvaluationEvidence } from './index.js';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function evidence(overrides: { evidenceType: PlatformEvaluationEvidence['evidenceType']; source: PlatformEvaluationEvidence['source']; normalizedValue: Record<string, unknown>; categoryId: typeof proposedRubricCategorySchema._type; availability?: PlatformEvaluationEvidence['availability'] }): PlatformEvaluationEvidence {
  const rubricId = 'github_leetcode_proposal_v1' as const;
  return {
    evidenceId: `${overrides.source}:${overrides.evidenceType}`, candidateId,
    availability: 'available', observedAt: '2026-10-17T00:00:00.000Z', verificationStatus: 'unverified',
    provenance: overrides.source === 'github' ? 'github_api' : 'alfa_leetcode_api', freshness: 'unassessed', limitations: [],
    categoryMappings: [{ rubricId, categoryId: overrides.categoryId, relation: 'supporting' }],
    ...overrides,
  };
}

describe('active v4 evaluation report', () => {
  it('computes documented indexes and weighted total from a complete snapshot', () => {
    const report = buildProposedEvaluationReport([
      evidence({ evidenceType: 'repository_snapshot', source: 'github', categoryId: 'project_portfolio', normalizedValue: { publicRepositoryCount: 3, repositories: [{ primaryLanguage: 'TypeScript' }, { primaryLanguage: 'Python' }, { primaryLanguage: 'Go' }] } }),
      evidence({ evidenceType: 'repository_snapshot', source: 'github', categoryId: 'technical_skills', normalizedValue: { publicRepositoryCount: 3, repositories: [{ primaryLanguage: 'TypeScript' }, { primaryLanguage: 'Python' }, { primaryLanguage: 'Go' }] } }),
      evidence({ evidenceType: 'development_activity', source: 'github', categoryId: 'development_activity', normalizedValue: { totalCommitContributions: 10, activeCommitDays: 4, activeCommitWeeks: 2 } }),
      evidence({ evidenceType: 'collaboration_activity', source: 'github', categoryId: 'collaboration', normalizedValue: { pullRequestsOpened: 5, issuesOpened: 5, reviewsSubmitted: 5 } }),
      evidence({ evidenceType: 'current_year_contributions', source: 'github', categoryId: 'current_year_contributions', normalizedValue: { year: 2026, timezone: 'UTC', totalContributions: 100, observedThrough: '2026-10-16T23:59:59.999Z', activeWeeks: 5, observedWeeks: 10, activeWeekCoveragePercent: 50 } }),
      evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', normalizedValue: { statistics: { easySolved: 10, mediumSolved: 20, hardSolved: 5, problemsSolved: 35 } } }),
    ]);
    expect(report.status).toBe('complete');
    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.categories).toHaveLength(6);
    expect(report.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({ metrics: { difficultyWeightedSolved: 65 } });
    expect(report.categories.find(({ categoryId }) => categoryId === 'collaboration')?.score).toBe(45.57);
    expect(report.categories.find(({ categoryId }) => categoryId === 'current_year_contributions')?.score).toBe(50);
    expect(report.notice).toContain('not calibrated measures of engineering competence');
  });

  it('withholds the weighted total and leaves missing source values unavailable', () => {
    const report = buildProposedEvaluationReport([
      evidence({ evidenceType: 'current_year_contributions', source: 'github', categoryId: 'current_year_contributions', availability: 'partial', normalizedValue: { year: 2026, totalContributions: 10 } }),
    ]);
    expect(report.status).toBe('partial');
    expect(report).not.toHaveProperty('overallScore');
    expect(report.categories.find(({ categoryId }) => categoryId === 'project_portfolio')).toMatchObject({ status: 'unavailable' });
    expect(report.categories.find(({ categoryId }) => categoryId === 'current_year_contributions')).toMatchObject({ status: 'partial' });
  });

  it('does not score language breadth from a truncated repository sample', () => {
    const report = buildProposedEvaluationReport([
      evidence({ evidenceType: 'repository_snapshot', source: 'github', categoryId: 'project_portfolio', normalizedValue: {
        publicRepositoryCount: 30, repositoriesTruncated: true,
        repositories: [{ primaryLanguage: 'TypeScript' }, { primaryLanguage: 'Python' }],
      } }),
      evidence({ evidenceType: 'repository_snapshot', source: 'github', categoryId: 'technical_skills', normalizedValue: {
        publicRepositoryCount: 30, repositoriesTruncated: true,
        repositories: [{ primaryLanguage: 'TypeScript' }, { primaryLanguage: 'Python' }],
      } }),
    ]);
    expect(report.categories.find(({ categoryId }) => categoryId === 'project_portfolio')?.status).toBe('scored');
    expect(report.categories.find(({ categoryId }) => categoryId === 'technical_skills')).toMatchObject({ status: 'partial', metrics: { distinctRepositoryLanguages: 2 } });
    expect(report.categories.find(({ categoryId }) => categoryId === 'technical_skills')).not.toHaveProperty('score');
  });

  it('uses the exact capped LeetCode v4 index for 100 easy, 92 medium, and 16 hard', () => {
    const dsa = buildProposedEvaluationReport([
      evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', normalizedValue: {
        statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: 92, hardSolved: 16 },
      } }),
    ]).categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')!;

    expect(dsa).toMatchObject({ status: 'scored', score: 100, metrics: {
      easySolved: 100, mediumSolved: 92, hardSolved: 16, difficultyWeightedSolved: 332,
      scoringBasis: 'Difficulty-weighted count (easy=1, medium=2, hard=3)',
    } });
    expect(dsa.formula).toContain('ln(301)');
    expect(dsa.formula).toContain('caps at 100 once count reaches 300');
  });

  it('labels and uses the provider total only when every difficulty field is absent', () => {
    const dsa = buildProposedEvaluationReport([
      evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', normalizedValue: { statistics: { problemsSolved: 208 } } }),
    ]).categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')!;
    expect(dsa).toMatchObject({ status: 'scored', metrics: {
      difficultyWeightedSolved: 208,
      scoringBasis: 'Provider total fallback (difficulty breakdown unavailable)',
    } });
  });

  it('keeps missing, partial, malformed, and unavailable DSA evidence distinct without filling missing counts', () => {
    const category = (items: PlatformEvaluationEvidence[]) => buildProposedEvaluationReport(items)
      .categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')!;

    const missing = category([]);
    expect(missing.status).toBe('unavailable');
    expect(missing).not.toHaveProperty('score');
    expect(missing.metrics).toEqual({});

    const partial = category([evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', availability: 'partial', normalizedValue: { statistics: { easySolved: 100 } } })]);
    expect(partial).toMatchObject({ status: 'partial', metrics: { easySolved: 100 } });
    expect(partial.metrics).not.toHaveProperty('mediumSolved');
    expect(partial.metrics).not.toHaveProperty('hardSolved');
    expect(partial).not.toHaveProperty('score');

    const malformed = category([evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', normalizedValue: {
      statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: '92', hardSolved: 16 },
    } })]);
    expect(malformed).toMatchObject({ status: 'partial', metrics: {
      easySolved: 100, hardSolved: 16,
      difficultyDataStatus: 'Malformed or partial difficulty breakdown; index withheld',
    } });
    expect(malformed.metrics).not.toHaveProperty('mediumSolved');
    expect(malformed.metrics).not.toHaveProperty('difficultyWeightedSolved');
    expect(malformed).not.toHaveProperty('score');

    const unavailable = category([evidence({ evidenceType: 'solved_statistics', source: 'leetcode', categoryId: 'problem_solving_dsa', availability: 'unavailable', normalizedValue: { statistics: { easySolved: 100, mediumSolved: 92, hardSolved: 16 } } })]);
    expect(unavailable).toMatchObject({ status: 'unavailable', metrics: { difficultyWeightedSolved: 332 } });
    expect(unavailable).not.toHaveProperty('score');
  });
});
