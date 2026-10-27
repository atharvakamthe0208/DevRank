import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  candidateComparisonResponseSchema,
  dashboardResponseSchema,
  evaluationRolesResponseSchema,
  candidateListResponseSchema,
  unifiedAssessmentRankingResponseSchema,
  type CandidateComparisonResponse,
  type DashboardResponse,
  type EvaluationRole,
  type UnifiedAssessmentRankingResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { KpiCard } from '../../components/metrics/KpiCards';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { comparableRecentEvaluations } from './insights-presentation';
import { recentScoredEvaluationAverage } from '../dashboard/dashboard-presentation';
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

function unifiedComponentLabel(component: UnifiedAssessmentRankingResponse['items'][number]['assessment']['components']['resume']) {
  if (component.status === 'policy_only') return 'Not observed';
  if (component.score === null) return 'Not found';
  if (component.status === 'validated') return `${component.score}/100`;
  if (component.status === 'preliminary') return `${component.score} preliminary · excluded`;
  return 'Unavailable';
}

export function UnifiedRankingTable({ ranking, roleLabel }: { ranking: UnifiedAssessmentRankingResponse; roleLabel: string }) {
  return <div className="insights-table-wrap"><table className="insights-table unified-ranking-table"><caption className="visually-hidden">Unified final candidate report for {roleLabel}, sorted by validated final score descending</caption><thead><tr><th scope="col">Rank</th><th scope="col">Candidate</th><th scope="col">GitHub</th><th scope="col">GitHub Score</th><th scope="col">LeetCode</th><th scope="col">LeetCode Score</th><th scope="col">Resume Score</th><th scope="col">Final Score /100</th><th scope="col">Status</th><th scope="col">Report</th></tr></thead><tbody>{ranking.items.map((item) => { const assessment = item.assessment; const github = assessment.components.github; const leetcode = assessment.components.leetcode; const resume = assessment.components.resume; const resumeScore = item.resumeScore === undefined ? unifiedComponentLabel(resume) : item.resumeScore === null ? 'Not found' : `${item.resumeScore}/100`; return <tr key={assessment.id}><td>{item.rank === null ? '—' : `#${item.rank}`}</td><td><Link to={`/candidates/${assessment.candidateId}`}>{item.candidateName}</Link></td><td>{item.githubUsername ? `@${item.githubUsername}` : 'Not found'}</td><td><strong>{unifiedComponentLabel(github)}</strong></td><td>{item.leetcodeUsername ? `@${item.leetcodeUsername}` : 'Not found'}</td><td><strong>{unifiedComponentLabel(leetcode)}</strong></td><td><strong>{resumeScore}</strong></td><td><strong>{assessment.overallScore === null ? 'Withheld' : `${assessment.overallScore}/100`}</strong></td><td>{assessment.status === 'completed' ? 'Completed' : `Incomplete · missing ${assessment.missingComponents.join(', ')}`}</td><td><Link to={`/candidates/${assessment.candidateId}/report`}>View report</Link></td></tr>; })}</tbody></table><p className="insights-footnote">{ranking.ranked} complete and ranked · {ranking.total - ranking.ranked} incomplete and unranked. Scores shown for components are validated unless explicitly marked preliminary. Preliminary, failed, policy-only, and unavailable values do not contribute to a final score.</p></div>;
}

