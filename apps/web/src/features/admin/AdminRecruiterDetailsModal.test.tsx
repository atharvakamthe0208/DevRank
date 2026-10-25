import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AdminRecruiterDetailsModal } from './AdminRecruiterDetailsModal';
import type { AdminRecruiterDetails } from '@devrank/contracts';

const details: AdminRecruiterDetails = {
  profile: {
    userId: '20000000-0000-4000-8000-000000000001', email: 'taylor@example.com', displayName: 'Taylor Recruiter',
    phoneNumber: '555-0100', companyName: 'Example Hiring', jobTitle: 'Talent Partner', companyWebsite: null,
    locationCity: 'Pune', locationCountry: 'India', role: 'recruiter', approvalStatus: 'approved', emailConfirmed: true,
    registeredAt: '2026-10-19T10:00:00.000Z', profileUpdatedAt: '2026-10-20T10:00:00.000Z', lastApprovalDecision: null,
  },
  stats: { totalEvaluations: 0, completedEvaluations: 0, inProgressEvaluations: 0, distinctCandidatesEvaluated: 0, resumeScreeningsInitiated: 0, completedResumeScreenings: 0, averageCompletedEvaluationScore: null, recentActivityCount30Days: 0 },
  recentActivity: [],
};
const noop = vi.fn();
function render(state: 'loading' | 'error' | 'ready' = 'ready') {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AdminRecruiterDetailsModal, {
    recruiterId: details.profile.userId, name: 'Taylor Recruiter', state, details: state === 'ready' ? details : null,
    error: state === 'error' ? 'Could not load details.' : '', onRetry: noop, onClose: noop,
  })));
}

describe('AdminRecruiterDetailsModal', () => {
  it('shows account fields only and links to the selected recruiter full-details route', () => {
    const html = render();
    expect(html).toContain('<dialog');
    expect(html).toContain('aria-labelledby="admin-modal-title"');
    expect(html).toContain('taylor@example.com');
    expect(html).toContain('Email confirmation');
    expect(html).toContain('Last approval decision');
    expect(html).toContain('View more details');
    expect(html).toContain('/admin/recruiters/20000000-0000-4000-8000-000000000001');
    expect(html).not.toContain('Professional details');
    expect(html).not.toContain('Activity statistics');
    expect(html).not.toContain('Recent activity');
  });

  it('exposes loading and retryable error states', () => {
    expect(render('loading')).toContain('Loading recruiter account details');
    expect(render('error')).toContain('Try again');
    expect(render('error')).toContain('Could not load details.');
  });
});