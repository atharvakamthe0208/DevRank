import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardResponseSchema, persistedEvaluationReadSchema, type DashboardResponse } from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { useCandidates } from '../candidates/useCandidates';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { KpiCard } from '../../components/metrics/KpiCards';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { ActiveDashboardReports } from '../insights/ProposedDashboardReports';
import { dashboardEvaluationStatusLabel, dashboardRoleLabel, dashboardScoreAvailabilityLabel, recentScoredEvaluationAverage } from './dashboard-presentation';

export function DashboardPage() {
  const { profile, session } = useAuth();
  const { items, loading: candidatesLoading, error: candidatesError, reload } = useCandidates(1, 5);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [evaluationRoles, setEvaluationRoles] = useState<Record<string, string | null>>({});
  const [evaluationRolesLoading, setEvaluationRolesLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setDashboardLoading(true);
      setDashboardError(false);
      setDashboard(null);
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

  useEffect(() => {
    const recentEvaluations = dashboard?.recentEvaluations.slice(0, 5) ?? [];
    if (!session?.access_token || recentEvaluations.length === 0) {
      setEvaluationRoles({});
      setEvaluationRolesLoading(false);
      return;
    }
    const accessToken = session.access_token;

    const controller = new AbortController();
    let active = true;
    setEvaluationRoles({});
    setEvaluationRolesLoading(true);

    async function loadRoles() {
      const entries = await Promise.all(recentEvaluations.map(async (item): Promise<[string, string | null]> => {
        try {
          const persisted = persistedEvaluationReadSchema.parse(await apiRequest<unknown>(`/evaluations/${item.id}`, { signal: controller.signal }, accessToken));
          if (persisted.id !== item.id || persisted.candidateId !== item.candidateId) return [item.id, null];
          return [item.id, dashboardRoleLabel(persisted.targetRole)];
        } catch {
          return [item.id, null];
        }
      }));
      if (active) {
        setEvaluationRoles(Object.fromEntries(entries));
        setEvaluationRolesLoading(false);
      }
    }

    void loadRoles();
    return () => { active = false; controller.abort(); };
  }, [dashboard, session?.access_token]);

  const loading = dashboardLoading;
  const error = dashboardError;
  const firstName = profile?.display_name?.split(/\s+/)[0];
  const displayDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date());
  const recentScoreSummary = recentScoredEvaluationAverage(dashboard?.recentEvaluations ?? []);
  const recentAverageProgress = recentScoreSummary.average;
  const recentAverageProgressBar: { value: number; max: number; label: string } | undefined = typeof recentAverageProgress === 'number'
    ? { value: recentAverageProgress, max: 100, label: 'Recent scored evaluation average out of 100' }
    : undefined;
  const recentScoreTrend = dashboard?.recentEvaluations.flatMap((item) => item.score === undefined ? [] : [item.score]) ?? [];

  if (loading || candidatesLoading) return <div className="dashboard-page"><WorkspaceSkeleton variant="dashboard"/></div>;

  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div><div className="eyebrow"><span className="eyebrow-line" />{displayDate.toUpperCase()}</div><h1>{firstName ? `Welcome, ${firstName}` : 'Recruiter overview'}</h1><p className="page-subtitle">A clear view of your candidates and evaluation workload.</p></div>
      <Link className="primary-button link-button" to="/candidates/new"><span aria-hidden="true">＋</span> Add candidate</Link>
    </section>

    {!loading && dashboard && !error && <section className="workspace-kpi-grid" aria-label="Home metrics">
      <KpiCard icon="♙" label="Total candidates" value={dashboard.candidateCount} detail="Recruiter home"/>
      <KpiCard icon="▤" label="Evaluations" value={dashboard.evaluationCount} detail="All saved evaluation runs"/>
      <KpiCard icon="✓" label="Completed" value={dashboard.statusCounts.completed ?? 0} detail="Completed evaluation runs" progress={dashboard.evaluationCount > 0 ? { value: dashboard.statusCounts.completed ?? 0, max: dashboard.evaluationCount, label: 'Completed evaluations out of all saved evaluations' } : undefined}/>
      <KpiCard icon="◉" label="Recent average" value={recentAverageProgress} decimals={1} suffix=" / 100" detail={recentScoreSummary.count ? `Across ${recentScoreSummary.count} scored recent evaluations` : 'No scored evaluations yet'} progress={recentAverageProgressBar} trend={recentScoreTrend}/>
    </section>}

    <section className="dashboard-panel" aria-labelledby="recent-evaluations-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">HOME ACTIVITY</span><h2 id="recent-evaluations-heading">Recent evaluations</h2></div><Link className="dashboard-text-link" to="/evaluations">Run evaluation <span aria-hidden="true">→</span></Link></div>
      {loading ? <p className="dashboard-state" role="status">Loading evaluation activity…</p> : error ? <div className="dashboard-state" role="alert"><p>Evaluation activity could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard?.recentEvaluations.length ? <div className="dashboard-evaluation-list">
        {dashboard.recentEvaluations.slice(0, 5).map((item) => <article className="dashboard-evaluation-row" key={item.id}>
          <Link className="dashboard-candidate-link" to={`/candidates/${item.candidateId}`}><span className="dashboard-avatar" aria-hidden="true">{item.candidateName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{item.candidateName}</strong></span></Link>
          <span className="dashboard-role">{evaluationRoles[item.id] ?? (evaluationRolesLoading ? 'Loading role…' : 'Role unavailable')}</span>
          <span className={`dashboard-status status-${item.status}`}><i aria-hidden="true" />{dashboardEvaluationStatusLabel(item.status)}</span>
          <span className="dashboard-score">{item.score === undefined ? <span className="dashboard-no-score">{dashboardScoreAvailabilityLabel(item.status)}</span> : <><strong>{item.score}</strong><small>/ 100</small></>}</span>
          <time dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</time>
          <Link className="dashboard-open-link" to={`/evaluations/${item.id}`} aria-label={`View ${item.candidateName} ${evaluationRoles[item.id] ?? 'evaluation'} report`}>View report <span aria-hidden="true">↗</span></Link>
        </article>)}
      </div> : <div className="dashboard-state"><h3>No evaluations yet</h3><p>Run an evaluation to see its saved status and score here.</p><Link className="dashboard-secondary-button" to="/evaluations">Start an evaluation</Link></div>}
    </section>

    <section className="dashboard-panel" aria-labelledby="recent-candidates-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">CANDIDATE HOME</span><h2 id="recent-candidates-heading">Recently added candidates</h2></div><Link className="dashboard-text-link" to="/dashboard/candidates">Manage candidates <span aria-hidden="true">→</span></Link></div>
      {candidatesLoading ? <p className="dashboard-state" role="status">Loading candidates…</p> : candidatesError ? <div className="dashboard-state" role="alert"><p>{candidatesError}</p><button className="dashboard-secondary-button" type="button" onClick={reload}>Try again</button></div> : items.length ? <div className="dashboard-candidate-list">{items.map((candidate) => {
        const linked = [
          candidate.githubUsername ? { platform: 'github' as const, name: 'GitHub' } : null,
          candidate.leetcodeUsername ? { platform: 'leetcode' as const, name: 'LeetCode' } : null,
        ].filter((platform): platform is NonNullable<typeof platform> => Boolean(platform));
        return <Link className="dashboard-candidate-row" to={`/candidates/${candidate.id}`} key={candidate.id}><span className="dashboard-avatar" aria-hidden="true">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span className="dashboard-candidate-name"><strong>{candidate.name}</strong></span><span className="dashboard-platforms">{linked.length ? linked.map(({ platform, name }) => <span className="platform-badge" key={name}><PlatformLogo platform={platform}/>{name}</span>) : <small>No profiles linked</small>}</span><span aria-hidden="true" className="dashboard-row-arrow">↗</span></Link>;
      })}</div> : <div className="dashboard-state"><h3>No candidates yet</h3><p>Add your first candidate profile to begin.</p><Link className="dashboard-secondary-button" to="/candidates/new">Add candidate</Link></div>}
    </section>

    <section className="dashboard-panel dashboard-proposal-panel" aria-labelledby="proposal-indexes-title">
      <details>
        <summary><span><span className="dashboard-kicker">DRAFT EVIDENCE · SEPARATE FROM SCORING</span><strong id="proposal-indexes-title" className="dashboard-platform-title"><span className="platform-heading"><PlatformLogo platform="github"/>GitHub</span><span>+</span><span className="platform-heading"><PlatformLogo platform="leetcode"/>LeetCode</span><span>evidence indexes</span></strong><small>Draft indexes only · not active evaluation scores or rankings</small></span><span className="dashboard-disclosure" aria-hidden="true">＋</span></summary>
        {loading ? <p className="dashboard-state" role="status">Loading saved proposal indexes…</p> : error ? <div className="dashboard-state" role="alert"><p>Proposal indexes could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard && <ActiveDashboardReports evaluations={dashboard.recentEvaluations.slice(0, 3)}/>}
      </details>
    </section>
  </div>;
}
