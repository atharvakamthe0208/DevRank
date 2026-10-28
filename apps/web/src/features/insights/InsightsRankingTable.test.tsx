import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { providerRankingResponseSchema, rankingResponseSchema } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { InsightsRankingTable, ProviderRankingTable } from './InsightsPage';

const ranking = rankingResponseSchema.parse({
  roleId: 'software_developer',
  scoringVersion: '4.0.0',
  items: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', rank: 1, score: 82.5, evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z' }],
  page: 1,
  pageSize: 20,
  total: 1,
  excluded: { incomplete: 0, scoringVersionMismatch: 0, missingScore: 0, invalidSnapshot: 0 },
});

describe('InsightsRankingTable', () => {
  it('provides a named, keyboard-focusable scroll region and visible mobile cue', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(InsightsRankingTable, { ranking, roleDisplayName: 'Software Developer', candidateNames: new Map([[ranking.items[0]!.candidateId, 'A Candidate']]) }),
    ));

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Candidate rankings"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('On small screens, scroll horizontally');
    expect(markup).toContain('Ranked candidate evaluations for Software Developer');
    expect(markup).toContain('A Candidate');
    expect(markup).toContain('82.5');
  });
});

describe('ProviderRankingTable', () => {
  it('shows provider scores and coverage while leaving incomplete candidates unranked', () => {
    const providerRanking = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 50, leetcode: 50 },
      items: [
        { candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 3, totalCategories: 5, status: 'partial' }, leetcodeScore: 100, combinedScore: 90, status: 'ranked', missingProviders: [] },
        { candidateId: 'cc235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Incomplete Candidate', evaluationId: '9c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', githubCoverage: { availableCategories: 0, totalCategories: 5, status: 'unavailable' }, leetcodeScore: 0, status: 'incomplete', missingProviders: ['github'] },
      ],
      page: 1, pageSize: 20, rankedTotal: 1, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: providerRanking })));
    expect(markup).toContain('GitHub and LeetCode rankings. Resume scores are not included.');
    expect(markup).toContain('80');
    expect(markup).toContain('3/5 categories');
    expect(markup).toContain('90');
    expect(markup).toContain('Incomplete · missing github');
    expect(markup).toContain('Incomplete Candidate</a></td><td>Unavailable</td><td><strong>0.00</strong> / 100</td><td>—</td><td>Incomplete · missing github');
    expect(markup).toContain('weighted equally (50% each)');
    expect(markup).toContain('Resume scores are excluded');
  });

  it('provides accessible pagination when ranked and incomplete results span pages', () => {
    const paged = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 50, leetcode: 50 },
      items: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, leetcodeScore: 100, combinedScore: 90, status: 'ranked', missingProviders: [] }],
      page: 1, pageSize: 1, rankedTotal: 1, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: paged, onPageChange: () => undefined })));
    expect(markup).toContain('aria-label="Provider ranking pages"');
    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('>Next</button>');
  });
});
