import type { DashboardResponse } from '@devrank/contracts';

export function comparableRecentEvaluations(dashboard: DashboardResponse | null) {
  const seenCandidates = new Set<string>();
  return (dashboard?.recentEvaluations ?? []).filter((item) => {
    if ((item.status !== 'completed' && item.status !== 'insufficient_evidence') || item.scoringVersion === null || seenCandidates.has(item.candidateId)) return false;
    seenCandidates.add(item.candidateId);
    return true;
  });
}
