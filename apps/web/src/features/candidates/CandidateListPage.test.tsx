import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCandidatesMock } = vi.hoisted(() => ({ useCandidatesMock: vi.fn() }));
vi.mock('./useCandidates', () => ({ useCandidates: useCandidatesMock }));

import { CandidateListPage } from './CandidateListPage';
import { candidateDeletionMessage } from './candidate-delete-confirmation';

const candidate = {
  id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
  name: 'Taylor Example',
  email: 'taylor@example.com',
  githubUsername: 'taylor-dev',
  hackerrankUsername: 'legacy-user',
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-10T12:00:00.000Z',
};

describe('candidate removal UI', () => {
  beforeEach(() => useCandidatesMock.mockReturnValue({
    items: [candidate], total: 1, loading: false, error: '', reload: vi.fn(), deleteCandidate: vi.fn(),
  }));

  it('shows a clearly labelled permanent delete action beside candidate details', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CandidateListPage)));

    expect(html).toContain('aria-label="Delete Taylor Example"');
    expect(html).toContain('candidate-delete-button');
    expect(html).toContain('aria-label="View Taylor Example"');
    expect(html).toContain('GitHub');
    expect(html).toContain('LeetCode');
    expect(html).not.toContain('HackerRank');
  });

  it('describes the permanent deletion scope before the explicit dialog action', () => {
    const message = candidateDeletionMessage('Taylor Example');
    expect(message).toContain('Taylor Example');
    expect(message).toContain('saved GitHub and LeetCode evidence');
    expect(message).toContain('evaluation history, and comparison membership');
    expect(message).toContain('This cannot be undone');
  });

  it('makes the candidate list scroll region keyboard reachable', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CandidateListPage)));
    expect(html).toContain('aria-label="Candidate list"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('Scroll horizontally to see profile links and row actions.');
  });
});
