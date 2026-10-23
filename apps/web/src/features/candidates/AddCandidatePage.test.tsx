import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
});
