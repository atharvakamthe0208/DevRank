import { useState } from 'react';
import type { DashboardResponse } from '@devrank/contracts';
import { ActiveDashboardReports } from './ProposedDashboardReports';
import { filterDraftEvidenceIndexes, type DraftStatusFilter } from './draft-evidence-search';

export function DraftEvidenceIndexes({ evaluations }: { evaluations: DashboardResponse['recentEvaluations'] }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DraftStatusFilter>('all');
  const filtered = filterDraftEvidenceIndexes(evaluations, query, statusFilter);

  return <details className="insights-panel insights-draft-disclosure">
    <summary><span><strong>Draft evidence indexes</strong></span></summary>
    <div className="insights-draft-content">
      <div className="insights-draft-toolbar">
        <label className="insights-draft-search"><span className="sr-only">Search drafts by candidate, role, or status</span><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drafts by candidate, role or status..."/></label>
        <label className="insights-draft-status"><span className="sr-only">Filter drafts by status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DraftStatusFilter)}><option value="all">All drafts</option><option value="insufficient_evidence">Insufficient evidence</option><option value="scored">Scored</option></select></label>
        <span className="insights-draft-count" aria-live="polite">{query.trim() || statusFilter !== 'all' ? `${filtered.length} of ${evaluations.length} drafts` : `${evaluations.length} ${evaluations.length === 1 ? 'draft' : 'drafts'}`}</span>
      </div>
      {evaluations.length === 0 ? <p className="insights-draft-empty">No draft evidence indexes yet.</p>
        : filtered.length === 0 ? <p className="insights-draft-empty" role="status">No drafts match your search and filters.</p>
          : <ActiveDashboardReports evaluations={filtered}/>}
    </div>
  </details>;
}
