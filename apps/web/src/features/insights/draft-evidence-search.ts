import type { DashboardResponse } from '@devrank/contracts';
import { dashboardRoleLabel } from '../dashboard/dashboard-presentation';

export type DraftStatusFilter = 'all' | 'insufficient_evidence' | 'scored';
export type DraftEvidenceIndex = DashboardResponse['recentEvaluations'][number];

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
