import type { DashboardResponse } from '@devrank/contracts';

export function dashboardActivityCounts(dashboard: DashboardResponse | null) {
  const counts = dashboard?.statusCounts;
  return {
    completed: counts?.completed,
    inProgress: counts ? (counts.pending ?? 0) + (counts.in_progress ?? 0) + (counts.failed ?? 0) : undefined,
    insufficientEvidence: counts?.insufficient_evidence,
  };
}

export function dashboardScoreLabel(score: number | undefined): string {
  return score === undefined ? 'Score unavailable' : `${score} / 100`;
}
