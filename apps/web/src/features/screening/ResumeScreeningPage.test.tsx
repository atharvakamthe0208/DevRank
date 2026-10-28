import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { access_token: 'test-token' } }),
}));

import { AppShell } from '../../components/layout/AppShell';
import { canClearVisibleScreeningResults, clearPendingResumes, ExistingCandidateResumeLinks, refreshLinkedCandidateAssessments, removePendingResume, ResumeScreeningPage } from './ResumeScreeningPage';
import { ScreeningSummaryCards } from './ScreeningSummaryCards';
import { screeningProgress, screeningProgressLabel } from './screening-progress';
import { buildScreeningRequest } from './screening-request';

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
    expect(html).toContain('Remove All');
    expect(html).toContain('Remove All from view');
    expect(html).toMatch(/class="screening-remove-all-button" type="button" disabled="" aria-label="Remove all selected resumes"/);
    expect(html).toMatch(/aria-label="Remove all screening results from this view"[^>]*disabled=""|disabled=""[^>]*aria-label="Remove all screening results from this view"/);
    expect(html).toContain('Saved screening records, evaluations, candidates, and files are retained.');
    expect(html.indexOf('Remove All from view')).toBeGreaterThan(html.indexOf('No screening results yet'));
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Sort by');
    expect(html).not.toContain('Average available score');
    expect(html).not.toContain('Highest available score');
  });

  it('does not render a candidate selector beside the selected resume rows', () => {
    const source = readFileSync(new URL('./ResumeScreeningPage.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('screening-candidate-assignment');
    expect(source).not.toContain('Leave unlinked');
    expect(source).toContain('candidateId?: string');
  });

  it('keeps screening session identifiers internal and simplifies the results and print report', () => {
    const source = readFileSync(new URL('./ResumeScreeningPage.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('Session {submitted.sessionId}');
    expect(source).toContain('Screening {details?.status ?? submitted.status}');
    expect(source).not.toContain('<th scope="col">Status</th>');
    expect(source).not.toContain('<small>{presentation.label}</small>');
    expect(source).not.toContain('<th>Selected for comparison</th>');
    expect(source).not.toContain('<th>Status</th>');
    expect(source).not.toContain('Ranking criteria and limitations');
    expect(source).not.toContain('Preliminary document match:');
    expect(source).not.toContain('Preliminary match only');
    expect(source).not.toContain('Insufficient evidence for a validated score.');
    expect(source).not.toContain('Unverified in resume text');
  });

  it('allows clearing only a settled visible session and never deletes saved screening data', () => {
    const settled = { status: 'completed', resumes: [{ status: 'completed' }, { status: 'failed' }] };
    const processing = { status: 'processing', resumes: [{ status: 'processing' }] };
    expect(canClearVisibleScreeningResults(settled, settled, false)).toBe(true);
    expect(canClearVisibleScreeningResults(null, null, false)).toBe(false);
    expect(canClearVisibleScreeningResults(processing, processing, false)).toBe(false);
    expect(canClearVisibleScreeningResults({ status: 'completed', resumes: [{ status: 'queued' }] }, null, false)).toBe(false);
    expect(canClearVisibleScreeningResults(settled, settled, true)).toBe(false);
    expect(settled.resumes).toEqual([{ status: 'completed' }, { status: 'failed' }]);
    const source = readFileSync(new URL('./ResumeScreeningPage.tsx', import.meta.url), 'utf8');
    const clearHandler = source.slice(source.indexOf('function clearVisibleResults()'), source.indexOf('async function startScreening'));
    expect(clearHandler).toContain('screeningNavigationCache.delete');
    expect(clearHandler).toContain('setSubmitted(null)');
    expect(clearHandler).toContain('setDetails(null)');
    expect(clearHandler).not.toContain('apiRequest(');
  });

  it('individual Remove only removes the selected pending resume', () => {
    const selected = [
      { id: 'resume-1', file: { name: 'one.pdf' } as File, candidateId: 'candidate-1' },
      { id: 'resume-2', file: { name: 'two.docx' } as File },
    ];
    expect(removePendingResume(selected, 'resume-1')).toEqual([selected[1]]);
    expect(selected).toHaveLength(2);
  });

  it('Remove All clears only the pending selection without changing saved session data', () => {
    const savedSession = { sessionId: 'saved-session', status: 'completed' };
    const selected = [{ id: 'resume-1', file: { name: 'one.pdf' } as File, candidateId: 'candidate-1' }];
    expect(clearPendingResumes()).toEqual([]);
    expect(selected).toHaveLength(1);
    expect(savedSession).toEqual({ sessionId: 'saved-session', status: 'completed' });
  });

  it('preserves the existing screening request for multiple unlinked uploads', () => {
    const body = buildScreeningRequest('Engineer', 'A job description with enough content to meet the existing minimum.', [
      { file: new File(['resume one'], 'one.pdf', { type: 'application/pdf' }) },
      { file: new File(['resume two'], 'two.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }) },
    ]);
    expect(body.get('jobTitle')).toBe('Engineer');
    expect(body.getAll('resumes')).toHaveLength(2);
    expect(body.has('candidateIds')).toBe(false);
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
