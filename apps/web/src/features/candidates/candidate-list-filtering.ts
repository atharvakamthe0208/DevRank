import type { Candidate } from '@devrank/contracts';

export type CandidatePlatformFilter = 'all' | 'github' | 'leetcode' | 'unlinked';
export type CandidateSortOrder = 'newest' | 'oldest' | 'name';

export function filterAndSortCandidates(
  candidates: Candidate[],
  query: string,
  platform: CandidatePlatformFilter,
  sort: CandidateSortOrder,
): Candidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return candidates
    .filter((candidate) => {
      const matchesPlatform = platform === 'all'
        || (platform === 'github' && Boolean(candidate.githubUsername))
        || (platform === 'leetcode' && Boolean(candidate.leetcodeUsername))
        || (platform === 'unlinked' && !candidate.githubUsername && !candidate.leetcodeUsername);
      if (!matchesPlatform || !normalizedQuery) return matchesPlatform;
      return [candidate.name, candidate.email, candidate.githubUsername, candidate.leetcodeUsername]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
    })
    .sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name);
      const byDate = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return sort === 'newest' ? -byDate : byDate;
    });
}
