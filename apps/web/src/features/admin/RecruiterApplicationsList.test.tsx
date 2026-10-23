import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RecruiterApplicationsList } from './RecruiterApplicationsList';
import type { RecruiterApplication } from './recruiter-application-presentation';

const row: RecruiterApplication = {
  user_id: 'candidate-1', email: 'recruiter@example.com', display_name: 'Taylor Recruiter',
  registered_at: '2026-10-19T10:00:00.000Z', approval_status: 'pending',
};
const baseProps = { busy: false, error: '', rows: [row], filter: 'pending' as const, activeId: '', activeDecision: '' as const, onRetry: vi.fn(), onViewDetails: vi.fn(), onDecide: vi.fn() };

describe('admin recruiter application list states', () => {
  it('announces loading state', () => {
    const html = renderToStaticMarkup(createElement(RecruiterApplicationsList, { ...baseProps, busy: true }));
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading recruiter accounts');
  });

  it('shows an empty state for the selected filter', () => {
    const html = renderToStaticMarkup(createElement(RecruiterApplicationsList, { ...baseProps, rows: [] }));
    expect(html).toContain('No pending applications to show');
    const searchHtml = renderToStaticMarkup(createElement(RecruiterApplicationsList, { ...baseProps, rows: [], searchQuery: 'taylor' }));
    expect(searchHtml).toContain('No recruiters match your search.');
  });

  it('shows a retry action for failures', () => {
    const html = renderToStaticMarkup(createElement(RecruiterApplicationsList, { ...baseProps, error: 'Could not load applications.' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load applications.');
    expect(html).toContain('Try again');
  });

  it('renders successful status data with explicit decision labels and registered date', () => {
    const html = renderToStaticMarkup(createElement(RecruiterApplicationsList, baseProps));
    expect(html).toContain('Taylor Recruiter');
    expect(html).toContain('TR');
    expect(html).toContain('recruiter@example.com');
    expect(html).toContain('pending');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
    expect(html).toContain('View details');
    expect(html).toContain('dateTime="2026-10-19T10:00:00.000Z"');
  });
});
