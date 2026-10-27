import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('./AuthProvider', () => ({ useAuth: auth.useAuth }));

import { AuthCallbackPage, LoginPage, SignupPage } from './AuthPages';

describe('authentication restoration loading', () => {
  beforeEach(() => auth.useAuth.mockReturnValue({ state: 'loading', error: '' }));

  it.each([
    ['sign-in', LoginPage],
    ['sign-up', SignupPage],
    ['confirmation callback', AuthCallbackPage],
  ] as const)('shows the branded full-screen loader during %s session restoration', (_name, Page) => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Page)));
    expect(html).toContain('auth-loading-screen');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<form');
  });
});
