import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ session: null as unknown }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../lib/supabase/client', () => ({ supabase: null }));

import { AddCandidatePage } from './AddCandidatePage';
import { sessionDraftKey, writeSessionDraft, type DraftStorage } from '../../lib/forms/session-draft';

describe('add candidate form', () => {
  afterEach(() => { auth.session = null; vi.unstubAllGlobals(); });

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

  it('restores a user-scoped candidate draft and exposes an explicit discard action', () => {
    const values = new Map<string, string>();
    const storage: DraftStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
    auth.session = { user: { id: 'user-1' } };
    writeSessionDraft(sessionDraftKey('user-1', 'candidate:new'), { name: 'Jordan Lee', email: '', githubUsername: 'jlee', leetcodeUsername: '' }, storage);
    vi.stubGlobal('window', { sessionStorage: storage });

    const router = createMemoryRouter([{ path: '/candidates/new', element: createElement(AddCandidatePage) }], { initialEntries: ['/candidates/new'] });
    const html = renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(html).toContain('value="Jordan Lee"');
    expect(html).toContain('value="jlee"');
    expect(html).toContain('Draft restored from this browser tab');
    expect(html).toContain('Discard draft');
  });
});
