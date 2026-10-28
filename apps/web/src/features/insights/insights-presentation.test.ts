import { describe, expect, it } from 'vitest';
import { comparableRecentEvaluations } from './insights-presentation';
import type { DashboardResponse } from '@devrank/contracts';

const dashboard: DashboardResponse = {
  candidateCount: 2,
  evaluatedCandidateIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  evaluationCount: 4,
  statusCounts: { pending: 0, in_progress: 0, completed: 2, insufficient_evidence: 1, failed: 1 },
  recentEvaluations: [
    { id: '11111111-1111-4111-8111-111111111111', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateName: 'Alex', status: 'completed', createdAt: '2026-10-10T10:00:00Z', score: 82, scoringVersion: '1.0.0' },
    { id: '22222222-2222-4222-8222-222222222222', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateName: 'Alex', status: 'completed', createdAt: '2026-10-09T10:00:00Z', score: 75, scoringVersion: '1.0.0' },
    { id: '33333333-3333-4333-8333-333333333333', candidateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', candidateName: 'Sam', status: 'insufficient_evidence', createdAt: '2026-10-08T10:00:00Z', scoringVersion: '1.0.0' },
    { id: '44444444-4444-4444-8444-444444444444', candidateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', candidateName: 'Lee', status: 'failed', createdAt: '2026-10-07T10:00:00Z', scoringVersion: null },
  ],
};

describe('insights presentation', () => {
  it('offers only the newest supported evaluation per candidate, including incomplete-evidence runs', () => {
    expect(comparableRecentEvaluations(dashboard).map(({ candidateName, id }) => [candidateName, id])).toEqual([
      ['Alex', '11111111-1111-4111-8111-111111111111'],
      ['Sam', '33333333-3333-4333-8333-333333333333'],
    ]);
  });

  it('returns no comparison choices when the dashboard is unavailable', () => {
    expect(comparableRecentEvaluations(null)).toEqual([]);
  });
});
