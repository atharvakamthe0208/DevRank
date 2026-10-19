import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { access_token: 'test-token' } }),
}));

import { AppShell } from '../../components/layout/AppShell';
import { ResumeScreeningPage } from './ResumeScreeningPage';
import { ScreeningSummaryCards } from './ScreeningSummaryCards';
import { screeningProgressLabel } from './screening-progress';

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
    expect(html).toContain('Start Screening');
    expect(html).toContain('No screening results yet');
    expect(html).not.toContain('Sort by');
    expect(html).not.toContain('Average available score');
    expect(html).not.toContain('Highest available score');
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

describe('screening progress label', () => {
  it('counts completed and failed resumes as evaluated while showing pending and processing separately', () => {
    expect(screeningProgressLabel([
      { status: 'completed' }, { status: 'failed' }, { status: 'queued' }, { status: 'processing' }, { status: 'uploaded' },
    ])).toBe('Evaluated 2 of 5 candidates · 2 pending · 1 processing');
  });
});
