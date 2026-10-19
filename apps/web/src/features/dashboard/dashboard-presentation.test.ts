import { dashboardResponseSchema } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { dashboardActivityCounts, dashboardScoreLabel } from './dashboard-presentation';

describe('dashboard presentation', () => {
  it('aggregates only the dashboard API statuses for summary metrics', () => {
    const response = dashboardResponseSchema.parse({
      candidateCount: 8,
      evaluationCount: 7,
      statusCounts: { completed: 3, insufficient_evidence: 2, in_progress: 1, failed: 1 },
      recentEvaluations: [],
    });
    expect(dashboardActivityCounts(response)).toEqual({ completed: 3, inProgress: 2, insufficientEvidence: 2 });
  });

  it('keeps unavailable scores distinct from a score of zero', () => {
    expect(dashboardScoreLabel(undefined)).toBe('Score unavailable');
    expect(dashboardScoreLabel(0)).toBe('0 / 100');
  });
});
