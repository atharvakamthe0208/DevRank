import { describe, expect, it } from 'vitest';
import type { DashboardResponse } from '@devrank/contracts';
import { filterDraftEvidenceIndexes } from './draft-evidence-search';

const drafts: DashboardResponse['recentEvaluations'] = [
  { id: '11111111-1111-4111-8111-111111111111', candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', candidateName: 'Alex Rivera', targetRole: 'software_developer', status: 'completed', createdAt: '2026-10-01T00:00:00Z', score: 82, scoringVersion: '4.0.0' },
  { id: '22222222-2222-4222-8222-222222222222', candidateId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', candidateName: 'Sam Chen', targetRole: 'data_analyst', status: 'insufficient_evidence', createdAt: '2026-10-02T00:00:00Z', scoringVersion: '4.1.0' },
  { id: '33333333-3333-4333-8333-333333333333', candidateId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', candidateName: 'Lee Park', targetRole: null, status: 'failed', createdAt: '2026-10-03T00:00:00Z', scoringVersion: null },
];

describe('draft evidence index search', () => {
  it('matches candidate, role, status, evaluation ID, and scoring version without case sensitivity', () => {
    expect(filterDraftEvidenceIndexes(drafts, 'ALEX RIVERA', 'all').map(({ id }) => id)).toEqual([drafts[0]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, 'DATA ANALYST', 'all').map(({ id }) => id)).toEqual([drafts[1]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, 'INSUFFICIENT EVIDENCE', 'all').map(({ id }) => id)).toEqual([drafts[1]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, '33333333-3333', 'all').map(({ id }) => id)).toEqual([drafts[2]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, '4.1.0', 'all').map(({ id }) => id)).toEqual([drafts[1]!.id]);
  });

  it('combines status filtering with text matching and only treats saved scores as scored', () => {
    expect(filterDraftEvidenceIndexes(drafts, '', 'insufficient_evidence').map(({ id }) => id)).toEqual([drafts[1]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, 'software', 'scored').map(({ id }) => id)).toEqual([drafts[0]!.id]);
    expect(filterDraftEvidenceIndexes(drafts, 'Alex', 'insufficient_evidence')).toEqual([]);
  });

  it('supports distinct empty-dataset and no-match states', () => {
    expect(filterDraftEvidenceIndexes([], '', 'all')).toEqual([]);
    expect(filterDraftEvidenceIndexes(drafts, 'missing value', 'all')).toEqual([]);
  });
});
