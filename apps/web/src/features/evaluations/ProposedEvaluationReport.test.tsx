import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildProposedEvaluationReport, type PlatformEvaluationEvidence } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { ProposedEvaluationReport } from './ProposedEvaluationReport';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const githubContribution: PlatformEvaluationEvidence = {
  evidenceId: 'current-year', candidateId, source: 'github', evidenceType: 'current_year_contributions', availability: 'partial',
  observedAt: '2026-10-17T00:00:00.000Z', normalizedValue: { year: 2026, timezone: 'UTC', totalContributions: 44, observedThrough: '2026-10-16T23:59:59.999Z' },
  verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed', limitations: [],
  categoryMappings: [{ rubricId: 'github_leetcode_proposal_v1', categoryId: 'current_year_contributions', relation: 'supporting' }],
};

describe('proposed evaluation report UI', () => {
  it('shows actual partial values, proposed weights, and keeps absent categories unavailable', () => {
    const html = renderToStaticMarkup(createElement(ProposedEvaluationReport, { report: buildProposedEvaluationReport([githubContribution]) }));
    expect(html).toContain('Proposed GitHub + LeetCode evaluation report');
    expect(html).toContain('Draft evidence index');
    expect(html).toContain('Current-Year Contributions');
    expect(html).toContain('44');
    expect(html).toContain('10% weight');
    expect(html).toContain('Weighted total withheld');
    expect(html).toContain('Unavailable');
    expect(html).toContain('does not affect active v3 results or rankings');
  });
});
