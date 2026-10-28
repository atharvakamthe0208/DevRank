import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { rankingResponseSchema } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { InsightsRankingTable } from './InsightsPage';

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
