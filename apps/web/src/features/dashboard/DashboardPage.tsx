import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardResponseSchema, type DashboardResponse } from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { useCandidates } from '../candidates/useCandidates';
import { ActiveDashboardReports } from '../insights/ProposedDashboardReports';
import { dashboardActivityCounts, dashboardScoreLabel } from './dashboard-presentation';

function statusLabel(status: DashboardResponse['recentEvaluations'][number]['status']) {
  return status.replaceAll('_', ' ');
}

export function DashboardPage() {
  const { profile, session } = useAuth();
  const { items, loading: candidatesLoading, error: candidatesError, reload } = useCandidates(1, 5);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setDashboardLoading(true);
      setDashboardError(false);
      if (!session?.access_token) {
        if (active) { setDashboard(null); setDashboardError(true); setDashboardLoading(false); }
        return;
      }
      try {
        const parsed = dashboardResponseSchema.parse(await apiRequest<unknown>('/dashboard', undefined, session.access_token));
        if (active) setDashboard(parsed);
      } catch {
        if (active) { setDashboard(null); setDashboardError(true); }
      } finally { if (active) setDashboardLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [session?.access_token, attempt]);

  const loading = dashboardLoading;
  const error = dashboardError;
  const activity = dashboardActivityCounts(dashboard);
  const firstName = profile?.display_name?.split(/\s+/)[0];
  const displayDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());

  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div><div className="eyebrow"><span className="eyebrow-line" />{displayDate.toUpperCase()}</div><h1>{firstName ? `Welcome, ${firstName}` : 'Recruiter overview'}</h1><p className="page-subtitle">A clear view of your candidates and evaluation workload.</p></div>
      <Link className="primary-button link-button" to="/candidates/new"><span aria-hidden="true">＋</span> Add candidate</Link>
    </section>

    <section className="dashboard-metrics" aria-label="Evaluation overview">
      <Metric label="Candidates" value={loading ? '…' : error ? '—' : dashboard?.candidateCount ?? '—'} detail="In your workspace" />
      <Metric label="Completed" value={loading ? '…' : error ? '—' : activity.completed ?? '—'} detail="Evaluations with a final result" tone="positive" />
      <Metric label="In progress or failed" value={loading ? '…' : error ? '—' : activity.inProgress ?? '—'} detail="Pending, running, or failed" tone="attention" />
      <Metric label="Need more evidence" value={loading ? '…' : error ? '—' : activity.insufficientEvidence ?? '—'} detail="No score inferred for missing evidence" tone="neutral" />
    </section>

    <section className="dashboard-panel" aria-labelledby="recent-evaluations-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">WORKSPACE ACTIVITY</span><h2 id="recent-evaluations-heading">Recent evaluations</h2><p>Saved status and deterministic scores from your latest runs.</p></div><Link className="dashboard-text-link" to="/evaluations">Run evaluation <span aria-hidden="true">→</span></Link></div>
      {loading ? <p className="dashboard-state" role="status">Loading evaluation activity…</p> : error ? <div className="dashboard-state" role="alert"><p>Evaluation activity could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard?.recentEvaluations.length ? <div className="dashboard-evaluation-list">
        {dashboard.recentEvaluations.slice(0, 5).map((item) => <article className="dashboard-evaluation-row" key={item.id}>
          <Link className="dashboard-candidate-link" to={`/candidates/${item.candidateId}`}><span className="dashboard-avatar" aria-hidden="true">{item.candidateName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{item.candidateName}</strong><small>Scoring version {item.scoringVersion ?? 'unavailable'}</small></span></Link>
          <span className={`dashboard-status status-${item.status}`}><i aria-hidden="true" />{statusLabel(item.status)}</span>
          <span className="dashboard-score">{item.score === undefined ? <span className="dashboard-no-score">{dashboardScoreLabel(item.score)}</span> : <><strong>{item.score}</strong><small>/ 100</small></>}</span>
          <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time>
          <Link className="dashboard-open-link" to={`/evaluations/${item.id}`} aria-label={`Open ${item.candidateName} evaluation`}>Open <span aria-hidden="true">↗</span></Link>
        </article>)}
      </div> : <div className="dashboard-state"><h3>No evaluations yet</h3><p>Run an evaluation to see its saved status and score here.</p><Link className="dashboard-secondary-button" to="/evaluations">Start an evaluation</Link></div>}
    </section>

    <section className="dashboard-panel dashboard-proposal-panel" aria-labelledby="proposal-indexes-title">
      <details>
        <summary><span><span className="dashboard-kicker">SEPARATE DRAFT VIEW</span><strong id="proposal-indexes-title">GitHub + LeetCode evidence indexes</strong><small>These proposed indexes are not active evaluation scores or rankings.</small></span><span className="dashboard-disclosure" aria-hidden="true">＋</span></summary>
        {loading ? <p className="dashboard-state" role="status">Loading saved proposal indexes…</p> : error ? <div className="dashboard-state" role="alert"><p>Proposal indexes could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard && <ActiveDashboardReports evaluations={dashboard.recentEvaluations.slice(0, 3)}/>}
      </details>
    </section>

    <section className="dashboard-panel" aria-labelledby="recent-candidates-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">CANDIDATE WORKSPACE</span><h2 id="recent-candidates-heading">Recently added candidates</h2><p>Profiles and connected public developer accounts.</p></div><Link className="dashboard-text-link" to="/dashboard/candidates">Manage candidates <span aria-hidden="true">→</span></Link></div>
      {candidatesLoading ? <p className="dashboard-state" role="status">Loading candidates…</p> : candidatesError ? <div className="dashboard-state" role="alert"><p>{candidatesError}</p><button className="dashboard-secondary-button" type="button" onClick={reload}>Try again</button></div> : items.length ? <div className="dashboard-candidate-list">{items.map((candidate) => {
        const linked = [candidate.githubUsername && 'GitHub', candidate.leetcodeUsername && 'LeetCode'].filter((value): value is string => Boolean(value));
        return <Link className="dashboard-candidate-row" to={`/candidates/${candidate.id}`} key={candidate.id}><span className="dashboard-avatar" aria-hidden="true">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span className="dashboard-candidate-name"><strong>{candidate.name}</strong><small>{candidate.email || 'Email not provided'}</small></span><span className="dashboard-platforms">{linked.length ? linked.map((name) => <span key={name}>{name}</span>) : <small>No profiles linked</small>}</span><time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time><span aria-hidden="true" className="dashboard-row-arrow">↗</span></Link>;
      })}</div> : <div className="dashboard-state"><h3>No candidates yet</h3><p>Add your first candidate profile to begin.</p><Link className="dashboard-secondary-button" to="/candidates/new">Add candidate</Link></div>}
    </section>
    <p className="dashboard-integrity-note">Scores shown here come from saved deterministic evaluations. Missing or insufficient evidence is shown as unavailable, never as zero.</p>
  </div>;
}

function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: string | number; detail: string; tone?: 'positive' | 'attention' | 'neutral' }) {
  return <article className={`dashboard-metric metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
