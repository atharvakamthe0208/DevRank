import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { apiRequest } from '../../lib/api/client';

type RecruiterApplication = { user_id: string; email: string; display_name: string | null; registered_at: string; approval_status: 'pending' | 'approved' | 'rejected' };
type Filter = 'all' | RecruiterApplication['approval_status'];

export function AdminRecruitersPage() {
  const { session, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [filter,setFilter] = useState<Filter>('pending');
  const [rows,setRows] = useState<RecruiterApplication[]>([]);
  const [busy,setBusy] = useState(true);
  const [activeId,setActiveId] = useState('');
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [logoutError,setLogoutError] = useState('');

  const load = useCallback(async () => {
    if (!session) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest<{ recruiters: RecruiterApplication[] }>(`/admin/recruiters?status=${filter}`, undefined, session.access_token);
      setRows(result.recruiters);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Recruiter applications could not be loaded.');
    } finally { setBusy(false); }
  }, [filter,session]);

  useEffect(() => { void load(); }, [load]);

  async function decide(row: RecruiterApplication, decision: 'approved' | 'rejected') {
    const label = decision === 'approved' ? 'approve' : 'reject';
    if (!window.confirm(`Are you sure you want to ${label} ${row.display_name || row.email}?`)) return;
    if (!session) return;
    setActiveId(row.user_id); setError(''); setNotice('');
    try {
      await apiRequest(`/admin/recruiters/${row.user_id}/decision`, { method: 'PATCH', body: JSON.stringify({ decision }) }, session.access_token);
      setNotice(`${row.display_name || row.email} was ${decision}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recruiter application could not be updated.');
    } finally { setActiveId(''); }
  }

  async function logout() {
    setLogoutError('');
    try { await signOut(); navigate('/login',{replace:true}); }
    catch { setLogoutError('Could not sign out. Check your connection and try again.'); }
  }

  return <div className="admin-page">
    <header className="admin-topbar"><Link to="/admin/recruiters" className="brand"><span className="brand-mark">d.</span><span>devrank<span className="brand-period">.</span></span></Link><div className="admin-account"><span>{profile?.display_name || 'Administrator'}</span><button className="logout-button" onClick={() => void logout()}>Log out</button></div></header>
    <main className="admin-content">
      <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> ADMINISTRATION</div><h1>Recruiter applications</h1><p className="page-subtitle">Review recruiter accounts before they can access DevRank.</p></div><span className="admin-role-badge">Project administrator</span></div>
      <section className="admin-panel">
        <div className="admin-panel-head"><div><h2>Recruiter accounts</h2><p>Approval decisions are recorded in the audit log.</p></div><label className="admin-filter">Status <select value={filter} onChange={(event)=>setFilter(event.target.value as Filter)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All statuses</option></select></label></div>
        {error&&<p className="form-feedback form-feedback-error" role="alert">{error}</p>}{notice&&<p className="form-feedback" role="status">{notice}</p>}{logoutError&&<p className="form-feedback form-feedback-error" role="alert">{logoutError}</p>}
        {busy?<p className="admin-empty" role="status">Loading recruiter accounts…</p>:rows.length===0?<p className="admin-empty">No {filter==='all'?'recruiter':filter} applications to show.</p>:<div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Recruiter</th><th>Work email</th><th>Registered</th><th>Status</th><th>Decision</th></tr></thead><tbody>{rows.map((row)=><tr key={row.user_id}><td>{row.display_name||'Name not provided'}</td><td>{row.email}</td><td>{row.registered_at?new Date(row.registered_at).toLocaleDateString(): '—'}</td><td><span className={`admin-status status-${row.approval_status}`}>{row.approval_status}</span></td><td>{row.approval_status==='pending'?<div className="admin-actions"><button className="approve-button" disabled={Boolean(activeId)} onClick={()=>void decide(row,'approved')}>{activeId===row.user_id?'Saving…':'Approve'}</button><button className="reject-button" disabled={Boolean(activeId)} onClick={()=>void decide(row,'rejected')}>Reject</button></div>:'—'}</td></tr>)}</tbody></table></div>}
      </section>
      <p className="admin-security-note"><span>ⓘ</span> Only project-owner-provisioned administrators can review these applications. Recruiter accounts cannot grant themselves administrator access.</p>
    </main>
  </div>;
}
