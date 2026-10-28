import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardResponseSchema, persistedEvaluationReadSchema, type Candidate, type DashboardResponse } from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { useCandidates } from '../candidates/useCandidates';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { KpiCard } from '../../components/metrics/KpiCards';
import { WorkspaceIcon } from '../../components/icons/WorkspaceIcon';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { ActiveDashboardReports } from '../insights/ProposedDashboardReports';
import { dashboardEvaluationReportPath, dashboardEvaluationStatusLabel, dashboardRoleLabel, dashboardScoreAvailabilityLabel, recentScoredEvaluationAverage } from './dashboard-presentation';
import { searchDashboardCandidates, type CandidateEvaluationFilter } from './dashboard-candidate-search';
import { parseCandidateListApiResponse } from '../candidates/candidate-response-validation';

export function DashboardWelcome({ firstName }: { firstName?: string }) {
  return <section className="dashboard-hero">
    <div><h1>{firstName ? `Welcome, ${firstName}` : 'Recruiter overview'}</h1><p className="page-subtitle">A clear view of your candidates and evaluation workload.</p></div>
    <Link className="primary-button link-button" to="/candidates/new"><span aria-hidden="true">＋</span> Add candidate</Link>
  </section>;
}

export function DashboardEvaluationRow({ item, roleLabel, reportRoleLabel }: { item: DashboardResponse['recentEvaluations'][number]; roleLabel: string; reportRoleLabel: string }) {
  return <article className="dashboard-evaluation-row">
    <Link className="dashboard-candidate-link" to={`/candidates/${item.candidateId}`}><span className="dashboard-avatar" aria-hidden="true">{item.candidateName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{item.candidateName}</strong></span></Link>
    <span className="dashboard-role">{roleLabel}</span>
    <span className={`dashboard-status status-${item.status}`}><i aria-hidden="true" />{dashboardEvaluationStatusLabel(item.status)}</span>
    <span className="dashboard-score">{item.score === undefined ? <span className="dashboard-no-score">{dashboardScoreAvailabilityLabel(item.status)}</span> : <><strong>{item.score}</strong><small>/ 100</small></>}</span>
    <Link className="dashboard-open-link" to={dashboardEvaluationReportPath(item.id)} aria-label={`View ${item.candidateName} ${reportRoleLabel} report`}>View report <span aria-hidden="true">↗</span></Link>
  </article>;
}

export function DashboardPage() {
  const { profile, session } = useAuth();
  const { items, total: candidateTotal, loading: candidatesLoading, error: candidatesError, reload } = useCandidates(1, 100);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateEvaluationFilter, setCandidateEvaluationFilter] = useState<CandidateEvaluationFilter>('all');
  const [additionalSearchCandidates, setAdditionalSearchCandidates] = useState<Candidate[]>([]);
  const [candidatePagesLoading, setCandidatePagesLoading] = useState(false);
  const [candidatePagesLoaded, setCandidatePagesLoaded] = useState(false);
  const [candidatePagesError, setCandidatePagesError] = useState(false);
  const searchActive = candidateQuery.trim().length > 0 || candidateEvaluationFilter !== 'all';
  const accessToken = session?.access_token;
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [evaluationRoles, setEvaluationRoles] = useState<Record<string, string | null>>({});
  const [evaluationRolesLoading, setEvaluationRolesLoading] = useState(false);

  useEffect(() => {
    setAdditionalSearchCandidates([]);
    setCandidatePagesLoaded(false);
    setCandidatePagesError(false);
    if (!searchActive) return;
    if (candidatesLoading || candidatesError || !accessToken || candidateTotal <= items.length) return;
    const controller = new AbortController();
    let active = true;
    setCandidatePagesLoading(true);
    async function loadRemainingCandidatePages() {
      const remaining: Candidate[] = [];
      try {
        const pageCount = Math.ceil(candidateTotal / 100);
        for (let page = 2; page <= pageCount; page += 1) {
          const response = await apiRequest<unknown>(`/candidates?page=${page}&pageSize=100`, { signal: controller.signal }, accessToken);
          const parsed = parseCandidateListApiResponse(response);
          if (!parsed) throw new Error('Candidate data could not be verified.');
          remaining.push(...parsed.items);
        }
        if (active) { setAdditionalSearchCandidates(remaining); setCandidatePagesLoaded(true); }
      } catch {
        if (active && !controller.signal.aborted) setCandidatePagesError(true);
      } finally {
        if (active) setCandidatePagesLoading(false);
      }
    }
    void loadRemainingCandidatePages();
    return () => { active = false; controller.abort(); };
  }, [searchActive, candidateTotal, items, candidatesLoading, candidatesError, accessToken]);

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
  const recentScoreSummary = recentScoredEvaluationAverage(dashboard?.recentEvaluations ?? []);
  const recentAverageProgress = recentScoreSummary.average;
  const recentAverageProgressBar: { value: number; max: number; label: string } | undefined = typeof recentAverageProgress === 'number'
    ? { value: recentAverageProgress, max: 100, label: 'Recent scored evaluation average out of 100' }
    : undefined;
  const recentScoreTrend = dashboard?.recentEvaluations.flatMap((item) => item.score === undefined ? [] : [item.score]) ?? [];
  const searchCandidates = searchActive ? [...items, ...additionalSearchCandidates] : items;
  const effectiveEvaluationFilter = dashboardError ? 'all' : candidateEvaluationFilter;
  const searchedCandidates = searchDashboardCandidates(searchCandidates, candidateQuery, effectiveEvaluationFilter, new Set(dashboard?.evaluatedCandidateIds ?? []));
  const candidateSearchIncomplete = searchActive && candidateTotal > items.length && !candidatePagesLoaded && !candidatePagesError;

  if (loading || candidatesLoading) return <div className="dashboard-page"><WorkspaceSkeleton variant="dashboard"/></div>;

  return <div className="dashboard-page">
    <DashboardWelcome firstName={firstName}/>

    <section className="dashboard-candidate-search" aria-label="Search candidates">
      <label className="dashboard-candidate-search-input"><span className="sr-only">Search candidates by name, email or skills</span><svg aria-hidden="true" viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg><input type="search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Search candidates by name, email or skills..." /></label>
      <label className="dashboard-candidate-search-filter"><span className="sr-only">Filter candidates by evaluation status</span><select value={candidateEvaluationFilter} disabled={dashboardLoading || dashboardError} onChange={(event) => setCandidateEvaluationFilter(event.target.value as CandidateEvaluationFilter)}><option value="all">All candidates</option><option value="evaluated">Evaluated</option><option value="not_evaluated">Not evaluated</option></select></label>
      {items.length > 0 && <span className="dashboard-candidate-search-count" aria-live="polite">{searchActive ? `${searchedCandidates.length} of ${candidateTotal} candidates` : `${candidateTotal} candidates`}</span>}
      {candidatesError && !candidatesLoading && <span className="dashboard-candidate-search-note" role="status">Candidate search is unavailable.</span>}
      {dashboardError && candidateEvaluationFilter !== 'all' && <span className="dashboard-candidate-search-note" role="status">Evaluation status is unavailable; showing text matches only.</span>}
      {!candidatesLoading && !candidatesError && items.length === 0 && <span className="dashboard-candidate-search-note">No candidates to search yet.</span>}
      {candidateSearchIncomplete && <span className="dashboard-candidate-search-note" role="status">{candidatePagesLoading ? 'Searching all candidates…' : `Preparing search across ${candidateTotal} candidates…`}</span>}
      {searchActive && candidatePagesError && <span className="dashboard-candidate-search-note" role="alert">Some candidate records could not be loaded. Try again.</span>}
      {searchActive && !candidateSearchIncomplete && !candidatePagesError && !candidatesLoading && !candidatesError && items.length > 0 && <div className="dashboard-candidate-search-results" role="region" aria-label="Candidate search results">{searchedCandidates.length ? searchedCandidates.map((candidate) => <Link key={candidate.id} className="dashboard-candidate-search-result" to={`/candidates/${candidate.id}`}><span className="dashboard-avatar" aria-hidden="true">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span><strong>{candidate.name}</strong><small>{candidate.email ?? candidate.githubUsername ?? candidate.leetcodeUsername ?? 'Candidate profile'}</small></span>{dashboard && <span className={`dashboard-search-status ${dashboard.evaluatedCandidateIds.includes(candidate.id) ? 'is-evaluated' : ''}`}>{dashboard.evaluatedCandidateIds.includes(candidate.id) ? 'Evaluated' : 'Not evaluated'}</span>}</Link>) : <p>No candidates match your search and filters.</p>}</div>}
    </section>

    {!loading && dashboard && !error && <section className="workspace-kpi-grid" aria-label="Home metrics">
      <KpiCard icon={<WorkspaceIcon name="candidates" size={17}/>} label="Total candidates" value={dashboard.candidateCount} detail="Recruiter home"/>
      <KpiCard icon={<WorkspaceIcon name="evaluations" size={17}/>} label="Evaluations" value={dashboard.evaluationCount} detail="All saved evaluation runs"/>
      <KpiCard icon={<WorkspaceIcon name="completed" size={17}/>} label="Completed" value={dashboard.statusCounts.completed ?? 0} detail="Completed evaluation runs" progress={dashboard.evaluationCount > 0 ? { value: dashboard.statusCounts.completed ?? 0, max: dashboard.evaluationCount, label: 'Completed evaluations out of all saved evaluations' } : undefined}/>
      <KpiCard icon={<WorkspaceIcon name="average" size={17}/>} label="Recent average" value={recentAverageProgress} decimals={1} suffix=" / 100" detail={recentScoreSummary.count ? `Across ${recentScoreSummary.count} scored recent evaluations` : 'No scored evaluations yet'} progress={recentAverageProgressBar} trend={recentScoreTrend}/>
    </section>}

    <section className="dashboard-panel" aria-labelledby="recent-evaluations-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">HOME ACTIVITY</span><h2 id="recent-evaluations-heading">Recent evaluations</h2></div><Link className="dashboard-text-link" to="/evaluations">Run evaluation <span aria-hidden="true">→</span></Link></div>
      {loading ? <p className="dashboard-state" role="status">Loading evaluation activity…</p> : error ? <div className="dashboard-state" role="alert"><p>Evaluation activity could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard?.recentEvaluations.length ? <div className="dashboard-evaluation-list">
        {dashboard.recentEvaluations.slice(0, 5).map((item) => <DashboardEvaluationRow key={item.id} item={item} roleLabel={evaluationRoles[item.id] ?? (evaluationRolesLoading ? 'Loading role…' : 'Role unavailable')} reportRoleLabel={evaluationRoles[item.id] ?? 'evaluation'}/>)}
      </div> : <div className="dashboard-state"><h3>No evaluations yet</h3><p>Run an evaluation to see its saved status and score here.</p><Link className="dashboard-secondary-button" to="/evaluations">Start an evaluation</Link></div>}
    </section>

    <section className="dashboard-panel" aria-labelledby="recent-candidates-heading">
      <div className="dashboard-section-heading"><div><span className="dashboard-kicker">CANDIDATE HOME</span><h2 id="recent-candidates-heading">Recently added candidates</h2></div><Link className="dashboard-text-link" to="/dashboard/candidates">Manage candidates <span aria-hidden="true">→</span></Link></div>
      {candidatesLoading ? <p className="dashboard-state" role="status">Loading candidates…</p> : candidatesError ? <div className="dashboard-state" role="alert"><p>{candidatesError}</p><button className="dashboard-secondary-button" type="button" onClick={reload}>Try again</button></div> : items.length ? <div className="dashboard-candidate-list">{items.slice(0, 5).map((candidate) => {
        const linked = [
          candidate.githubUsername ? { platform: 'github' as const, name: 'GitHub' } : null,
          candidate.leetcodeUsername ? { platform: 'leetcode' as const, name: 'LeetCode' } : null,
        ].filter((platform): platform is NonNullable<typeof platform> => Boolean(platform));
        return <Link className="dashboard-candidate-row" to={`/candidates/${candidate.id}`} key={candidate.id}><span className="dashboard-avatar" aria-hidden="true">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</span><span className="dashboard-candidate-name"><strong>{candidate.name}</strong></span><span className="dashboard-platforms">{linked.length ? linked.map(({ platform, name }) => <span className="platform-badge" key={name}><PlatformLogo platform={platform}/>{name}</span>) : <small>No profiles linked</small>}</span><span aria-hidden="true" className="dashboard-row-arrow">↗</span></Link>;
      })}</div> : <div className="dashboard-state"><h3>No candidates yet</h3><p>Add your first candidate profile to begin.</p><Link className="dashboard-secondary-button" to="/candidates/new">Add candidate</Link></div>}
    </section>

    <section className="dashboard-panel dashboard-proposal-panel" aria-labelledby="proposal-indexes-title">
      <details>
        <summary><span><strong id="proposal-indexes-title" className="dashboard-platform-title"><span className="platform-heading"><PlatformLogo platform="github"/>GitHub</span><span>+</span><span className="platform-heading"><PlatformLogo platform="leetcode"/>LeetCode</span><span>evidence indexes</span></strong></span><span className="dashboard-disclosure" aria-hidden="true">＋</span></summary>
        {loading ? <p className="dashboard-state" role="status">Loading saved proposal indexes…</p> : error ? <div className="dashboard-state" role="alert"><p>Proposal indexes could not be loaded.</p><button className="dashboard-secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : dashboard && <ActiveDashboardReports evaluations={dashboard.recentEvaluations.slice(0, 3)}/>}
      </details>
    </section>
  </div>;
}
