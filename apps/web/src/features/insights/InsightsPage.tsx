import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  candidateComparisonResponseSchema,
  dashboardResponseSchema,
  evaluationRolesResponseSchema,
  rankingResponseSchema,
  type CandidateComparisonResponse,
  type DashboardResponse,
  type EvaluationRole,
  type RankingResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { comparableRecentEvaluations } from './insights-presentation';
import { ActiveDashboardReports } from './ProposedDashboardReports';
import './insights-page.css';

function messageFor(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) return 'Your session expired. Sign in again to view recruiter insights.';
  if (error instanceof ApiRequestError && error.status === 403) return 'Recruiter access is not approved for this workspace.';
  if (error instanceof Error && error.name === 'ApiNetworkError') return error.message;
  return 'Insights could not be verified. Try again in a moment.';
}

function clearExpiredSession(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 401) void supabase?.auth.signOut({ scope: 'local' });
}

export function InsightsPage() {
  const { session } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const [roleId, setRoleId] = useState<EvaluationRole['id'] | ''>('');
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<CandidateComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState('');
  const [rankingError, setRankingError] = useState('');
  const [comparisonError, setComparisonError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!session?.access_token) { setError('Your secure session is unavailable. Sign in again.'); setLoading(false); return; }
      setLoading(true); setError(''); setRankingError(''); setDashboard(null); setRanking(null); setComparison(null);
      try {
        const [dashboardResponse, rolesResponse] = await Promise.all([
          apiRequest<unknown>('/dashboard', undefined, session.access_token),
          apiRequest<unknown>('/evaluations/roles', undefined, session.access_token),
        ]);
        const parsedDashboard = dashboardResponseSchema.parse(dashboardResponse);
        const parsedRoles = evaluationRolesResponseSchema.parse(rolesResponse).roles;
        if (!active) return;
        setDashboard(parsedDashboard);
        setRoles(parsedRoles);
        setRoleId((current) => parsedRoles.some((role) => role.id === current) ? current : parsedRoles[0]?.id ?? '');
        setLoading(false);
      } catch (cause) {
        if (!active) return;
        clearExpiredSession(cause);
        setError(messageFor(cause)); setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [session?.access_token, attempt]);

  useEffect(() => {
    let active = true;
    async function loadRanking() {
      if (!session?.access_token || !roleId || loading) return;
      setRankingLoading(true); setRankingError(''); setRanking(null);
      try {
        const response = await apiRequest<unknown>(`/rankings?roleId=${encodeURIComponent(roleId)}&page=1&pageSize=20`, undefined, session.access_token);
        const parsed = rankingResponseSchema.parse(response);
        if (active) setRanking(parsed);
      } catch (cause) { if (active) { clearExpiredSession(cause); setRankingError(messageFor(cause)); } }
      finally { if (active) setRankingLoading(false); }
    }
    void loadRanking();
    return () => { active = false; };
  }, [session?.access_token, roleId, loading, attempt]);

  const evaluations = comparableRecentEvaluations(dashboard);
  const canCompare = selected.length >= 2 && !comparing;

  function toggleEvaluation(id: string) {
    setComparison(null); setComparisonError('');
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  }

  async function compareSelected() {
    if (!session?.access_token || selected.length < 2 || comparing) return;
    const chosen = selected.map((id) => evaluations.find((evaluation) => evaluation.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (chosen.length !== selected.length) { setComparisonError('Refresh the report and select evaluations again.'); return; }
    setComparing(true); setComparisonError(''); setComparison(null);
    try {
      const response = await apiRequest<unknown>('/comparisons', { method: 'POST', body: JSON.stringify({ candidateIds: chosen.map(({ candidateId }) => candidateId), evaluationIds: chosen.map(({ id }) => id) }) }, session.access_token);
      const parsed = candidateComparisonResponseSchema.parse(response);
      if (parsed.items.length !== chosen.length || parsed.items.some((item) => !selected.includes(item.evaluationId))) throw new Error('Comparison did not match the selected evaluations.');
      setComparison(parsed);
    } catch (cause) {
      clearExpiredSession(cause);
      setComparisonError(cause instanceof ApiRequestError && (cause.status === 400 || cause.status === 409)
        ? 'These evaluations cannot be compared together. Select a different set with the same supported role and scoring configuration.'
        : messageFor(cause));
    }
    finally { setComparing(false); }
  }

  return <div className="insights-page">
    <section className="insights-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> RECRUITER WORKSPACE</span><h1>Insights &amp; rankings</h1><p className="page-subtitle">Workspace activity and comparable evaluation results.</p></div><Link className="secondary-button" to="/evaluations">Run an evaluation</Link></section>
    {loading ? <section className="insights-state" role="status">Loading recruiter insights…</section> : error ? <section className="insights-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section> : dashboard && <>
      <section className="insights-summary" aria-label="Workspace activity">
        <article><span>Candidates</span><strong>{dashboard.candidateCount}</strong><Link to="/dashboard/candidates">View workspace →</Link></article>
        <article><span>Evaluations</span><strong>{dashboard.evaluationCount}</strong><small>{dashboard.statusCounts.completed ?? 0} completed</small></article>
        <article><span>Need more evidence</span><strong>{dashboard.statusCounts.insufficient_evidence ?? 0}</strong><small>Scores are not inferred when evidence is missing.</small></article>
      </section>
      <section className="insights-panel" aria-labelledby="proposed-dashboard-title">
        <div className="insights-panel-heading"><div><h2 id="proposed-dashboard-title">Proposed rubric report values</h2><p>Recent saved evidence snapshots with draft category indexes. These values never feed active rankings.</p></div></div>
        <ActiveDashboardReports evaluations={dashboard.recentEvaluations}/>
      </section>
      <section className="insights-panel" aria-labelledby="ranking-title">
        <div className="insights-panel-heading"><div><h2 id="ranking-title">Candidate rankings</h2><p>Only compatible, complete evaluations receive a rank.</p></div><label htmlFor="ranking-role">Role<select id="ranking-role" value={roleId} onChange={(event) => setRoleId(event.target.value as EvaluationRole['id'])}>{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select></label></div>
        {rankingLoading ? <p className="insights-state" role="status">Loading rankings…</p> : rankingError ? <div className="insights-state" role="alert"><p>{rankingError}</p><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : ranking?.items.length ? <div className="insights-table-wrap"><table className="insights-table"><thead><tr><th>Rank</th><th>Candidate</th><th>Score</th><th>Evaluated</th></tr></thead><tbody>{ranking.items.map((item) => <tr key={item.evaluationId}><td>#{item.rank}</td><td><Link to={`/candidates/${item.candidateId}`}>{dashboard.recentEvaluations.find((row) => row.candidateId === item.candidateId)?.candidateName ?? 'View candidate'}</Link></td><td><strong>{item.score}</strong> / 100</td><td><time dateTime={item.evaluatedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.evaluatedAt))}</time></td></tr>)}</tbody></table><p className="insights-footnote">{ranking.total} ranked candidate{ranking.total === 1 ? '' : 's'} · {ranking.excluded.incomplete} incomplete evaluation{ranking.excluded.incomplete === 1 ? '' : 's'} excluded · scoring version {ranking.scoringVersion}</p></div> : <div className="insights-state"><h3>No comparable rankings yet</h3><p>Complete an evaluation with sufficient evidence for this role to appear here.</p><Link className="primary-button link-button" to="/evaluations">Start an evaluation</Link></div>}
      </section>
      <section className="insights-panel" aria-labelledby="comparison-title">
        <div className="insights-panel-heading"><div><h2 id="comparison-title">Compare evaluations</h2><p>Select 2–5 recent evaluation runs. The API verifies they share a compatible role and scoring setup.</p></div><button className="primary-button" type="button" disabled={!canCompare} onClick={() => void compareSelected()}>{comparing ? 'Comparing…' : `Compare selected (${selected.length})`}</button></div>
        {evaluations.length < 2 ? <div className="insights-state"><p>At least two recent completed evaluations are needed for comparison.</p><Link className="secondary-button" to="/evaluations">Run evaluations</Link></div> : <div className="evaluation-choice-list">{evaluations.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={comparing || (!selected.includes(item.id) && selected.length >= 5)} onChange={() => toggleEvaluation(item.id)}/><span><strong>{item.candidateName}</strong><small>{item.status === 'completed' ? `Score ${item.score ?? 'unavailable'}` : 'Insufficient evidence'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</small></span></label>)}</div>}
        {comparisonError && <p className="insights-error" role="alert">{comparisonError}</p>}
        {comparison && <div className="comparison-results" role="status"><h3>{roles.find(({ id }) => id === comparison.roleId)?.displayName ?? comparison.roleId} comparison</h3><p>Scoring version {comparison.scoringVersion}. This is decision support, not an automatic hiring decision.</p><div className="comparison-cards">{comparison.items.map((item) => { const record = evaluations.find(({ id }) => id === item.evaluationId); return <article key={item.evaluationId}><span>{record?.candidateName ?? 'Candidate'}</span><strong>{item.result.overallScore ?? '—'}<small>{item.result.overallScore === undefined ? 'insufficient evidence' : '/ 100'}</small></strong><small>{item.result.evaluationStatus.replaceAll('_', ' ')}</small></article>; })}</div></div>}
      </section>
      <p className="insights-disclaimer">Ranks reflect the latest compatible evaluation per candidate for the selected role. Missing, incomplete, or incompatible evidence is excluded, never assigned a zero score. These tools support recruiter judgment and do not make hiring decisions.</p>
    </>}
  </div>;
}
