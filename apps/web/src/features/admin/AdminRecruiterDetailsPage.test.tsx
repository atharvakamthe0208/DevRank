import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: auth.useAuth }));

import { AdminRecruiterDetailsPage } from './AdminRecruiterDetailsPage';

describe('AdminRecruiterDetailsPage route', () => {
  beforeEach(() => auth.useAuth.mockReturnValue({
    session: { access_token: 'test-token' },
    profile: { display_name: 'Administrator' },
  }));

  it('renders directly for a recruiter id with a back link and full-page loading structure', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/admin/recruiters/20000000-0000-4000-8000-000000000001'] },
      createElement(Routes, null, createElement(Route, { path: '/admin/recruiters/:recruiterId', element: createElement(AdminRecruiterDetailsPage) })),
    ));
    expect(html).toContain('Back to recruiter applications');
    expect(html).toContain('RECRUITER DETAILS');
    expect(html).toContain('aria-label="Recruiter account and activity details"');
    expect(html).toContain('Loading recruiter profile and activity');
  });
});
