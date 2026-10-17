import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardResponseSchema, type DashboardResponse } from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { useCandidates } from '../candidates/useCandidates';
import { ProposedDashboardReports } from '../insights/ProposedDashboardReports';

export function DashboardPage() {
  const { profile, session } = useAuth();
  const { items, total, loading, error, reload } = useCandidates(1, 5);
  const [reports, setReports] = useState<DashboardResponse['recentEvaluations']>([]);
  const [reportsLoaded, setReportsLoaded] = useState(false);
  const [reportsError, setReportsError] = useState(false);
  useEffect(() => {
    let active = true;
    setReports([]);
    setReportsLoaded(false);
    setReportsError(false);
    async function loadReports() {
      if (!session?.access_token) { setReportsLoaded(true); return; }
      try {
        const value = await apiRequest<unknown>('/dashboard', undefined, session.access_token);
        const parsed = dashboardResponseSchema.parse(value);
        if (active) setReports(parsed.recentEvaluations.slice(0, 3));
      } catch {
        if (active) { setReports([]); setReportsError(true); }
      } finally { if (active) setReportsLoaded(true); }
    }
    void loadReports();
    return () => { active = false; };
  }, [session?.access_token]);
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  return <div className="dashboard-page">
    <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" /> {today.toUpperCase()}</div><h1>Welcome{profile?.display_name ? `, ${profile.display_name.split(/\s+/)[0]}` : ''} <span className="wave">✳</span></h1><p className="page-subtitle">Your recruiter workspace and candidate records.</p></div><Link className="primary-button link-button" to="/candidates/new"><span>＋</span> Add candidate</Link></section>
    <section className="workspace-summary"><div className="workspace-summary-icon">♙</div><div><span className="summary-label">CANDIDATES IN YOUR WORKSPACE</span><strong>{loading ? '…' : error ? '—' : total}</strong><p>{error ? 'We could not load the current count.' : 'Candidate profiles are private to your recruiter account.'}</p></div><Link to="/dashboard/candidates" className="view-all">Manage candidates <span>→</span></Link></section>
    <section className="table-section proposed-overview-section"><div className="section-heading"><div><h2>Proposed evaluation values</h2><p>Recent GitHub + LeetCode evidence and draft weighted indexes.</p></div><Link to="/dashboard/reports" className="view-all">Full insights →</Link></div>
      {!reportsLoaded ? <div className="candidate-list-state" role="status">Loading saved report values…</div> : reportsError ? <div className="candidate-list-state" role="status">Proposal values could not be loaded. Review saved reports in Insights or retry after reconnecting.</div> : reports.length ? <ProposedDashboardReports evaluations={reports}/> : <div className="candidate-list-state">No saved evaluation values are available yet. Run an evaluation with saved platform evidence to populate this section.</div>}
    </section>
    <section className="table-section"><div className="section-heading"><div><div className="section-title-row"><h2>Recently added</h2><span className="count-pill">{loading ? '…' : Math.min(total, 5)}</span></div><p>Latest candidate records in your workspace</p></div><Link to="/dashboard/candidates" className="view-all">View all candidates <span>→</span></Link></div>
      {loading ? <div className="candidate-list-state" role="status">Loading candidates…</div> : error ? <div className="candidate-list-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={reload}>Try again</button></div> : items.length === 0 ? <div className="candidate-list-state"><span className="placeholder-mark">♙</span><h3>No candidates yet</h3><p>Add your first candidate to get started.</p><Link className="primary-button link-button" to="/candidates/new">Add candidate</Link></div> : <div className="candidate-management-table-wrap"><table className="candidate-management-table"><thead><tr><th>Candidate</th><th>Developer profiles</th><th>Added</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{items.map((candidate) => <tr key={candidate.id}><td><Link className="management-candidate" to={`/candidates/${candidate.id}`}><span className="avatar avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span></Link></td><td className="candidate-profile-count">{[candidate.githubUsername, candidate.leetcodeUsername, candidate.hackerrankUsername].filter(Boolean).length} linked</td><td><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></td><td><Link className="row-action" to={`/candidates/${candidate.id}`} aria-label={`View ${candidate.name}`}>↗</Link></td></tr>)}</tbody></table></div>}
    </section>
    <p className="candidate-management-note"><span aria-hidden="true">ⓘ</span> See evaluation activity and compatible candidate rankings in <Link to="/dashboard/reports">Insights</Link>.</p>
  </div>;
}
