import { useReducer } from 'react';
import type { DashboardResponse } from '@devrank/contracts';
import { ActiveDashboardReports } from './ProposedDashboardReports';
import { DRAFT_EVIDENCE_PAGE_SIZE, deduplicateDraftEvidenceIndexes, draftEvidenceListReducer, draftEvidencePageCount, draftPaginationState, filterDraftEvidenceIndexes, paginateDraftEvidenceIndexes } from './draft-evidence-search';

export function DraftEvidenceIndexes({ evaluations }: { evaluations: DashboardResponse['recentEvaluations'] }) {
  const [state, dispatch] = useReducer(draftEvidenceListReducer, { query: '', statusFilter: 'all', page: 1 });
  const uniqueEvaluations = deduplicateDraftEvidenceIndexes(evaluations);
  const filtered = filterDraftEvidenceIndexes(uniqueEvaluations, state.query, state.statusFilter);
  const pageCount = draftEvidencePageCount(filtered.length, DRAFT_EVIDENCE_PAGE_SIZE);
  const { currentPage, previousDisabled, nextDisabled } = draftPaginationState(state.page, pageCount);
  const pageItems = paginateDraftEvidenceIndexes(filtered, currentPage, DRAFT_EVIDENCE_PAGE_SIZE);

  return <details className="insights-panel insights-draft-disclosure">
    <summary><span><strong>Draft evidence indexes</strong></span></summary>
    <div className="insights-draft-content">
      <div className="insights-draft-toolbar">
        <label className="insights-draft-search"><span className="sr-only">Search drafts by candidate, role, or status</span><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" value={state.query} onChange={(event) => dispatch({ type: 'query_changed', query: event.target.value })} placeholder="Search drafts by candidate, role or status..."/></label>
        <label className="insights-draft-status"><span className="sr-only">Filter drafts by status</span><select value={state.statusFilter} onChange={(event) => dispatch({ type: 'status_changed', statusFilter: event.target.value as typeof state.statusFilter })}><option value="all">All drafts</option><option value="insufficient_evidence">Insufficient evidence</option><option value="scored">Scored</option></select></label>
        <span className="insights-draft-count" aria-live="polite">{filtered.length} {filtered.length === 1 ? 'draft' : 'drafts'}</span>
      </div>
      {evaluations.length === 0 ? <p className="insights-draft-empty">No draft evidence indexes yet.</p>
        : filtered.length === 0 ? <p className="insights-draft-empty" role="status">No drafts match your search and filters.</p>
          : <><ActiveDashboardReports evaluations={pageItems}/>{pageCount > 1 && <nav className="insights-draft-pagination" aria-label="Draft evidence pages">
            <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'page_changed', page: currentPage - 1 })} disabled={previousDisabled}>Previous</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <button key={page} type="button" className="secondary-button insights-draft-page-number" onClick={() => dispatch({ type: 'page_changed', page })} aria-label={`Page ${page}`} aria-current={currentPage === page ? 'page' : undefined}>{page}</button>)}
            <button type="button" className="secondary-button" onClick={() => dispatch({ type: 'page_changed', page: currentPage + 1 })} disabled={nextDisabled}>Next</button>
          </nav>}</>}
    </div>
  </details>;
}
