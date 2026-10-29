import type { DashboardResponse } from '@devrank/contracts';
import { dashboardRoleLabel } from '../dashboard/dashboard-presentation';

export type DraftStatusFilter = 'all' | 'insufficient_evidence' | 'scored';
export type DraftEvidenceIndex = DashboardResponse['recentEvaluations'][number];
export const DRAFT_EVIDENCE_PAGE_SIZE = 2;

export type DraftEvidenceListState = { query: string; statusFilter: DraftStatusFilter; page: number };
export type DraftEvidenceListAction =
  | { type: 'query_changed'; query: string }
  | { type: 'status_changed'; statusFilter: DraftStatusFilter }
  | { type: 'page_changed'; page: number };

export function draftEvidenceListReducer(state: DraftEvidenceListState, action: DraftEvidenceListAction): DraftEvidenceListState {
  if (action.type === 'query_changed') return { ...state, query: action.query, page: 1 };
  if (action.type === 'status_changed') return { ...state, statusFilter: action.statusFilter, page: 1 };
  return { ...state, page: Math.max(1, action.page) };
}

export function draftEvidencePageCount(resultCount: number, pageSize = DRAFT_EVIDENCE_PAGE_SIZE): number {
  return Math.ceil(resultCount / pageSize);
}

export function draftPaginationState(page: number, pageCount: number): { currentPage: number; previousDisabled: boolean; nextDisabled: boolean } {
  const currentPage = Math.min(Math.max(1, page), Math.max(1, pageCount));
  return { currentPage, previousDisabled: currentPage === 1, nextDisabled: pageCount === 0 || currentPage >= pageCount };
}

export function paginateDraftEvidenceIndexes<T>(drafts: readonly T[], page: number, pageSize = DRAFT_EVIDENCE_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page);
  return drafts.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function deduplicateDraftEvidenceIndexes(drafts: readonly DraftEvidenceIndex[]): DraftEvidenceIndex[] {
  const seenIds = new Set<string>();
  return drafts.filter((draft) => {
    if (seenIds.has(draft.id)) return false;
    seenIds.add(draft.id);
    return true;
  });
}

export function filterDraftEvidenceIndexes(
  drafts: readonly DraftEvidenceIndex[],
  query: string,
  statusFilter: DraftStatusFilter,
): DraftEvidenceIndex[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return drafts.filter((draft) => {
    if (statusFilter === 'insufficient_evidence' && draft.status !== 'insufficient_evidence') return false;
    if (statusFilter === 'scored' && (draft.status !== 'completed' || draft.score === undefined)) return false;
    if (!normalizedQuery) return true;
    const searchable = [draft.candidateName, draft.targetRole ? dashboardRoleLabel(draft.targetRole) : undefined,
      draft.targetRole ?? undefined, draft.status.replaceAll('_', ' '), draft.id, draft.scoringVersion ?? undefined];
    return searchable.some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  });
}
