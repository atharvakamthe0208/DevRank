import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DashboardWelcome } from './DashboardPage';
import { dashboardEvaluationStatusLabel, dashboardRoleLabel, dashboardScoreAvailabilityLabel, recentScoredEvaluationAverage } from './dashboard-presentation';

describe('dashboard presentation', () => {
  it('keeps the welcome and primary action without a date label', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(DashboardWelcome, { firstName: 'Atharva' })));
    expect(html).toContain('<h1>Welcome, Atharva</h1>');
    expect(html).toContain('A clear view of your candidates and evaluation workload.');
    expect(html).toContain('href="/candidates/new"');
    expect(html).toContain('Add candidate');
    expect(html).not.toContain('Monday');
    expect(html).not.toContain('October');
  });

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

  it('averages only available recent scores and leaves an empty score set unavailable', () => {
    expect(recentScoredEvaluationAverage([{ score: 80 }, {}, { score: 60 }])).toEqual({ average: 70, count: 2 });
    expect(recentScoredEvaluationAverage([{}, {}])).toEqual({ average: undefined, count: 0 });
    expect(recentScoredEvaluationAverage([{ score: 0 }])).toEqual({ average: 0, count: 1 });
  });
});
