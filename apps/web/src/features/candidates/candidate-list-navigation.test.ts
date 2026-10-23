import { describe, expect, it } from 'vitest';
import { readCandidateListUrlState, safeCandidateListReturn } from './candidate-list-navigation';

describe('candidate list navigation state', () => {
  it('restores valid page, profile filter, and sort from URL parameters', () => {
    expect(readCandidateListUrlState(new URLSearchParams('page=3&platform=github&sort=name')))
      .toEqual({ page: 3, platformFilter: 'github', sortOrder: 'name' });
  });

  it('falls back safely for invalid query parameters', () => {
    expect(readCandidateListUrlState(new URLSearchParams('page=-2&platform=unknown&sort=created')))
      .toEqual({ page: 1, platformFilter: 'all', sortOrder: 'newest' });
  });

  it('accepts an in-app list return path and rejects external or unrelated destinations', () => {
    expect(safeCandidateListReturn({ path: '/dashboard/candidates?page=2', search: 'python', scrollY: 560 }))
      .toEqual({ path: '/dashboard/candidates?page=2', search: 'python', scrollY: 560 });
    expect(safeCandidateListReturn({ path: '//example.test' })).toBeNull();
    expect(safeCandidateListReturn({ path: '/profile' })).toBeNull();
  });
});
