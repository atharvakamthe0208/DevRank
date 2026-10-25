import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: auth.useAuth }));

import { AdminRecruitersPage } from './AdminRecruitersPage';

describe('admin recruiter dashboard loading metrics', () => {
  beforeEach(() => auth.useAuth.mockReturnValue({
    session: { access_token: 'test-token' },
    profile: { display_name: 'Administrator' },
    signOut: vi.fn(),
  }));

  it('shows metric placeholders while real recruiter counts have not loaded', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AdminRecruitersPage)));
    expect(html).toContain('aria-label="Loading recruiter application counts"');
    expect(html.match(/class="admin-summary-value-skeleton"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-label="0"');
  });
});