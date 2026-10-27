import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: auth.useAuth }));

import { ProtectedAdminRoutes } from './ProtectedAdminRoutes';
import { ProtectedRecruiterRoutes } from './ProtectedRecruiterRoutes';

function renderAdminRoute(state: string) {
  auth.useAuth.mockReturnValue({ state, error: '', refresh: vi.fn(), signOut: vi.fn() });
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/admin/recruiters'] },
    createElement(Routes, null,
      createElement(Route, { element: createElement(ProtectedAdminRoutes) },
        createElement(Route, { path: '/admin/recruiters', element: createElement('h1', null, 'Recruiter administration') }),
      ),
      createElement(Route, { path: '/dashboard', element: createElement('h1', null, 'Recruiter dashboard') }),
      createElement(Route, { path: '/access-pending', element: createElement('h1', null, 'Access pending') }),
    ),
  ));
}

describe('protected administrator route', () => {
  beforeEach(() => auth.useAuth.mockReset());

  it('renders the admin page for an authenticated admin classified from /auth/me', () => {
    expect(renderAdminRoute('admin')).toContain('Recruiter administration');
  });

  it('does not render the admin page for an approved recruiter', () => {
    expect(renderAdminRoute('approved')).not.toContain('Recruiter administration');
  });

  it.each(['pending', 'rejected', 'unconfirmed'])('keeps %s accounts out of protected admin routes', (state) => {
    expect(renderAdminRoute(state)).not.toContain('Recruiter administration');
  });
});

describe('public landing route inside the existing recruiter access guard', () => {
  beforeEach(() => auth.useAuth.mockReset());

  function renderRoot(state: string) {
    auth.useAuth.mockReturnValue({ state, error: '', refresh: vi.fn(), signOut: vi.fn() });
    return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] },
      createElement(Routes, null,
        createElement(Route, { element: createElement(ProtectedRecruiterRoutes) },
          createElement(Route, { path: '/', element: createElement('h1', null, 'Recruiter workspace') }),
        ),
        createElement(Route, { path: '/login', element: createElement('h1', null, 'Existing sign in') }),
      ),
    ));
  }

  it('shows the public landing page to signed-out visitors at /', () => {
    const html = renderRoot('signed-out');
    expect(html).toContain('Evaluate engineering talent with');
    expect(html).toContain('Request access');
    expect(html).not.toContain('Existing sign in');
  });

  it('continues to send approved recruiters to the protected workspace', () => {
    expect(renderRoot('approved')).toContain('Recruiter workspace');
  });

  it('continues to send admins to admin management', () => {
    expect(renderRoot('admin')).not.toContain('public-landing');
  });

  it.each(['pending', 'rejected', 'unconfirmed'])('preserves the %s access-pending redirect', (state) => {
    expect(renderRoot(state)).not.toContain('public-landing');
  });
});
