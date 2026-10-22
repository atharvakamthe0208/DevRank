import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { unifiedCandidateReportSchema } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { UnifiedCandidateReportView } from './UnifiedCandidateReportPage';

describe('unified candidate report view', () => {
  it('renders saved source findings, preliminary-vs-validated labels, and the PDF export action', () => {
    const report = unifiedCandidateReportSchema.parse({
      generatedAt: '2026-10-14T12:00:00.000Z',
      candidate: { id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Taylor Example', email: 'taylor@example.com', createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z' },
      job: { roleId: 'software_developer', roleLabel: 'software developer', description: null },
      platformEvaluation: { status: 'insufficient_evidence', evaluatedAt: '2026-10-14T12:00:00.000Z', overallIndex: null, rubricNotice: 'Missing source data remains unscored.', strengths: ['Saved strength'], improvementAreas: ['Saved improvement'], },
      sources: {
        github: { status: 'available', provenance: 'github_api', capturedAt: '2026-10-14T11:00:00.000Z', values: { publicRepositoryCount: 3 }, findings: [], limitations: ['Identity is not verified.'] },
        leetcode: { status: 'available', provenance: 'alfa_leetcode_api', capturedAt: '2026-10-14T11:30:00.000Z', values: { statistics: { problemsSolved: 8 } }, findings: [], limitations: ['Unofficial data source.'] },
      },
      resume: { status: 'available', message: 'resume.pdf · Taylor Example', jobTitle: 'Backend Engineer', jobDescription: 'Build APIs', evaluatedAt: '2026-10-14T10:00:00.000Z', validatedScore: null, preliminaryScore: 67, statusLabel: 'insufficient_evidence', evidence: ['Built an API service'], limitations: ['Preliminary result is not validated.'] },
      linkableResumes: [],
    });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UnifiedCandidateReportView, { report })));
    expect(html).toContain('Taylor Example');
    expect(html).toContain('GitHub');
    expect(html).toContain('LeetCode');
    expect(html).toContain('Preliminary match:');
    expect(html).toContain('67/100');
    expect(html).not.toContain('Overall index 67');
    expect(html).toContain('Download / Print PDF');
    expect(html).toContain('Identity is not verified.');
  });
});
