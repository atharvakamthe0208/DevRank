import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { buildProposedEvaluationReport, type DashboardResponse } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { ProposedDashboardReports } from './ProposedDashboardReports';

const report = buildProposedEvaluationReport([]);
const evaluation: DashboardResponse['recentEvaluations'][number] = {
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateName: 'Candidate Ada',
  status: 'insufficient_evidence', createdAt: '2026-10-17T00:00:00.000Z', scoringVersion: '4.0.0', finalReport: report,
};

describe('proposed report dashboard section', () => {
  it('renders recent evaluation proposal values while preserving the active scoring version label', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProposedDashboardReports, { evaluations: [evaluation] })));
    expect(html).toContain('Candidate Ada');
    expect(html).toContain('Detailed Evaluation Report');
    expect(html).not.toContain('Active v4 GitHub + LeetCode evaluation');
    expect(html).toContain('active scoring version 4.0.0');
    expect(html).toContain('Overall score withheld');
    expect(html).toContain('Project Portfolio');
    expect(html).toContain('Unavailable');
  });

  it('reports when the evaluation snapshot cannot be read without inventing values', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProposedDashboardReports, { evaluations: [{ ...evaluation, finalReport: undefined, finalReportUnavailable: true }] })));
    expect(html).toContain('cannot read the evaluation result snapshot');
    expect(html).not.toContain('Draft weighted index');
  });
});
