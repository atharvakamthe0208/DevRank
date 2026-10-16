import { describe, expect, it } from 'vitest';
import { currentUtcCalendarRange, normalizeGitHubInsights } from '../src/services/github-contribution-normalizer.js';

function calendarDays(start: string, count: number, overrides: Record<string, number> = {}) {
  const first = new Date(`${start}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setUTCDate(first.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, contributionCount: overrides[key] ?? 0 };
  });
}

function input(days: Array<{ date: string; contributionCount: number }>, more: Record<string, unknown> = {}) {
  return {
    data: { user: { login: 'octocat', contributionsCollection: {
      contributionCalendar: { totalContributions: days.reduce((sum, day) => sum + day.contributionCount, 0), weeks: [{ contributionDays: days }] },
      totalCommitContributions: 2,
      totalPullRequestContributions: 1,
      totalIssueContributions: 0,
      totalPullRequestReviewContributions: 3,
      commitContributionsByRepository: [],
      ...more,
    } } },
  };
}

describe('GitHub contribution evidence normalization', () => {
  it('uses a full UTC calendar-year window and an as-of query bound', () => {
    const range = currentUtcCalendarRange(new Date('2026-01-01T00:30:00+05:30'));
    expect(range).toEqual({
      year: 2025,
      from: '2025-01-01T00:00:00.000Z',
      to: '2025-12-31T19:00:00.000Z',
      periodEnd: '2025-12-31T23:59:59.999Z',
      observedAt: '2025-12-31T19:00:00.000Z',
    });
    const midyear = normalizeGitHubInsights(input(calendarDays('2026-01-01', 2, { '2026-01-01': 1 })), 'octocat', new Date('2026-01-02T23:59:59Z'));
    expect(midyear.currentYearContributions).toMatchObject({
      year: 2026, timezone: 'UTC', periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2026-12-31T23:59:59.999Z', observedThrough: '2026-01-02T23:59:59.000Z',
      totalContributions: 1, status: 'available',
    });
  });

  it('filters previous and next calendar-year days and does not double-count duplicate dates', () => {
    const now = new Date('2026-01-02T12:00:00Z');
    const result = normalizeGitHubInsights(input([
      { date: '2025-12-31', contributionCount: 99 },
      { date: '2026-01-01', contributionCount: 2 },
      { date: '2026-01-01', contributionCount: 2 },
      { date: '2026-01-02', contributionCount: 1 },
      { date: '2027-01-01', contributionCount: 77 },
    ]), 'octocat', now);
    expect(result.currentYearContributions.totalContributions).toBe(3);
    expect(result.currentYearContributions.dailyContributions).toEqual([
      { date: '2026-01-01', contributionCount: 2 }, { date: '2026-01-02', contributionCount: 1 },
    ]);
    expect(result.currentYearContributions.reasons).toContain('partial_response');
    expect(result.currentYearContributions).not.toHaveProperty('totalContributions', 181);
  });

  it('uses UTC date boundaries when a local timestamp crosses New Year', () => {
    const range = currentUtcCalendarRange(new Date('2026-01-01T00:15:00+05:30'));
    expect(range.year).toBe(2025);
    expect(range.from).toBe('2025-01-01T00:00:00.000Z');
    expect(range.observedAt).toBe('2025-12-31T18:45:00.000Z');
  });

  it('marks conflicting duplicate days partial and chooses the larger observed count once', () => {
    const result = normalizeGitHubInsights(input([
      { date: '2026-01-01', contributionCount: 1 }, { date: '2026-01-01', contributionCount: 4 },
      { date: '2026-01-02', contributionCount: 0 },
    ]), 'octocat', new Date('2026-01-02T12:00:00Z'));
    expect(result.currentYearContributions.totalContributions).toBe(4);
    expect(result.currentYearContributions.reasons).toContain('duplicate_conflict');
    expect(result.currentYearContributions.status).toBe('partial');
  });

  it('keeps missing history unavailable instead of converting it to zero', () => {
    const missing = normalizeGitHubInsights({ data: { user: { login: 'octocat', contributionsCollection: { contributionCalendar: { weeks: [] } } } } }, 'octocat', new Date('2026-02-01T12:00:00Z'));
    expect(missing.currentYearContributions.status).toBe('unavailable');
    expect(missing.currentYearContributions).not.toHaveProperty('totalContributions');

    const malformedOnly = normalizeGitHubInsights(input([{ date: 'not-a-date', contributionCount: 99 }]), 'octocat', new Date('2026-01-01T12:00:00Z'));
    expect(malformedOnly.currentYearContributions.status).toBe('unavailable');
    expect(malformedOnly.currentYearContributions).not.toHaveProperty('totalContributions');
  });

  it('rejects a GitHub login mismatch and never attributes the other account data', () => {
    const result = normalizeGitHubInsights(input(calendarDays('2026-01-01', 2, { '2026-01-01': 5 })), 'candidate-handle', new Date('2026-01-02T12:00:00Z'));
    expect(result.attributionStatus).toBe('mismatched');
    expect(result.currentYearContributions).not.toHaveProperty('totalContributions');
    expect(result.developmentActivity.status).toBe('unavailable');
    expect(result.collaboration.status).toBe('unavailable');
  });

  it('preserves usable partial provider data and keeps contribution types separate from calendar volume', () => {
    const result = normalizeGitHubInsights({
      ...input(calendarDays('2026-01-01', 2, { '2026-01-01': 2 })),
      errors: [{ message: 'one optional field unavailable' }],
    }, 'octocat', new Date('2026-01-02T12:00:00Z'));
    expect(result.currentYearContributions.status).toBe('partial');
    expect(result.currentYearContributions.totalContributions).toBe(2);
    expect(result.currentYearContributions.contributionTypes).toEqual({ commits: 2, pullRequestsOpened: 1, issuesOpened: 0, reviewsSubmitted: 3 });
    expect(result.currentYearContributions.totalContributions).not.toBe(2 + 1 + 0 + 3);
  });

  it('counts activity dates and weeks once across duplicate repository/day records', () => {
    const result = normalizeGitHubInsights(input(calendarDays('2026-01-01', 2), {
      commitContributionsByRepository: [
        { repository: { nameWithOwner: 'octocat/a' }, contributions: { nodes: [{ occurredAt: '2026-01-01T10:00:00Z', commitCount: 2 }], pageInfo: { hasNextPage: false } } },
        { repository: { nameWithOwner: 'octocat/a' }, contributions: { nodes: [{ occurredAt: '2026-01-01T18:00:00Z', commitCount: 2 }], pageInfo: { hasNextPage: false } } },
      ],
    }), 'octocat', new Date('2026-01-02T12:00:00Z'));
    expect(result.developmentActivity.activeCommitDays).toBe(1);
    expect(result.developmentActivity.activeCommitWeeks).toBe(1);
    expect(result.developmentActivity.duplicateDailyRecords).toBe(1);
    expect(result.developmentActivity.status).toBe('partial');
  });

  it.each([
    ['rate limit', 'rate_limited'],
    ['provider timeout', 'provider_timeout'],
    ['provider unavailable', 'provider_unavailable'],
    ['malformed response', 'malformed_response'],
  ])('classifies provider failures without exposing raw details: %s', (message, reason) => {
    const result = normalizeGitHubInsights({ errors: [{ message: `${message} with private detail` }] }, 'octocat', new Date('2026-01-01T12:00:00Z'));
    expect(result.currentYearContributions.reasons).toContain(reason);
    expect(JSON.stringify(result)).not.toContain('private detail');
  });
});
