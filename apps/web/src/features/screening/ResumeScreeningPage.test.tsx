import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { access_token: 'test-token' } }),
}));

import { AppShell } from '../../components/layout/AppShell';
import { ExistingCandidateResumeLinks, refreshLinkedCandidateAssessments, ResumeScreeningPage } from './ResumeScreeningPage';
import { ScreeningSummaryCards } from './ScreeningSummaryCards';
import { screeningProgress, screeningProgressLabel } from './screening-progress';

describe('Resume Screening route content', () => {
  it('shows the sidebar link and screening form inside the existing application shell', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/screening'] },
      createElement(Routes, null,
        createElement(Route, { element: createElement(AppShell) },
          createElement(Route, { path: '/screening', element: createElement(ResumeScreeningPage) })))));

    expect(html).toContain('href="/screening"');
    expect(html).toContain('Resume Screening');
    expect(html).toContain('Job title');
    expect(html).toContain('Job description');
    expect(html).toContain('Resume files');
    expect(html).toContain('Screening status and results');
    expect(html).toContain('PDF or DOCX · up to 20 files · 10 MB maximum per file');
    expect(html).toContain('Start Screening');
    expect(html).not.toContain('RECRUITER HOME');
    expect(html).not.toContain('Specific criteria help');
    expect(html).not.toContain('For best results');
    expect(html).toContain('No screening results yet');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Sort by');
    expect(html).not.toContain('Average available score');
    expect(html).not.toContain('Highest available score');
  });

  it('uses the shared workspace rule to hide page-title eyebrows without hiding section labels', () => {
    const workspaceStyles = readFileSync(new URL('../../workspace-refinement.css', import.meta.url), 'utf8');

    expect(workspaceStyles).toContain('.app-shell .page-content .resume-screening-heading > div > .eyebrow');
    expect(workspaceStyles).toContain('.app-shell .page-content .insights-heading > div > .eyebrow');
    expect(workspaceStyles).toContain('display: none;');
    expect(workspaceStyles).not.toContain('.screening-panel-heading .eyebrow');
  });
});

describe('screening summary cards', () => {
  it('renders exactly Total Resumes and Successfully Scored', () => {
    const html = renderToStaticMarkup(createElement(ScreeningSummaryCards, { totalResumes: 5, successfullyScored: 3 }));
    expect((html.match(/<article>/g) ?? [])).toHaveLength(2);
    expect(html).toContain('Total Resumes');
    expect(html).toContain('Successfully Scored');
    expect(html).not.toContain('Average Available Score');
    expect(html).not.toContain('Highest Available Score');
  });
});

describe('existing screening result reuse links', () => {
  it('links only to the recruiter-selected candidate report and labels the reuse and replacement choices', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ExistingCandidateResumeLinks, {
      candidateIds: ['e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2'],
      candidates: [{ id: 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2', name: 'Akshay Nazare' }],
    })));
    expect(html).toContain('Akshay Nazare');
    expect(html).toContain('reuse saved resume result or explicitly replace it');
    expect(html).toContain('href="/candidates/e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2/report"');
  });
});

describe('screening progress label', () => {
  it('counts completed and failed resumes as evaluated while showing pending and processing separately', () => {
    expect(screeningProgressLabel([
      { status: 'completed' }, { status: 'failed' }, { status: 'queued' }, { status: 'processing' }, { status: 'uploaded' },
    ])).toBe('Evaluated 2 of 5 candidates · 2 pending · 1 processing');
  });

  it('reports an exact resolved-resume progress value without inventing an estimate', () => {
    expect(screeningProgress([
      { status: 'completed' }, { status: 'failed' }, { status: 'queued' }, { status: 'processing' }, { status: 'uploaded' },
    ])).toEqual({ total: 5, resolved: 2, percent: 40 });
    expect(screeningProgress([])).toEqual({ total: 0, resolved: 0, percent: 0 });
  });
});

describe('saved Insights assessment refresh after screening', () => {
  it('refreshes only explicitly linked terminal results using the compatible role and saved resume IDs', async () => {
    const request = vi.fn(async () => ({}));
    const result = await refreshLinkedCandidateAssessments({
      sessionId: '11111111-1111-4111-8111-111111111111', jobTitle: 'Senior Software Engineer', status: 'partial',
      resumes: [
        { id: '22222222-2222-4222-8222-222222222222', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', filename: 'candidate.pdf', status: 'completed', candidate: { name: 'Candidate A' }, evaluation: null },
        { id: '33333333-3333-4333-8333-333333333333', candidateId: null, filename: 'unlinked.pdf', status: 'completed', candidate: null, evaluation: null },
        { id: '44444444-4444-4444-8444-444444444444', candidateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', filename: 'processing.pdf', status: 'processing', candidate: null, evaluation: null },
      ],
    }, 'test-token', request as never);

    expect(result).toEqual({ refreshed: 1, failedCandidateIds: [] });
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/candidates/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/unified-report/assessment', {
      method: 'POST', body: JSON.stringify({ roleId: 'software_developer', resumeId: '22222222-2222-4222-8222-222222222222' }),
    }, 'test-token');
  });

  it('does not guess a role or link by resume name when the job title is incompatible', async () => {
    const request = vi.fn(async () => ({}));
    const result = await refreshLinkedCandidateAssessments({
      sessionId: '11111111-1111-4111-8111-111111111111', jobTitle: 'Unmapped Specialist', status: 'completed',
      resumes: [{ id: '22222222-2222-4222-8222-222222222222', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', filename: 'same-name.pdf', status: 'completed', candidate: { name: 'Candidate A' }, evaluation: null }],
    }, 'test-token', request as never);
    expect(result.refreshed).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });
});
