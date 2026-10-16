import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { candidateSchema, githubInsightsSchema, proposedRubric, scoringCategories } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { CandidatePlatformDataPanel } from './CandidatePlatformDataPanel';
import { ProposedRubricPanel } from './ProposedRubricPanel';

const partialInsights = githubInsightsSchema.parse({
  requestedLogin: 'candidate', attributionStatus: 'matched', attributedLogin: 'candidate',
  currentYearContributions: {
    status: 'partial', year: 2026, timezone: 'UTC', periodStart: '2026-01-01T00:00:00.000Z',
    periodEnd: '2026-12-31T23:59:59.999Z', observedThrough: '2026-10-16T23:59:59.999Z',
    observedAt: '2026-10-17T01:00:00.000Z', totalContributions: 44,
    weeklyContributions: [{ weekStart: '2026-10-12', contributionCount: 7 }],
    observedWeeks: 42, activeWeeks: 9, activeWeekCoveragePercent: 21.43,
    contributionsPerObservedWeek: 1.05,
    contributionTypes: { commits: 31, pullRequestsOpened: 5 }, reasons: ['partial_response'],
  },
  developmentActivity: { status: 'partial', totalCommitContributions: 31, activeCommitDays: 8, activeCommitWeeks: 5, duplicateDailyRecords: 0, reasons: ['partial_response'] },
  collaboration: { status: 'partial', pullRequestsOpened: 5, reviewsSubmitted: 2, reasons: ['partial_response'] },
  limitations: ['Counts are descriptive context only.'],
});

describe('proposed rubric and contribution panel', () => {
  it('is integrated into the candidate profile and visible before a GitHub snapshot exists', () => {
    const candidate = candidateSchema.parse({
      id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Test Candidate', email: 'test@example.com',
      createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z',
    });
    const html = renderToStaticMarkup(createElement(AuthProvider, null,
      createElement(CandidatePlatformDataPanel, { candidate })));
    expect(html).toContain('Proposed GitHub + LeetCode Rubric');
    expect(html).toContain('Project Portfolio');
    expect(html).toContain('GitHub contribution history');
    expect(html).toContain('Loading saved contribution history');
    expect(html).toContain('>loading</span>');
  });

  it('renders all six categories, proposed weights, sources, signals, and non-policy notice', () => {
    const html = renderToStaticMarkup(createElement(ProposedRubricPanel, { snapshotState: 'idle' }));
    expect(html).toContain('Proposed GitHub + LeetCode Rubric');
    expect(html).toContain('not approved policy');
    expect(html).toContain('not used by the active scorer');
    expect(html).toContain('Communication Skills remains an active v3 category');
    for (const category of proposedRubric.categories) {
      expect(html).toContain(category.displayName.replaceAll('&', '&amp;'));
      expect(html).toContain(`${category.proposedWeight}%`);
      expect(html).toContain(category.source === 'github' ? 'Evidence source: GitHub' : 'Evidence source: LeetCode');
      expect(html).toContain(category.definition);
    }
    expect(html).toContain('No saved GitHub contribution snapshot is available');
    expect(html).toContain('server-side contribution token');
  });

  it('renders partial current-year history, capture time, available types, weekly distribution, and gaps without scoring it', () => {
    const html = renderToStaticMarkup(createElement(ProposedRubricPanel, { insights: partialInsights, snapshotState: 'synced' }));
    expect(html).toContain('2026 calendar year');
    expect(html).toContain('partial');
    expect(html).toContain('2026-10-17 01:00:00 UTC');
    expect(html).toContain('44');
    expect(html).toContain('31');
    expect(html).toContain('Pull requests opened');
    expect(html).toContain('Issues opened</span><strong>Unavailable');
    expect(html).toContain('Active UTC weeks');
    expect(html).toContain('1.05');
    expect(html).toContain('Contributions by observed UTC week');
    expect(html).toContain('Some contribution fields or dates were missing');
    expect(html).toContain('not scores');
  });

  it('explains unavailable token-backed history and older snapshots without inventing values', () => {
    const notConfigured = githubInsightsSchema.parse({
      requestedLogin: 'candidate', attributionStatus: 'matched', attributedLogin: 'candidate',
      currentYearContributions: {
        status: 'unavailable', year: 2026, timezone: 'UTC', periodStart: '2026-01-01T00:00:00.000Z',
        periodEnd: '2026-12-31T23:59:59.999Z', observedThrough: '2026-10-16T23:59:59.999Z',
        observedAt: '2026-10-17T01:00:00.000Z', reasons: ['not_configured'],
      },
      developmentActivity: { status: 'unavailable', duplicateDailyRecords: 0, reasons: ['not_configured'] },
      collaboration: { status: 'unavailable', reasons: ['not_configured'] }, limitations: [],
    });
    const notConfiguredHtml = renderToStaticMarkup(createElement(ProposedRubricPanel, { insights: notConfigured, snapshotState: 'synced' }));
    expect(notConfiguredHtml).toContain('server-side GitHub contribution token is not configured');
    expect(notConfiguredHtml).toContain('Calendar contribution total</span><strong>Unavailable');
    expect(notConfiguredHtml).not.toContain('Calendar contribution total</span><strong>0');

    const oldSnapshotHtml = renderToStaticMarkup(createElement(ProposedRubricPanel, { snapshotState: 'synced' }));
    expect(oldSnapshotHtml).toContain('predates contribution-history capture');
  });

  it('keeps the proposed category set separate from the active persisted scoring rubric', () => {
    expect(scoringCategories.map(({ id }) => id)).toContain('communication_skills');
    expect(scoringCategories.map(({ id }) => id)).not.toContain('current_year_contributions');
    expect(proposedRubric.status).toBe('proposed');
  });
});
