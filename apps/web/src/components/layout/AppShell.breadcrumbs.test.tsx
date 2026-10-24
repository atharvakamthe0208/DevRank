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
  ] }], { initialEntries, initialIndex });
}

function renderRouter(router: ReturnType<typeof createRouter>) {
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}
function renderAt(path: string) { return renderRouter(createRouter([path])); }

describe('AppShell route breadcrumbs', () => {
  it('renders the candidate list and creation hierarchy from direct URLs', () => {
    const list = renderAt('/dashboard/candidates');
    expect(list).toContain('aria-label="Breadcrumb"');
    expect(list).toContain('aria-current="page">Candidates</span>');

    const create = renderAt('/candidates/new');
    expect(create).toContain('href="/dashboard" data-discover="true">Home</a>');
    expect(create).toContain('class="workspace-label">HOME</div>');
    expect(create).toContain('Recruiter home');
    expect(create).toContain('href="/dashboard/candidates" data-discover="true">Candidates</a>');
    expect(create).toContain('aria-current="page">Add Candidate</span>');
  });

  it('shows a safe detail fallback and clickable candidate-list ancestor on deep links', () => {
    const html = renderAt('/candidates/9ac7');
    expect(html).toContain('href="/dashboard/candidates" data-discover="true">Candidates</a>');
    expect(html).toContain('aria-current="page">Candidate Details</span>');
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
