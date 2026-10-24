import { describe, expect, it } from 'vitest';
import { summarizeGitHubLanguages } from './github-language-summary.js';

describe('GitHub language summary', () => {
  it('deduplicates observed languages and marks full repository coverage complete', () => {
    expect(summarizeGitHubLanguages([
      { primaryLanguage: 'TypeScript' }, { primaryLanguage: 'Python' }, { primaryLanguage: 'TypeScript' },
    ], 3, true)).toEqual({
      totalEligibleRepositories: 3, repositoriesAnalyzed: 3,
      observedLanguages: ['Python', 'TypeScript'], repositoriesMissingLanguage: 0, coverageStatus: 'complete',
    });
  });

  it('treats null as observed no-language metadata but missing language fields as incomplete', () => {
    expect(summarizeGitHubLanguages([{ primaryLanguage: null }, {}], 2, true)).toMatchObject({
      observedLanguages: [], repositoriesMissingLanguage: 1, coverageStatus: 'partial',
    });
  });

  it('marks an empty profile complete only when the provider confirms zero eligible repositories', () => {
    expect(summarizeGitHubLanguages([], 0, true)).toMatchObject({
      totalEligibleRepositories: 0, repositoriesAnalyzed: 0, coverageStatus: 'complete',
    });
    expect(summarizeGitHubLanguages([], 4, false, 'provider_timeout')).toMatchObject({
      totalEligibleRepositories: 4, repositoriesAnalyzed: 0, coverageStatus: 'unavailable', retrievalIssue: 'provider_timeout',
    });
  });
});
