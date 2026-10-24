import type { RecruiterApplication, RecruiterFilter } from './recruiter-application-presentation';

type Props = {
  busy: boolean;
  error: string;
  rows: RecruiterApplication[];
  filter: RecruiterFilter;
  searchQuery?: string;
  activeId: string;
  activeDecision: 'approved' | 'rejected' | '';
  onRetry: () => void;
  onViewDetails: (row: RecruiterApplication) => void;
  onDecide: (row: RecruiterApplication, decision: 'approved' | 'rejected') => void;
};

function recruiterInitials(name: string | null): string {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export function RecruiterApplicationsList({ busy, error, rows, filter, searchQuery = '', activeId, activeDecision, onRetry, onViewDetails, onDecide }: Props) {
  if (busy) return <div className="admin-table-loading" role="status" aria-busy="true">
    <span className="sr-only">Loading recruiter accounts…</span>
    <div className="admin-table-scroll" aria-hidden="true">
      <table className="admin-table admin-table-skeleton">
        <thead><tr><th scope="col">Recruiter</th><th scope="col">Work email</th><th scope="col">Registered</th><th scope="col">Status</th><th scope="col">Details</th><th scope="col">Decision</th></tr></thead>
        <tbody>{Array.from({ length: 5 }, (_, index) => <tr key={index}>
          <td><span className="admin-skeleton admin-skeleton-person"/></td>
          <td><span className="admin-skeleton admin-skeleton-email"/></td>
          <td><span className="admin-skeleton admin-skeleton-date"/></td>
          <td><span className="admin-skeleton admin-skeleton-status"/></td>
          <td><span className="admin-skeleton admin-skeleton-detail"/></td>
          <td><span className="admin-skeleton-actions"><span className="admin-skeleton admin-skeleton-action"/><span className="admin-skeleton admin-skeleton-action"/></span></td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
  if (error) return <div className="admin-load-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={onRetry}>Try again</button></div>;
  if (rows.length === 0) return <p className="admin-empty">{searchQuery.trim() ? 'No recruiters match your search.' : 'No ' + (filter === 'all' ? 'recruiter' : filter) + ' applications to show.'}</p>;

  return <div className="admin-table-scroll" role="region" tabIndex={0} aria-label="Recruiter application list; scroll horizontally on narrow screens">
    <table className="admin-table">
      <thead><tr><th scope="col">Recruiter</th><th scope="col">Work email</th><th scope="col">Registered</th><th scope="col">Status</th><th scope="col">Details</th><th scope="col">Decision</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.user_id}>
        <td><div className="admin-recruiter-cell"><span className="admin-recruiter-avatar" aria-hidden="true">{recruiterInitials(row.display_name)}</span><strong>{row.display_name || 'Name not provided'}</strong></div></td>
        <td>{row.email || '—'}</td>
        <td><time dateTime={row.registered_at}>{row.registered_at ? new Date(row.registered_at).toLocaleDateString() : '—'}</time></td>
        <td><span className={`admin-status status-${row.approval_status}`}>{row.approval_status}</span></td>
        <td><button className="admin-view-details" type="button" onClick={() => onViewDetails(row)} aria-label={`View details for ${row.display_name || row.email || 'recruiter'}`}>View details</button></td>
        <td>{row.approval_status === 'pending' ? <div className="admin-actions">
          <button className="approve-button" type="button" disabled={Boolean(activeId)} aria-busy={activeId === row.user_id && activeDecision === 'approved'} onClick={() => onDecide(row, 'approved')}>{activeId === row.user_id && activeDecision === 'approved' ? 'Approving…' : 'Approve'}</button>
          <button className="reject-button" type="button" disabled={Boolean(activeId)} aria-busy={activeId === row.user_id && activeDecision === 'rejected'} onClick={() => onDecide(row, 'rejected')}>{activeId === row.user_id && activeDecision === 'rejected' ? 'Rejecting…' : 'Reject'}</button>
        </div> : <span aria-label="No action available">—</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
