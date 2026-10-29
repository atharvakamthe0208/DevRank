import { describe, expect, it } from 'vitest';
import type { DashboardResponse } from '@devrank/contracts';
import { DRAFT_EVIDENCE_PAGE_SIZE, deduplicateDraftEvidenceIndexes, draftEvidenceListReducer, draftEvidencePageCount, draftPaginationState, filterDraftEvidenceIndexes, paginateDraftEvidenceIndexes } from './draft-evidence-search';

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

  it('paginates filtered drafts in groups of two and counts only filtered results', () => {
    const manyDrafts = Array.from({ length: 12 }, (_, index) => ({ ...drafts[index % drafts.length]!, id: `draft-${index + 1}`, candidateName: `Candidate ${index + 1}` }));
    const filtered = filterDraftEvidenceIndexes(manyDrafts, 'Candidate', 'all');
    expect(DRAFT_EVIDENCE_PAGE_SIZE).toBe(2);
    expect(draftEvidencePageCount(filtered.length)).toBe(6);
    expect(paginateDraftEvidenceIndexes(filtered, 1).map(({ candidateName }) => candidateName)).toEqual(['Candidate 1', 'Candidate 2']);
    expect(paginateDraftEvidenceIndexes(filtered, 2).map(({ candidateName }) => candidateName)).toEqual(['Candidate 3', 'Candidate 4']);
    expect(paginateDraftEvidenceIndexes(filtered, 3).map(({ candidateName }) => candidateName)).toEqual(['Candidate 5', 'Candidate 6']);
    expect(paginateDraftEvidenceIndexes(filtered, 4).map(({ candidateName }) => candidateName)).toEqual(['Candidate 7', 'Candidate 8']);
    expect(paginateDraftEvidenceIndexes(filtered, 5).map(({ candidateName }) => candidateName)).toEqual(['Candidate 9', 'Candidate 10']);
    expect(paginateDraftEvidenceIndexes(filtered, 6).map(({ candidateName }) => candidateName)).toEqual(['Candidate 11', 'Candidate 12']);
    const matching = filterDraftEvidenceIndexes(manyDrafts, 'Candidate 1', 'all');
    expect(matching).toHaveLength(4);
    expect(draftEvidencePageCount(matching.length)).toBe(2);
    expect(paginateDraftEvidenceIndexes(matching, 3)).toEqual([]);
    expect(draftEvidencePageCount(0)).toBe(0);
    expect(draftPaginationState(1, 3)).toEqual({ currentPage: 1, previousDisabled: true, nextDisabled: false });
    expect(draftPaginationState(3, 3)).toEqual({ currentPage: 3, previousDisabled: false, nextDisabled: true });
    expect(draftPaginationState(5, 3)).toEqual({ currentPage: 3, previousDisabled: false, nextDisabled: true });
    expect(draftPaginationState(1, 0)).toEqual({ currentPage: 1, previousDisabled: true, nextDisabled: true });
  });

  it('deduplicates by evaluation ID while retaining same-name evaluations with different IDs', () => {
    const duplicate = { ...drafts[0]!, candidateName: 'Duplicate representation', id: drafts[0]!.id };
    const sameNameDifferentEvaluation = { ...drafts[1]!, candidateName: drafts[0]!.candidateName };
    const unique = deduplicateDraftEvidenceIndexes([drafts[0]!, duplicate, sameNameDifferentEvaluation, drafts[2]!]);
    expect(unique.map(({ id }) => id)).toEqual([drafts[0]!.id, drafts[1]!.id, drafts[2]!.id]);
    expect(unique.filter(({ candidateName }) => candidateName === drafts[0]!.candidateName)).toHaveLength(2);
    expect(filterDraftEvidenceIndexes(unique, 'Duplicate representation', 'all')).toEqual([]);

    const seven = Array.from({ length: 7 }, (_, index) => ({ ...drafts[index % drafts.length]!, id: `unique-${index + 1}`, candidateName: index < 2 ? 'Shared candidate' : `Candidate ${index + 1}` }));
    const sevenUnique = deduplicateDraftEvidenceIndexes([...seven, { ...seven[0]!, candidateName: 'Duplicate copy' }]);
    const pages = Array.from({ length: draftEvidencePageCount(sevenUnique.length) }, (_, index) => paginateDraftEvidenceIndexes(sevenUnique, index + 1));
    const allIds = pages.flat().map(({ id }) => id);
    expect(pages.map((page) => page.length)).toEqual([2, 2, 2, 1]);
    expect(new Set(allIds).size).toBe(7);
    expect(sevenUnique.filter(({ candidateName }) => candidateName === 'Shared candidate')).toHaveLength(2);
  });

  it('moves between pages and resets pagination when the query or status changes', () => {
    const initial = { query: '', statusFilter: 'all' as const, page: 1 };
    const pageTwo = draftEvidenceListReducer(initial, { type: 'page_changed', page: 2 });
    expect(pageTwo.page).toBe(2);
    expect(draftEvidenceListReducer(pageTwo, { type: 'query_changed', query: 'Alex' })).toEqual({ query: 'Alex', statusFilter: 'all', page: 1 });
    expect(draftEvidenceListReducer(pageTwo, { type: 'status_changed', statusFilter: 'scored' })).toEqual({ query: '', statusFilter: 'scored', page: 1 });
  });
});
