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
  candidateRows: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'A Candidate', rank: 1, finalScore: 82.5, evaluatedAt: '2026-10-26T10:00:00.000Z', githubUsername: 'github-person', githubScore: 80, leetcodeUsername: 'leetcode-person', leetcodeScore: 90, evaluationStatus: 'completed', missingEvidence: [] }],
  page: 1,
  pageSize: 20,
  total: 1,
  excluded: { incomplete: 0, scoringVersionMismatch: 0, missingScore: 0, invalidSnapshot: 0 },
});

describe('InsightsRankingTable', () => {
  it('provides a named, keyboard-focusable scroll region and visible mobile cue', () => {
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(InsightsRankingTable, { ranking, roleDisplayName: 'Software Developer' }),
    ));

    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Candidate rankings"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('On small screens, scroll horizontally');
    expect(markup).toContain('Candidate platform scores and saved evaluation results for Software Developer');
    expect(markup).toContain('A Candidate');
    expect(markup).toContain('82.5');
    expect(markup).toContain('github-person');
    expect(markup).toContain('leetcode-person');
    expect(markup).toContain('GitHub Score');
    expect(markup).toContain('LeetCode Score');
    expect(markup).toContain('href="/candidates/bb235ee8-a6cf-407b-b8b6-66e4e540f14c/report?roleId=software_developer"');
    expect(markup).not.toContain('<th scope="col">Resume Score</th>');
    expect(markup).not.toContain('<th scope="col">Status</th>');
  });

  it('keeps incomplete candidates visible without a final score or rank', () => {
    const incomplete = rankingResponseSchema.parse({ ...ranking, items: [], total: 0, candidateRows: [{
      candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'A Candidate', rank: null, finalScore: null, evaluatedAt: null,
      githubUsername: null, githubScore: 80, leetcodeUsername: null, leetcodeScore: null,
      evaluationStatus: 'insufficient_evidence', missingEvidence: ['DSA & Problem-Solving'],
    }] });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(InsightsRankingTable, { ranking: incomplete, roleDisplayName: 'Software Developer' }),
    ));
    expect(markup).toContain('A Candidate');
    expect(markup).toContain('Not found');
    expect(markup).toContain('Incomplete');
    expect(markup).toContain('DSA &amp; Problem-Solving');
    expect(markup).not.toContain('Final Score</strong>');
  });
});

describe('ProviderRankingTable', () => {
  it('shows 75/25 provider scores, zero contribution for unavailable LeetCode, and unranked candidates', () => {
    const providerRanking = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 75, leetcode: 25 },
      items: [
        { candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 3, totalCategories: 5, status: 'partial' }, leetcodeScore: 60, combinedScore: 75, status: 'ranked', missingProviders: [] },
        { candidateId: 'dd235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'LeetCode Unavailable', evaluationId: 'ac649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 2, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, combinedScore: 60, status: 'ranked', missingProviders: ['leetcode'] },
        { candidateId: 'ee235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'LeetCode Zero', evaluationId: 'bc649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 3, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, leetcodeScore: 0, combinedScore: 60, status: 'ranked', missingProviders: [] },
        { candidateId: 'cc235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Incomplete Candidate', evaluationId: '9c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', githubCoverage: { availableCategories: 0, totalCategories: 5, status: 'unavailable' }, leetcodeScore: 0, status: 'incomplete', missingProviders: ['github'] },
      ],
      page: 1, pageSize: 20, rankedTotal: 3, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: providerRanking })));
    expect(markup).toContain('GitHub and LeetCode rankings. Resume scores are not included.');
    expect(markup).toContain('80');
    expect(markup).toContain('3/5 categories');
    expect(markup).toContain('75');
    expect(markup).toContain('0.00</strong> / 100<br/><small>Data unavailable — scored as 0</small>');
    expect(markup).toContain('Ranked · LeetCode unavailable');
    expect(markup).toContain('LeetCode Zero</a></td><td><strong>80.00</strong> / 100<br/><small>5/5 categories · complete</small></td><td><strong>0.00</strong> / 100</td><td><strong>60.00</strong> / 100</td><td>Ranked</td>');
    expect(markup).toContain('Incomplete Candidate</a></td><td>Unavailable</td><td><strong>0.00</strong> / 100</td><td>—</td><td>Unranked · missing github');
    expect(markup).toContain('GitHub 75%, LeetCode 25%. Missing LeetCode data contributes zero.');
    expect(markup).toContain('Resume scores are excluded');
  });

  it('provides accessible pagination when ranked and incomplete results span pages', () => {
    const paged = providerRankingResponseSchema.parse({
      mode: 'github_leetcode', roleId: 'software_developer', rubricId: 'github_leetcode_v4', scoringVersion: '4.0.1',
      providerWeights: { github: 75, leetcode: 25 },
      items: [{ candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', candidateName: 'Ranked Candidate', evaluationId: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', evaluatedAt: '2026-10-26T10:00:00.000Z', rank: 1, githubScore: 80, githubCoverage: { availableCategories: 5, totalCategories: 5, status: 'complete' }, leetcodeScore: 100, combinedScore: 85, status: 'ranked', missingProviders: [] }],
      page: 1, pageSize: 1, rankedTotal: 1, incompleteTotal: 1,
    });
    const markup = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProviderRankingTable, { ranking: paged, onPageChange: () => undefined })));
    expect(markup).toContain('aria-label="Provider ranking pages"');
    expect(markup).toContain('Page 1 of 2');
    expect(markup).toContain('>Next</button>');
  });
});
