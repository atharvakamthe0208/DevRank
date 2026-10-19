import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCandidatesMock } = vi.hoisted(() => ({ useCandidatesMock: vi.fn() }));
vi.mock('./useCandidates', () => ({ useCandidates: useCandidatesMock }));

import { CandidateListPage } from './CandidateListPage';
import { confirmCandidateDeletion } from './candidate-delete-confirmation';

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

  it('requires explicit confirmation and describes the records that will be removed', () => {
    const confirm = vi.fn(() => false);

    expect(confirmCandidateDeletion('Taylor Example', confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('saved platform evidence, evaluations, and comparison membership'));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('This cannot be undone'));
  });
});
