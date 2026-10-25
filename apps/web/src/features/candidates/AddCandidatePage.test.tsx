import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('../../lib/supabase/client', () => ({ supabase: null }));

import { AddCandidatePage } from './AddCandidatePage';

describe('add candidate form', () => {
  it('keeps GitHub and LeetCode fields and omits the unused HackerRank field', () => {
    const router = createMemoryRouter([{ path: '/candidates/new', element: createElement(AddCandidatePage) }], { initialEntries: ['/candidates/new'] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));

    expect(html).toContain('GitHub username');
    expect(html).toContain('LeetCode username');
    expect(html).not.toContain('HackerRank');
    expect(html).not.toContain('hackerrankUsername');
  });

  it('uses the shared primary button with the recruiter workspace blue theme', () => {
    const router = createMemoryRouter([{ path: '/candidates/new', element: createElement(AddCandidatePage) }], { initialEntries: ['/candidates/new'] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
    const styles = readFileSync(new URL('../../workspace-refinement.css', import.meta.url), 'utf8');

    expect(html).toMatch(/<button class="primary-button" type="submit"/);
    expect(styles).toContain('.app-shell .candidate-form-actions .primary-button');
    expect(styles).toContain('background: var(--workspace-blue)');
    expect(styles).toContain('background: var(--workspace-blue-hover)');
  });
});
