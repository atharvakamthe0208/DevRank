import type { RecruiterApplication, RecruiterFilter } from './recruiter-application-presentation';

type Props = {
  busy: boolean;
  error: string;
  rows: RecruiterApplication[];
  filter: RecruiterFilter;
  activeId: string;
  activeDecision: 'approved' | 'rejected' | '';
  onRetry: () => void;
  onDecide: (row: RecruiterApplication, decision: 'approved' | 'rejected') => void;
};

export function RecruiterApplicationsList({ busy, error, rows, filter, activeId, activeDecision, onRetry, onDecide }: Props) {
  if (busy) return <p className="admin-empty" role="status">Loading recruiter accounts…</p>;
  if (error) return <div className="admin-load-error" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={onRetry}>Try again</button></div>;
  if (rows.length === 0) return <p className="admin-empty">No {filter === 'all' ? 'recruiter' : filter} applications to show.</p>;

  return <div className="admin-table-scroll" role="region" tabIndex={0} aria-label="Recruiter application list; scroll horizontally on narrow screens">
    <table className="admin-table">
      <thead><tr><th scope="col">Recruiter</th><th scope="col">Work email</th><th scope="col">Registered</th><th scope="col">Status</th><th scope="col">Decision</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.user_id}>
        <td>{row.display_name || 'Name not provided'}</td>
        <td>{row.email || '—'}</td>
        <td><time dateTime={row.registered_at}>{row.registered_at ? new Date(row.registered_at).toLocaleDateString() : '—'}</time></td>
        <td><span className={`admin-status status-${row.approval_status}`}>{row.approval_status}</span></td>
        <td>{row.approval_status === 'pending' ? <div className="admin-actions">
          <button className="approve-button" type="button" disabled={Boolean(activeId)} aria-busy={activeId === row.user_id && activeDecision === 'approved'} onClick={() => onDecide(row, 'approved')}>{activeId === row.user_id && activeDecision === 'approved' ? 'Approving…' : 'Approve'}</button>
          <button className="reject-button" type="button" disabled={Boolean(activeId)} aria-busy={activeId === row.user_id && activeDecision === 'rejected'} onClick={() => onDecide(row, 'rejected')}>{activeId === row.user_id && activeDecision === 'rejected' ? 'Rejecting…' : 'Reject'}</button>
        </div> : <span aria-label="No action available">—</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
