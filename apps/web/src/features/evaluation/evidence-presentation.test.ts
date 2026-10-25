import { describe, expect, it } from 'vitest';
import type { CategoryScore, FinalReportCategory } from '@devrank/contracts';
import { categoryEvidenceStatus } from './evidence-presentation.js';

function reportCategory(metrics: FinalReportCategory['metrics'], status: FinalReportCategory['status'] = 'partial'): FinalReportCategory {
  return {
    categoryId: 'technical_skills', displayName: 'Technical Skills', weight: 20,
    source: 'github', status, metrics, formula: 'distinct languages / 5',
  };
}

const noScore: CategoryScore = {
  categoryId: 'technical_skills', displayName: 'Technical Skills', status: 'insufficient_evidence',
  evidenceRefs: [], explanation: 'Missing source evidence.',
};

describe('technical skills coverage presentation', () => {
  it('shows language and complete repository coverage counts', () => {
    expect(categoryEvidenceStatus(noScore, [], [], reportCategory({
      languageCoverageStatus: 'complete', repositoriesAnalyzed: 18, totalEligibleRepositories: 18,
      distinctRepositoryLanguages: 2, languagesObserved: 'Python, TypeScript',
    }, 'scored'))).toContain('Complete language coverage · 18 of 18 repositories analyzed · Languages observed: Python, TypeScript');
  });

  it('explains partial coverage and provider rate limits without assigning a score', () => {
    expect(categoryEvidenceStatus(noScore, [], [], reportCategory({
      languageCoverageStatus: 'partial', repositoriesAnalyzed: 10, totalEligibleRepositories: 18,
      distinctRepositoryLanguages: 2, languagesObserved: 'Python, TypeScript', languageRetrievalIssue: 'provider_rate_limited',
    }))).toContain('Partial language coverage · 10 of 18 repositories analyzed · Languages observed: Python, TypeScript · GitHub rate limit interrupted repository retrieval · no score assigned until coverage is complete');
  });

  it('distinguishes unavailable language data', () => {
    expect(categoryEvidenceStatus(noScore, [], [], reportCategory({
      languageCoverageStatus: 'unavailable', repositoriesAnalyzed: 0, totalEligibleRepositories: 18,
      distinctRepositoryLanguages: 0,
    }))).toBe('GitHub language data unavailable · 0 of 18 repositories analyzed · no score assigned');
  });
});
