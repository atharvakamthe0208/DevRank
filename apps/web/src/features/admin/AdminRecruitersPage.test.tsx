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

  it('shows all four recruiter status tabs with All Status selected by default above search and refresh', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AdminRecruitersPage)));
    expect(html).toContain('role="tablist" aria-label="Recruiter application status"');
    expect(html).toContain('role="tab" aria-selected="true" tabindex="0" class="is-active">All Status</button>');
    expect(html).toContain('>Pending</button>');
    expect(html).toContain('>Approved</button>');
    expect(html).toContain('>Rejected</button>');
    expect(html).not.toContain('class="admin-filter"');
    expect(html.indexOf('All Status')).toBeLessThan(html.indexOf('Search recruiter name or email'));
    expect(html.indexOf('Search recruiter name or email')).toBeLessThan(html.indexOf('Refreshing…</button>'));
  });
});
