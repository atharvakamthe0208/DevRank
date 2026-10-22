import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ScreeningDetailsResponse } from '@devrank/contracts';
import { ScreeningResultList } from './ScreeningResultList';

type Resume = ScreeningDetailsResponse['resumes'][number];

function resume(overrides: Partial<Resume> = {}): Resume {
  return {
    id: '00000000-0000-4000-8000-000000000001', filename: 'candidate-resume.pdf', status: 'completed',
    candidate: { name: 'Asha Patel' }, evaluation: null, ...overrides,
  };
}

describe('compact screening results', () => {
  it('shows candidate, resume, status and a saved score without the criteria in the summary', () => {
    const html = renderToStaticMarkup(createElement(ScreeningResultList, { resumes: [resume({
      evaluation: {
        rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: 85,
        evidenceCoverage: 100, categories: [{ categoryId: 'required_technical_skills', weight: 35, score: 85, weightedContribution: 29.75, evaluableWeight: 35, status: 'scored', requirementIds: ['typescript'] }],
        requirements: [{ id: 'typescript', categoryId: 'required_technical_skills', description: 'TypeScript', importance: 'required', status: 'demonstrated', evidence: [{ excerpt: 'Built applications with TypeScript.' }], explanation: 'Explicit resume evidence.', confidence: 0.9 }],
      },
    })] }));

    expect(html).toContain('candidate-resume.pdf');
    expect(html).toContain('Asha Patel');
    expect(html).toContain('Completed');
    expect(html).toContain('85/100');
    expect(html).toContain('<details class="screening-result-details">');
    expect(html).toContain('View details');
    const summary = html.split('<details')[0];
    expect(summary).not.toContain('TypeScript');
    expect(summary).not.toContain('Explicit resume evidence');
  });

  it('labels provisional scores and keeps unavailable scores distinct from status', () => {
    const html = renderToStaticMarkup(createElement(ScreeningResultList, { resumes: [
      resume({ id: '00000000-0000-4000-8000-000000000002', status: 'completed', preliminaryEvaluation: {
        rubricVersion: 'resume-document-match-1.0.0', score: 62, evidenceCoverage: 40,
        criteria: [{ id: 'typescript', categoryId: 'required_technical_skills', description: 'TypeScript', importance: 'required', status: 'supported', matchedTerms: ['TypeScript'] }],
      } }),
      resume({ id: '00000000-0000-4000-8000-000000000003', status: 'failed', error: 'PDF text extraction failed.' }),
      resume({ id: '00000000-0000-4000-8000-000000000004', status: 'processing' }),
    ] }));

    expect(html).toContain('62/100');
    expect(html).toContain('Provisional');
    expect(html).toContain('Score unavailable');
    expect(html).toContain('Failed');
    expect(html).toContain('Processing');
    expect(html).toContain('Evaluation in progress.');
    expect(html).toContain('Processing failed. View details for the error.');
    expect(html).toContain('PDF text extraction failed.');
  });
});
