import { describe, expect, it } from 'vitest';
import type { Candidate } from '@devrank/contracts';
import { searchDashboardCandidates } from './dashboard-candidate-search';

const candidates = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Alex Rivera', email: 'ALEX@example.com', githubUsername: 'alexdev', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sam Chen', email: 'sam@example.com', leetcodeUsername: 'sam_codes', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
] satisfies Candidate[];
const evaluated = new Set([candidates[0]!.id]);

describe('dashboard candidate search', () => {
  it('matches candidate name, email, linked profile handles, and available skills case-insensitively', () => {
    expect(searchDashboardCandidates(candidates, 'RIVERA', 'all', evaluated).map(({ id }) => id)).toEqual([candidates[0]!.id]);
    expect(searchDashboardCandidates(candidates, 'SAM@EXAMPLE', 'all', evaluated).map(({ id }) => id)).toEqual([candidates[1]!.id]);
    expect(searchDashboardCandidates(candidates, 'SAM_CODES', 'all', evaluated).map(({ id }) => id)).toEqual([candidates[1]!.id]);
    const withSkills = [{ ...candidates[0]!, skills: ['TypeScript'] }];
    expect(searchDashboardCandidates(withSkills, 'typescript', 'all', evaluated)).toHaveLength(1);
  });

  it('filters evaluated and not-evaluated candidates, including when combined with a search query', () => {
    expect(searchDashboardCandidates(candidates, '', 'evaluated', evaluated).map(({ id }) => id)).toEqual([candidates[0]!.id]);
    expect(searchDashboardCandidates(candidates, '', 'not_evaluated', evaluated).map(({ id }) => id)).toEqual([candidates[1]!.id]);
    expect(searchDashboardCandidates(candidates, 'SAM', 'evaluated', evaluated)).toEqual([]);
    expect(searchDashboardCandidates(candidates, 'SAM', 'not_evaluated', evaluated)).toEqual([candidates[1]]);
  });

  it('returns an empty result for an empty dataset or a query with no match', () => {
    expect(searchDashboardCandidates([], '', 'all', evaluated)).toEqual([]);
    expect(searchDashboardCandidates(candidates, 'no such candidate', 'all', evaluated)).toEqual([]);
  });
});
