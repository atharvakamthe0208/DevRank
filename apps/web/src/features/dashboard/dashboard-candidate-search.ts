import type { Candidate } from '@devrank/contracts';

export type CandidateEvaluationFilter = 'all' | 'evaluated' | 'not_evaluated';
type SearchableCandidate = Candidate & { skills?: readonly string[] };

export function searchDashboardCandidates(
  candidates: readonly Candidate[],
  query: string,
  evaluationFilter: CandidateEvaluationFilter,
  evaluatedCandidateIds: ReadonlySet<string>,
): Candidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return candidates.filter((candidate) => {
    const isEvaluated = evaluatedCandidateIds.has(candidate.id);
    if (evaluationFilter === 'evaluated' && !isEvaluated) return false;
    if (evaluationFilter === 'not_evaluated' && isEvaluated) return false;
    if (!normalizedQuery) return true;
    const searchable = candidate as SearchableCandidate;
    return [candidate.name, candidate.email, candidate.githubUsername, candidate.leetcodeUsername,
      candidate.hackerrankUsername, ...(searchable.skills ?? [])]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  });
}
