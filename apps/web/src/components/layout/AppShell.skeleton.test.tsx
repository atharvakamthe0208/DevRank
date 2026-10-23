import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('../../features/auth/AuthProvider', () => ({ useAuth: auth.useAuth }));

import { AppShell } from './AppShell';
import { WorkspaceSkeleton } from '../WorkspaceSkeleton';

describe('workspace navigation loading', () => {
  beforeEach(() => auth.useAuth.mockReturnValue({ profile: null, signOut: vi.fn() }));

  it('keeps the workspace shell and navigation rendered around the destination skeleton', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/dashboard'] },
      createElement(Routes, null, createElement(Route, { element: createElement(AppShell) },
        createElement(Route, { path: '/dashboard', element: createElement(WorkspaceSkeleton, { variant: 'dashboard' }) }),
      )),
    ));
    expect(html).toContain('Main navigation');
    expect(html).toContain('My Profile');
    expect(html).toContain('is-dashboard');
    expect(html).toContain('aria-busy="true"');
  });
});
