import { describe, expect, it } from 'vitest';
import { dashboardEvaluationStatusLabel, dashboardRoleLabel, dashboardScoreAvailabilityLabel } from './dashboard-presentation';

describe('dashboard presentation', () => {
  it('shows canonical role labels for roles retrieved from saved evaluation details', () => {
    expect(dashboardRoleLabel('software_developer')).toBe('Software Developer');
    expect(dashboardRoleLabel('ai_ml_engineer')).toBe('AI/ML Engineer');
    expect(dashboardRoleLabel('data_analyst')).toBe('Data Analyst');
  });

  it('keeps every evaluation state distinct and does not invent a score', () => {
    expect(dashboardEvaluationStatusLabel('insufficient_evidence')).toBe('Insufficient evidence');
    expect(dashboardScoreAvailabilityLabel('insufficient_evidence')).toContain('No score');
    expect(dashboardEvaluationStatusLabel('failed')).toBe('Failed');
    expect(dashboardScoreAvailabilityLabel('failed')).toContain('evaluation failed');
    expect(dashboardEvaluationStatusLabel('in_progress')).toBe('In progress');
    expect(dashboardScoreAvailabilityLabel('in_progress')).toBe('Not scored yet');
    expect(dashboardEvaluationStatusLabel('completed')).toBe('Completed');
    expect(dashboardScoreAvailabilityLabel('completed')).toBe('Score unavailable');
  });
});
