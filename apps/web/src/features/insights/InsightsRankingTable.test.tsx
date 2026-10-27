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