export function InsightsPage() {
  const { session } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const [roleId, setRoleId] = useState<EvaluationRole['id'] | ''>('');
  const [unifiedRanking, setUnifiedRanking] = useState<UnifiedAssessmentRankingResponse | null>(null);
  const [assessmentProgress, setAssessmentProgress] = useState<{ current: number; total: number; candidate: string; completed: number; failed: number } | null>(null);
  const [assessmentError, setAssessmentError] = useState('');
  const [assessingAll, setAssessingAll] = useState(false);
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
      setLoading(true); setError(''); setRankingError(''); setDashboard(null); setComparison(null);
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
      setRankingLoading(true); setRankingError(''); setUnifiedRanking(null);
      try {
        const unifiedResponse = await apiRequest<unknown>(`/rankings/unified?roleId=${encodeURIComponent(roleId)}`, { cache: 'no-store' }, session.access_token);
        if (active) setUnifiedRanking(unifiedAssessmentRankingResponseSchema.parse(unifiedResponse));
      } catch (cause) { if (active) { clearExpiredSession(cause); setRankingError(messageFor(cause)); } }
      finally { if (active) setRankingLoading(false); }
    }
    void loadRanking();
    return () => { active = false; };
  }, [session?.access_token, roleId, loading, attempt]);

  const evaluations = comparableRecentEvaluations(dashboard);
  const recentScoreSummary = recentScoredEvaluationAverage(dashboard?.recentEvaluations ?? []);
  const recentAverageProgress = recentScoreSummary.average;
  const recentAverageProgressBar: { value: number; max: number; label: string } | undefined = typeof recentAverageProgress === 'number'
    ? { value: recentAverageProgress, max: 100, label: 'Recent scored evaluation average out of 100' }
    : undefined;
  const recentScoreTrend = dashboard?.recentEvaluations.flatMap((item) => item.score === undefined ? [] : [item.score]) ?? [];
  const canCompare = selected.length >= 2 && !comparing;

  function toggleEvaluation(id: string) {
    setComparison(null); setComparisonError('');
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 5 ? [...current, id] : current);
  }

  function changeRole(nextRoleId: EvaluationRole['id']) {
    setRoleId(nextRoleId);
    setSelected([]);
    setComparison(null);
    setComparisonError('');
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

  async function assessAllCandidates() {
    if (!session?.access_token || !roleId || assessingAll) return;
    setAssessingAll(true); setAssessmentError(''); setAssessmentProgress(null);
    let completed = 0; let failed = 0; let total = 0; let current = 0;
    try {
      const firstPage = candidateListResponseSchema.parse(await apiRequest<unknown>('/candidates?page=1&pageSize=100', undefined, session.access_token));
      const candidates = [...firstPage.items];
      for (let page = 2; candidates.length < firstPage.total; page += 1) {
        const next = candidateListResponseSchema.parse(await apiRequest<unknown>(`/candidates?page=${page}&pageSize=100`, undefined, session.access_token));
        candidates.push(...next.items);
        if (!next.items.length) break;
      }
      total = candidates.length;
      setAssessmentProgress({ current: 0, total, candidate: '', completed, failed });
      for (const candidate of candidates) {
        current += 1;
        setAssessmentProgress({ current, total, candidate: candidate.name, completed, failed });
        try {
          await apiRequest(`/candidates/${encodeURIComponent(candidate.id)}/unified-report/assessment`, { method: 'POST', body: JSON.stringify({ roleId, resumeId: null }) }, session.access_token);
          completed += 1;
        } catch { failed += 1; }
        setAssessmentProgress({ current, total, candidate: candidate.name, completed, failed });
      }
      const refreshed = unifiedAssessmentRankingResponseSchema.parse(await apiRequest<unknown>(`/rankings/unified?roleId=${encodeURIComponent(roleId)}`, { cache: 'no-store' }, session.access_token));
      setUnifiedRanking(refreshed);
    } catch (cause) {
      setAssessmentError(messageFor(cause));
    } finally { setAssessingAll(false); }
  }

  return <div className="insights-page">
    <section className="insights-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> RECRUITER HOME</span><h1>Insights &amp; rankings</h1><p className="page-subtitle">Home activity and comparable evaluation results.</p></div><Link className="secondary-button insights-run-evaluation" to="/evaluations">Run an evaluation</Link></section>
    {loading ? <WorkspaceSkeleton variant="insights"/> : error ? <section className="insights-state" role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></section> : dashboard && <>
      <section className="workspace-kpi-grid" aria-label="Home metrics">
        <KpiCard icon="♙" label="Candidates" value={dashboard.candidateCount} detail="Recruiter home"/>
        <KpiCard icon="▤" label="Evaluations" value={dashboard.evaluationCount} detail="All saved evaluation runs"/>
        <KpiCard icon="✓" label="Completed" value={dashboard.statusCounts.completed ?? 0} detail="Completed evaluation runs" progress={dashboard.evaluationCount > 0 ? { value: dashboard.statusCounts.completed ?? 0, max: dashboard.evaluationCount, label: 'Completed evaluations out of all saved evaluations' } : undefined}/>
        <KpiCard icon="◉" label="Recent average" value={recentAverageProgress} decimals={1} suffix=" / 100" detail={recentScoreSummary.count ? `Across ${recentScoreSummary.count} scored recent evaluations` : 'No scored evaluations yet'} progress={recentAverageProgressBar} trend={recentScoreTrend}/>
      </section>
    <section className="insights-panel" aria-labelledby="unified-ranking-title">
        <div className="insights-panel-heading"><div><h2 id="unified-ranking-title">Final candidate ranking</h2><p>{roles.find(({ id }) => id === roleId)?.displayName ?? 'Selected role'} · ordered by validated final score, highest first. Incomplete candidates remain visible without a rank.</p></div><div className="unified-ranking-actions"><label htmlFor="ranking-role">Role<select id="ranking-role" value={roleId} onChange={(event) => changeRole(event.target.value as EvaluationRole['id'])}>{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select></label><button type="button" className="primary-button" disabled={assessingAll || !roles.length} onClick={() => void assessAllCandidates()}>{assessingAll ? 'Assessing candidates…' : 'Assess All Candidates'}</button></div></div>
        {assessmentProgress && <p role="status" aria-live="polite">{assessingAll ? `Assessing ${assessmentProgress.current} of ${assessmentProgress.total} candidates · ${assessmentProgress.candidate}` : `Finished ${assessmentProgress.current} of ${assessmentProgress.total}: ${assessmentProgress.completed} saved, ${assessmentProgress.failed} failed.`}</p>}
        {assessmentError && <p role="alert" className="insights-error">{assessmentError}</p>}
        {rankingLoading ? <WorkspaceSkeleton variant="ranking"/> : rankingError ? <div className="insights-state" role="alert"><p>{rankingError}</p><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div> : unifiedRanking?.items.length ? <UnifiedRankingTable ranking={unifiedRanking} roleLabel={roles.find(({ id }) => id === roleId)?.displayName ?? 'selected role'}/> : <div className="insights-state"><p>No unified assessments saved for this role yet. Use Assess All Candidates or generate one from a candidate report.</p></div>}
      </section>
      <section className="insights-panel" aria-labelledby="comparison-title">
        <div className="insights-panel-heading"><div><h2 id="comparison-title">Compare candidates</h2></div><button className="primary-button" type="button" disabled={!canCompare} onClick={() => void compareSelected()}>{comparing ? 'Comparing…' : `Compare selected (${selected.length})`}</button></div>
        {evaluations.length < 2 ? <div className="insights-state"><p>At least two recent evaluations with supported scoring versions are needed for comparison.</p><Link className="secondary-button" to="/evaluations">Run evaluations</Link></div> : <div className="evaluation-choice-list" aria-label="Recent evaluations available to compare">{evaluations.map((item) => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={comparing || (!selected.includes(item.id) && selected.length >= 5)} onChange={() => toggleEvaluation(item.id)}/><span><strong>{item.candidateName}</strong><small>{item.status === 'completed' ? `Score ${item.score ?? 'unavailable'} / 100` : 'Insufficient evidence · no score'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</small></span></label>)}</div>}
        {comparisonError && <p className="insights-error" role="alert">{comparisonError}</p>}
        {comparison && <div className="comparison-results" role="status"><h3>{roles.find(({ id }) => id === comparison.roleId)?.displayName ?? comparison.roleId} comparison</h3><p>Scoring version {comparison.scoringVersion}. This is decision support, not an automatic hiring decision.</p><div className="comparison-cards">{comparison.items.map((item) => { const record = evaluations.find(({ id }) => id === item.evaluationId); return <article key={item.evaluationId}><span>{record?.candidateName ?? 'Candidate'}</span><strong>{item.result.overallScore ?? '—'}<small>{item.result.overallScore === undefined ? 'insufficient evidence' : '/ 100'}</small></strong><small>{item.result.evaluationStatus.replaceAll('_', ' ')}</small></article>; })}</div></div>}
      </section>
      <details className="insights-panel insights-draft-disclosure">
        <summary><span><strong>Draft evidence indexes</strong></span></summary>
        <div className="insights-draft-content"><ActiveDashboardReports evaluations={dashboard.recentEvaluations}/></div>
      </details>
    </>}
  </div>;
}
