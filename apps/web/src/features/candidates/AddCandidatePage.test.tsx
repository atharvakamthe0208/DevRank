import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('../../lib/supabase/client', () => ({ supabase: null }));

import { AddCandidatePage } from './AddCandidatePage';

describe('add candidate form', () => {
  it('keeps GitHub and LeetCode fields and omits the unused HackerRank field', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AddCandidatePage)));

    expect(html).toContain('GitHub username');
    expect(html).toContain('LeetCode username');
    expect(html).not.toContain('HackerRank');
    expect(html).not.toContain('hackerrankUsername');
  });
});
