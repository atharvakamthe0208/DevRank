import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: () => ({ profile: null, signOut: vi.fn() }) }));

import { AppShell } from './AppShell';

function createRouter(initialEntries: string[], initialIndex = initialEntries.length - 1) {
  return createMemoryRouter([{ element: createElement(AppShell), children: [
    { path: '/dashboard/candidates', element: createElement('p', null, 'Candidate list') },
    { path: '/candidates/new', element: createElement('p', null, 'New candidate') },
    { path: '/candidates/:id', element: createElement('p', null, 'Candidate details') },
    { path: '/dashboard', element: createElement('p', null, 'Overview') },
    { path: '/evaluations', element: createElement('p', null, 'Evaluation page') },
    { path: '/profile', element: createElement('p', null, 'Profile destination') },
  ] }], { initialEntries, initialIndex });
}

function renderRouter(router: ReturnType<typeof createRouter>) {
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
function renderAt(path: string) { return renderRouter(createRouter([path])); }

describe('AppShell route breadcrumbs', () => {
  it('keeps the shared topbar visible on the Evaluation launch page', () => {
    const evaluation = renderAt('/evaluations');
    expect(evaluation).toContain('class="app-shell evaluation-page-shell"');
    expect(evaluation).toContain('<header class="topbar">');
    expect(evaluation).toContain('Home</a>');
    expect(evaluation).toContain('aria-current="page">Evaluations</span>');
    expect(evaluation).toContain('Recruiter workspace');
    expect(evaluation).toContain('class="avatar avatar-user top-avatar profile-avatar-link"');

    const dashboard = renderAt('/dashboard');
    expect(dashboard).toContain('<header class="topbar">');
    expect(dashboard).toContain('Recruiter workspace');
  });

  it('renders the candidate list and creation hierarchy from direct URLs', () => {
    const list = renderAt('/dashboard/candidates');
    expect(list).toContain('aria-label="Breadcrumb"');
    expect(list).toContain('aria-current="page">Candidates</span>');

    const create = renderAt('/candidates/new');
    expect(create).toContain('href="/dashboard" data-discover="true">Home</a>');
    expect(create).toContain('href="/dashboard/candidates" data-discover="true">Candidates</a>');
    expect(create).toContain('aria-current="page">Add Candidate</span>');
  });

  it('shows a safe detail fallback and clickable candidate-list ancestor on deep links', () => {
    const html = renderAt('/candidates/9ac7');
    expect(html).toContain('href="/dashboard/candidates" data-discover="true">Candidates</a>');
    expect(html).toContain('aria-current="page">Candidate Details</span>');
  });

  it('links both account avatars to the profile and marks them active there', () => {
    const html = renderAt('/profile');
    const profileLinks = html.match(/<a(?=[^>]*href="\/profile")(?=[^>]*aria-current="page")[^>]*>/g) ?? [];
    expect(profileLinks).toHaveLength(2);
    expect(html).toContain('aria-label="View profile for Recruiter"');
    expect(html).toContain('Home</a>');
    expect(html).toContain('My Profile');
  });

  it('keeps logout as a separate button, outside the profile links', () => {
    const html = renderAt('/dashboard');
    expect(html).toContain('<button type="button" class="logout-button"');
    expect(html).toContain('Log out</button>');
    expect((html.match(/href="\/profile"/g) ?? [])).toHaveLength(2);
    expect(html).not.toContain('My Profile</a>');
  });
  it('updates the current breadcrumb on router Back and Forward navigation', async () => {
    const router = createRouter(['/dashboard', '/candidates/new']);
    expect(renderRouter(router)).toContain('aria-current="page">Add Candidate</span>');
    await router.navigate(-1);
    expect(renderRouter(router)).toContain('aria-current="page">Overview</span>');
    await router.navigate(1);
    expect(renderRouter(router)).toContain('aria-current="page">Add Candidate</span>');
  });
});
