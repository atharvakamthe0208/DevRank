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
    expect(html).not.toContain('My Profile');
    expect(html).toContain('Overview');
    expect(html).toContain('Candidates');
    expect(html).toContain('Resume Screening');
    expect(html).toContain('Evaluations');
    expect(html).toContain('Insights');
    expect(html).toContain('is-dashboard');
    expect(html).toContain('aria-busy="true"');
    const navLabels = ['Overview', 'Candidates', 'Evaluations', 'Insights', 'Resume Screening'];
    const navPositions = navLabels.map((label) => html.indexOf('<span class="nav-label">' + label + '</span>'));
    expect(navPositions.every((position) => position >= 0)).toBe(true);
    expect(navPositions).toEqual([...navPositions].sort((left, right) => left - right));
    expect((html.match(/class="nav-icon"><svg/g) ?? [])).toHaveLength(5);
    expect(html).toContain('stroke="currentColor"');
  });
});
