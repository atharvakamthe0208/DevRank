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

describe('proposed evaluation report', () => {
  it('computes documented draft indexes and weighted proposal total from a complete snapshot', () => {
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
    expect(report.notice).toContain('not an engineering-quality');
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
});
