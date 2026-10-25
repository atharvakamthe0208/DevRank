import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminRecruiterDetailsPanel } from './AdminRecruiterDetailsPanel';
import type { AdminRecruiterDetails } from '@devrank/contracts';

const details: AdminRecruiterDetails = {
  profile: {
    userId: '20000000-0000-4000-8000-000000000001', email: 'recruiter@example.com', displayName: 'Taylor Recruiter',
    phoneNumber: null, companyName: 'Example Hiring', jobTitle: 'Talent Partner', companyWebsite: null,
    locationCity: 'Pune', locationCountry: 'India', role: 'recruiter', approvalStatus: 'approved', emailConfirmed: true,
    registeredAt: '2026-10-19T10:00:00.000Z', profileUpdatedAt: '2026-10-20T10:00:00.000Z',
    lastApprovalDecision: { status: 'approved', decidedAt: '2026-10-20T10:00:00.000Z', decidedByUserId: '10000000-0000-4000-8000-000000000001' },
  },
  stats: {
    totalEvaluations: 5, completedEvaluations: 2, inProgressEvaluations: 1, distinctCandidatesEvaluated: 2,
    resumeScreeningsInitiated: 3, completedResumeScreenings: 2, averageCompletedEvaluationScore: 74.5, recentActivityCount30Days: 4,
  },
  recentActivity: [{ id: 'evaluation:1', type: 'evaluation_created', occurredAt: '2026-10-20T10:00:00.000Z', summary: 'Evaluation created' }],
};

const handlers = { onRetry: vi.fn(), onClose: vi.fn() };

describe('AdminRecruiterDetailsPanel', () => {
  it('renders account, professional details, accurate aggregates, and recent activity', () => {
    const html = renderToStaticMarkup(createElement(AdminRecruiterDetailsPanel, { name: 'Taylor Recruiter', state: 'ready', details, error: '', ...handlers }));
    expect(html).toContain('recruiter@example.com');
    expect(html).toContain('Example Hiring');
    expect(html).toContain('74.50 / 100');
    expect(html).toContain('Distinct candidates evaluated');
    expect(html).toContain('Candidates evaluated counts distinct candidates');
    expect(html).toContain('Evaluation created');
    expect(html).toContain('Not provided');
  });

  it('renders a loading state accessibly', () => {
    const html = renderToStaticMarkup(createElement(AdminRecruiterDetailsPanel, { name: 'Taylor Recruiter', state: 'loading', details: null, error: '', ...handlers }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('class="admin-detail-loading-content"');
    expect(html).toContain('class="admin-skeleton admin-detail-skeleton-value"');
  });

  it('exposes a retry action on failure', () => {
    const html = renderToStaticMarkup(createElement(AdminRecruiterDetailsPanel, { name: 'Taylor Recruiter', state: 'error', details: null, error: 'Could not load details.', ...handlers }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load details.');
    expect(html).toContain('Try again');
  });

  it('shows an empty state when no persisted activity exists', () => {
    const noActivity = { ...details, recentActivity: [] };
    const html = renderToStaticMarkup(createElement(AdminRecruiterDetailsPanel, { name: 'Taylor Recruiter', state: 'ready', details: noActivity, error: '', ...handlers }));
    expect(html).toContain('No persisted activity is available for this account.');
  });
});
