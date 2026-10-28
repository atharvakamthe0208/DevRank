import type { DashboardResponse } from '@devrank/contracts';

export function dashboardEvaluationReportPath(evaluationId: string): string {
  return `/evaluations/${evaluationId}`;
}

export function dashboardRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    software_developer: 'Software Developer',
    ai_ml_engineer: 'AI/ML Engineer',
    data_analyst: 'Data Analyst',
  };
  return labels[role] ?? role.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function dashboardEvaluationStatusLabel(status: DashboardResponse['recentEvaluations'][number]['status']): string {
  const labels: Record<DashboardResponse['recentEvaluations'][number]['status'], string> = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Completed',
    insufficient_evidence: 'Insufficient evidence',
    failed: 'Failed',
  };
  return labels[status];
}

export function dashboardScoreAvailabilityLabel(status: DashboardResponse['recentEvaluations'][number]['status']): string {
  if (status === 'insufficient_evidence') return 'No score · insufficient evidence';
  if (status === 'failed') return 'No score · evaluation failed';
  if (status === 'pending' || status === 'in_progress') return 'Not scored yet';
  return 'Score unavailable';
}

export function recentScoredEvaluationAverage(evaluations: readonly { score?: number }[]): { average?: number; count: number } {
  const scores = evaluations.flatMap(({ score }) => score === undefined ? [] : [score]);
  return scores.length
    ? { average: scores.reduce((total, score) => total + score, 0) / scores.length, count: scores.length }
    : { average: undefined, count: 0 };
}
