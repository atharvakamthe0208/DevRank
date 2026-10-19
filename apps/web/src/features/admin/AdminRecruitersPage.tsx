import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { apiRequest } from '../../lib/api/client';
import {
  filterRecruiterApplications,
  summarizeRecruiterApplications,
  type RecruiterApplication,
  type RecruiterFilter,
} from './recruiter-application-presentation';
import { RecruiterApplicationsList } from './RecruiterApplicationsList';

type RecruiterDecision = { row: RecruiterApplication; decision: 'approved' | 'rejected' };

export function AdminRecruitersPage() {
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RecruiterFilter>('pending');
  const [rows, setRows] = useState<RecruiterApplication[]>([]);
  const [busy, setBusy] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [activeDecision, setActiveDecision] = useState<'approved' | 'rejected' | ''>('');
  const [pendingDecision, setPendingDecision] = useState<RecruiterDecision | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const decisionDialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      // Fetch the existing admin-only list once; use it for both summary counts and filters.
      const result = await apiRequest<{ recruiters: RecruiterApplication[] }>(
        '/admin/recruiters?status=all',
        undefined,
        session.access_token,
      );
      setRows(result.recruiters);
      setHasLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recruiter applications could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const dialog = decisionDialog.current;
    if (pendingDecision && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.focus();
    } else if (!pendingDecision && dialog?.open) {
      dialog.close();
    }
  }, [pendingDecision]);

  async function decide(row: RecruiterApplication, decision: 'approved' | 'rejected') {
    if (!session) return;
    setActiveId(row.user_id);
    setActiveDecision(decision);
    setError('');
    setNotice('');
    try {
      await apiRequest(
        `/admin/recruiters/${row.user_id}/decision`,
        { method: 'PATCH', body: JSON.stringify({ decision }) },
        session.access_token,
      );
      setNotice(`${row.display_name || row.email || 'Recruiter'} was ${decision}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recruiter application could not be updated.');
    } finally {
      setActiveId('');
      setActiveDecision('');
    }
  }

  async function logout() {
    setLogoutError('');
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch {
      setLogoutError('Could not sign out. Check your connection and try again.');
    }
  }

  const counts = summarizeRecruiterApplications(rows);
  const visibleRows = filterRecruiterApplications(rows, filter);
  const pendingName = pendingDecision?.row.display_name || pendingDecision?.row.email || 'this recruiter';

  return <div className="admin-page">
    <header className="admin-topbar">
      <Link to="/admin/recruiters" className="brand"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></Link>
      <div className="admin-account"><span>{profile?.display_name || 'Administrator'}</span><button className="logout-button" type="button" onClick={() => void logout()}>Log out</button></div>
    </header>
    <main className="admin-content">
      <div className="admin-heading">
        <div><div className="eyebrow"><span className="eyebrow-line"/> ADMINISTRATION</div><h1>Recruiter applications</h1><p className="page-subtitle">Review recruiter accounts before they can access DevRank.</p></div>
        <span className="admin-role-badge">Project administrator</span>
      </div>

      <section className="admin-summary" aria-label="Recruiter application counts" aria-busy={busy}>
        {(['pending', 'approved', 'rejected'] as const).map((status) => <article className={`admin-summary-card status-${status}`} key={status}>
          <span>{status === 'pending' ? 'Pending recruiters' : status === 'approved' ? 'Approved recruiters' : 'Rejected recruiters'}</span>
          <strong>{hasLoaded ? counts[status] : '—'}</strong>
        </article>)}
      </section>

      <section className="admin-panel" aria-labelledby="recruiter-accounts-heading">
        <div className="admin-panel-head">
          <div><h2 id="recruiter-accounts-heading">Recruiter accounts</h2><p>Approval decisions are recorded in the audit log.</p></div>
          <div className="admin-panel-controls">
            <label className="admin-filter">Status <select value={filter} onChange={(event) => setFilter(event.target.value as RecruiterFilter)}>
              <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All statuses</option>
            </select></label>
            <button className="secondary-button" type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        </div>
        {notice && <p className="form-feedback" role="status">{notice}</p>}
        {logoutError && <p className="form-feedback form-feedback-error" role="alert">{logoutError}</p>}
        <RecruiterApplicationsList busy={busy} error={error} rows={visibleRows} filter={filter} activeId={activeId} activeDecision={activeDecision} onRetry={() => void load()} onDecide={(row, decision) => setPendingDecision({ row, decision })}/>
      </section>

      <p className="admin-security-note"><span aria-hidden="true">ⓘ</span> Only project-owner-provisioned administrators can review these applications. Recruiter accounts cannot grant themselves administrator access.</p>
    </main>

    <dialog ref={decisionDialog} className="admin-confirmation" aria-labelledby="admin-confirmation-title" aria-describedby="admin-confirmation-description" onClose={() => setPendingDecision(null)}>
      <span className="admin-confirmation-kicker">RECRUITER ACCESS</span>
      <h2 id="admin-confirmation-title">{pendingDecision?.decision === 'approved' ? 'Approve recruiter?' : 'Reject recruiter?'}</h2>
      <p className="admin-confirmation-name">{pendingName}</p>
      <p id="admin-confirmation-description">{pendingDecision?.decision === 'approved' ? 'This gives the recruiter access to the protected DevRank workspace.' : 'This blocks the recruiter from accessing the protected DevRank workspace.'} The decision will be recorded in the admin audit log.</p>
      <div className="admin-confirmation-actions">
        <button className="secondary-button" type="button" data-dialog-cancel onClick={() => setPendingDecision(null)}>Cancel</button>
        <button className={pendingDecision?.decision === 'rejected' ? 'reject-button' : 'approve-button'} type="button" disabled={Boolean(activeId)} onClick={() => {
          if (!pendingDecision) return;
          const { row, decision } = pendingDecision;
          setPendingDecision(null);
          void decide(row, decision);
        }}>{pendingDecision?.decision === 'approved' ? 'Approve recruiter' : 'Reject recruiter'}</button>
      </div>
    </dialog>
  </div>;
}
