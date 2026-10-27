import { describe, expect, it } from 'vitest';
import type { Candidate } from '@devrank/contracts';
import { filterAndSortCandidates } from './candidate-list-filtering';

const records: Candidate[] = [
  { id: '2', name: 'Ari Patel', email: 'ari@example.com', githubUsername: 'arip', createdAt: '2026-02-02T00:00:00.000Z', updatedAt: '2026-02-02T00:00:00.000Z' },
  { id: '1', name: 'Morgan Lee', leetcodeUsername: 'morganlee', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
  { id: '3', name: 'Sam Rivera', createdAt: '2026-02-03T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z' },
];

describe('candidate list local controls', () => {
  it('searches names, emails, and linked profile handles case-insensitively', () => {
    expect(filterAndSortCandidates(records, 'MORGANLEE', 'all', 'name').map(({ id }) => id)).toEqual(['1']);
    expect(filterAndSortCandidates(records, 'ari@example', 'all', 'name').map(({ id }) => id)).toEqual(['2']);
  });

  it('filters by actually linked profiles without inventing missing links', () => {
    expect(filterAndSortCandidates(records, '', 'github', 'name').map(({ id }) => id)).toEqual(['2']);
    expect(filterAndSortCandidates(records, '', 'unlinked', 'name').map(({ id }) => id)).toEqual(['3']);
  });

  it('sorts only the supplied page of records by name or date', () => {
    expect(filterAndSortCandidates(records, '', 'all', 'name').map(({ id }) => id)).toEqual(['2', '1', '3']);
    expect(filterAndSortCandidates(records, '', 'all', 'oldest').map(({ id }) => id)).toEqual(['1', '2', '3']);
    expect(filterAndSortCandidates(records, '', 'all', 'newest').map(({ id }) => id)).toEqual(['3', '2', '1']);
  });
});
