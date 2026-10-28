import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  candidateComparisonResponseSchema,
  dashboardResponseSchema,
  evaluationRolesResponseSchema,
  providerRankingResponseSchema,
  rankingResponseSchema,
  type CandidateComparisonResponse,
  type DashboardResponse,
  type EvaluationRole,
  type ProviderRankingResponse,
  type RankingResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { KpiCard } from '../../components/metrics/KpiCards';
import { WorkspaceIcon } from '../../components/icons/WorkspaceIcon';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { comparableRecentEvaluations } from './insights-presentation';
import { recentScoredEvaluationAverage } from '../dashboard/dashboard-presentation';
import { DraftEvidenceIndexes } from './DraftEvidenceIndexes';
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

export function InsightsRankingTable({ ranking, roleDisplayName }: { ranking: RankingResponse; roleDisplayName: string }) {
  const displayScore = (score: number | null) => score === null ? 'Not available' : `${score}/100`;

  return <div className="insights-table-wrap" role="region" aria-label="Candidate rankings" aria-describedby="insights-ranking-scroll-hint" tabIndex={0}>
    <p className="insights-scroll-hint" id="insights-ranking-scroll-hint">On small screens, scroll horizontally to see all ranking details.</p>
    <table className="insights-table">
      <caption className="visually-hidden">Candidate platform scores and saved evaluation results for {roleDisplayName}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Candidate</th>
          <th scope="col">GitHub</th>
          <th scope="col">GitHub Score</th>
          <th scope="col">LeetCode</th>
          <th scope="col">LeetCode Score</th>
          <th scope="col">Final Score</th>
          <th scope="col">View Report</th>
        </tr>
      </thead>
      <tbody>
        {ranking.candidateRows.map((item) => <tr key={item.candidateId}>
          <td>{item.rank ?? '—'}</td>
          <td><Link aria-label={`Open ${item.candidateName} profile`} to={`/candidates/${item.candidateId}`}>{item.candidateName}</Link></td>
          <td>{item.githubUsername ?? 'Not found'}</td>
          <td>{displayScore(item.githubScore)}</td>
          <td>{item.leetcodeUsername ?? 'Not found'}</td>
          <td>{displayScore(item.leetcodeScore)}</td>
          <td>
            {item.finalScore === null
              ? <><strong>Incomplete</strong>{item.missingEvidence.length > 0 && <small className="insights-missing-evidence">{item.missingEvidence.join(', ')}</small>}</>
              : <strong>{item.finalScore}/100</strong>}
          </td>
          <td><Link className="insights-report-link" to={`/candidates/${item.candidateId}/report?roleId=${encodeURIComponent(ranking.roleId)}`}>View Report</Link></td>
        </tr>)}
      </tbody>
    </table>
    <p className="insights-footnote">{ranking.total} validated platform score{ranking.total === 1 ? '' : 's'} · {ranking.candidateRows.length - ranking.total} incomplete or unavailable · v{ranking.scoringVersion}</p>
  </div>;
}

export function ProviderRankingTable({ ranking, onPageChange }: { ranking: ProviderRankingResponse; onPageChange?: (page: number) => void }) {
  const displayScore = (score: number) => score.toFixed(2);
  const total = ranking.rankedTotal + ranking.incompleteTotal;
  const pageCount = Math.max(1, Math.ceil(total / ranking.pageSize));

  return <div className="insights-table-wrap" role="region" aria-label="GitHub and LeetCode candidate rankings" aria-describedby="provider-ranking-scroll-hint" tabIndex={0}>
    <p className="insights-scroll-hint" id="provider-ranking-scroll-hint">On small screens, scroll horizontally to see all ranking details.</p>
    <table className="insights-table provider-ranking-table">
      <caption className="visually-hidden">GitHub and LeetCode rankings. Resume scores are not included.</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          <th scope="col">Candidate</th>
          <th scope="col">GitHub</th>
          <th scope="col">LeetCode</th>
          <th scope="col">Combined score</th>
          <th scope="col">Status</th>
          <th scope="col">Evaluated</th>
        </tr>
      </thead>
      <tbody>
        {ranking.items.map((item) => <tr key={item.candidateId}>
          <td>{item.rank === undefined ? '—' : `#${item.rank}`}</td>
          <td><Link aria-label={`Open ${item.candidateName} profile`} to={`/candidates/${item.candidateId}`}>{item.candidateName}</Link></td>
          <td>{item.githubScore === undefined ? 'Unavailable' : <><strong>{displayScore(item.githubScore)}</strong> / 100<br/><small>{item.githubCoverage.availableCategories}/5 categories · {item.githubCoverage.status}</small></>}</td>
          <td>{item.leetcodeScore === undefined ? 'Unavailable' : <><strong>{displayScore(item.leetcodeScore)}</strong> / 100</>}</td>
          <td>{item.combinedScore === undefined ? '—' : <><strong>{displayScore(item.combinedScore)}</strong> / 100</>}</td>
          <td>{item.status === 'ranked' ? 'Ranked' : `Incomplete · missing ${item.missingProviders.join(' and ')}`}</td>
          <td><time dateTime={item.evaluatedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.evaluatedAt))}</time></td>
        </tr>)}
      </tbody>
    </table>
    <p className="insights-footnote">{ranking.rankedTotal} ranked · {ranking.incompleteTotal} incomplete · GitHub and LeetCode weighted equally (50% each). Resume scores are excluded.</p>
    {pageCount > 1 && onPageChange && <nav className="provider-ranking-pagination" aria-label="Provider ranking pages">
      <button className="secondary-button" type="button" disabled={ranking.page <= 1} onClick={() => onPageChange(ranking.page - 1)}>Previous</button>
      <span>Page {ranking.page} of {pageCount}</span>
      <button className="secondary-button" type="button" disabled={ranking.page >= pageCount} onClick={() => onPageChange(ranking.page + 1)}>Next</button>
    </nav>}
  </div>;
}

export function InsightsPage() {
  const { session } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const [roleId, setRoleId] = useState<EvaluationRole['id'] | ''>('');
  const [ranking, setRanking] = useState<RankingResponse | null>(null);
  const [providerRanking, setProviderRanking] = useState<ProviderRankingResponse | null>(null);
  const [rankingMode, setRankingMode] = useState<'evaluation' | 'github_leetcode'>('evaluation');
  const [providerPage, setProviderPage] = useState(1);
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
      if (!session?.access_token) {
        setError('Your secure session is unavailable. Sign in again.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      setRankingError('');
      setDashboard(null);
      setRanking(null);
      setProviderRanking(null);
      setComparison(null);

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
        setError(messageFor(cause));
        setLoading(false);
      }
    }

    void load();
    return () => { active = false; };
  }, [session?.access_token, attempt]);

  useEffect(() => {
    let active = true;

    async function loadRanking() {
      if (!session?.access_token || !roleId || loading) return;

      setRankingLoading(true);
      setRankingError('');
      setRanking(null);
      setProviderRanking(null);

      try {
        const endpoint = rankingMode === 'github_leetcode' ? '/rankings/github-leetcode' : '/rankings';
        const page = rankingMode === 'github_leetcode' ? providerPage : 1;
        const response = await apiRequest<unknown>(
          `${endpoint}?roleId=${encodeURIComponent(roleId)}&page=${page}&pageSize=20`,
          undefined,
          session.access_token,
        );

        if (rankingMode === 'github_leetcode') {
          const parsed = providerRankingResponseSchema.parse(response);
          if (active) setProviderRanking(parsed);
        } else {
          const parsed = rankingResponseSchema.parse(response);
          if (active) setRanking(parsed);
        }
      } catch (cause) {
        if (active) {
          clearExpiredSession(cause);
          setRankingError(messageFor(cause));
        }
      } finally {
        if (active) setRankingLoading(false);
      }
    }

    void loadRanking();
    return () => { active = false; };
  }, [session?.access_token, roleId, rankingMode, providerPage, loading, attempt]);

  const evaluations = comparableRecentEvaluations(dashboard);
  const recentScoreSummary = recentScoredEvaluationAverage(dashboard?.recentEvaluations ?? []);
  const recentAverageProgress = recentScoreSummary.average;
  const recentAverageProgressBar: { value: number; max: number; label: string } | undefined =
    typeof recentAverageProgress === 'number'
      ? { value: recentAverageProgress, max: 100, label: 'Recent scored evaluation average out of 100' }
      : undefined;
  const recentScoreTrend = dashboard?.recentEvaluations.flatMap((item) => item.score === undefined ? [] : [item.score]) ?? [];
  const canCompare = selected.length >= 2 && !comparing;

  const hasRankingResults = rankingMode === 'github_leetcode'
    ? Boolean(providerRanking?.items.length)
    : Boolean(ranking?.candidateRows.length);

  function toggleEvaluation(id: string) {
    setComparison(null);
    setComparisonError('');
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 5 ? [...current, id] : current);
  }

  function changeRole(nextRoleId: EvaluationRole['id']) {
    setRoleId(nextRoleId);
    setProviderPage(1);
    setSelected([]);
    setComparison(null);
    setComparisonError('');
  }

  function changeRankingMode(mode: 'evaluation' | 'github_leetcode') {
    setRankingMode(mode);
    setProviderPage(1);
    setRankingError('');
  }

  async function compareSelected() {
    if (!session?.access_token || selected.length < 2 || comparing) return;

    const chosen = selected
      .map((id) => evaluations.find((evaluation) => evaluation.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (chosen.length !== selected.length) {
      setComparisonError('Refresh the report and select evaluations again.');
      return;
    }

    setComparing(true);
    setComparisonError('');
    setComparison(null);

    try {
      const response = await apiRequest<unknown>(
        '/comparisons',
        {
          method: 'POST',
          body: JSON.stringify({
            candidateIds: chosen.map(({ candidateId }) => candidateId),
            evaluationIds: chosen.map(({ id }) => id),
          }),
        },
        session.access_token,
      );

      const parsed = candidateComparisonResponseSchema.parse(response);

      if (parsed.items.length !== chosen.length || parsed.items.some((item) => !selected.includes(item.evaluationId))) {
        throw new Error('Comparison did not match the selected evaluations.');
      }

      setComparison(parsed);
    } catch (cause) {
      clearExpiredSession(cause);
      setComparisonError(
        cause instanceof ApiRequestError && (cause.status === 400 || cause.status === 409)
          ? 'These evaluations cannot be compared together. Select a different set with the same supported role and scoring configuration.'
          : messageFor(cause),
      );
    } finally {
      setComparing(false);
    }
  }

  return <div className="insights-page">
    <section className="insights-heading">
      <div>
        <span className="eyebrow"><span className="eyebrow-line"/> RECRUITER HOME</span>
        <h1>Insights &amp; rankings</h1>
        <p className="page-subtitle">Home activity and comparable evaluation results.</p>
      </div>
      <Link className="secondary-button insights-run-evaluation" to="/evaluations">Run an evaluation</Link>
    </section>

    {loading
      ? <WorkspaceSkeleton variant="insights"/>
      : error
        ? <section className="insights-state" role="alert">
            <p>{error}</p>
            <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button>
          </section>
        : dashboard && <>
          <section className="workspace-kpi-grid" aria-label="Home metrics">
            <KpiCard icon={<WorkspaceIcon name="candidates" size={17}/>} label="Candidates" value={dashboard.candidateCount} detail="Recruiter home"/>
            <KpiCard icon={<WorkspaceIcon name="evaluations" size={17}/>} label="Evaluations" value={dashboard.evaluationCount} detail="All saved evaluation runs"/>
            <KpiCard icon="✓" label="Completed" value={dashboard.statusCounts.completed ?? 0} detail="Completed evaluation runs" progress={dashboard.evaluationCount > 0 ? { value: dashboard.statusCounts.completed ?? 0, max: dashboard.evaluationCount, label: 'Completed evaluations out of all saved evaluations' } : undefined}/>
            <KpiCard icon="◉" label="Recent average" value={recentAverageProgress} decimals={1} suffix=" / 100" detail={recentScoreSummary.count ? `Across ${recentScoreSummary.count} scored recent evaluations` : 'No scored evaluations yet'} progress={recentAverageProgressBar} trend={recentScoreTrend}/>
          </section>

          <section className="insights-panel" aria-labelledby="ranking-title">
            <div className="insights-panel-heading">
              <div>
                <h2 id="ranking-title">Candidate rankings</h2>
                <p>{rankingMode === 'github_leetcode'
                  ? 'GitHub and LeetCode scores are weighted equally; resume scores are excluded.'
                  : 'Official six-category evaluation results for the selected role.'}</p>
              </div>
              <div className="insights-ranking-controls">
                <label htmlFor="ranking-mode">Ranking mode
                  <select id="ranking-mode" value={rankingMode} onChange={(event) => changeRankingMode(event.target.value as 'evaluation' | 'github_leetcode')}>
                    <option value="evaluation">Official evaluation</option>
                    <option value="github_leetcode">GitHub + LeetCode</option>
                  </select>
                </label>
                <label htmlFor="ranking-role">Role
                  <select id="ranking-role" value={roleId} onChange={(event) => changeRole(event.target.value as EvaluationRole['id'])}>
                    {roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {!roles.length
              ? <div className="insights-state"><h3>No evaluation roles available</h3><p>Rankings will appear when a supported evaluation role is available.</p></div>
              : rankingLoading
                ? <WorkspaceSkeleton variant="ranking"/>
                : rankingError
                  ? <div className="insights-state" role="alert"><p>{rankingError}</p><button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>Try again</button></div>
                  : rankingMode === 'github_leetcode' && providerRanking && hasRankingResults
                    ? <ProviderRankingTable ranking={providerRanking} onPageChange={setProviderPage}/>
                    : rankingMode === 'evaluation' && ranking && hasRankingResults
                      ? <InsightsRankingTable ranking={ranking} roleDisplayName={roles.find(({ id }) => id === roleId)?.displayName ?? 'selected role'}/>
                      : <div className="insights-state">
                          <h3>No candidates yet</h3>
                          <p>{rankingMode === 'github_leetcode'
                            ? 'No GitHub and LeetCode ranking results are available for this role yet.'
                            : 'Add candidates to this workspace to see saved evaluation evidence.'}</p>
                          <Link className="primary-button link-button" to="/dashboard/candidates">View candidates</Link>
                        </div>}
          </section>

          <section className="insights-panel" aria-labelledby="comparison-title">
            <div className="insights-panel-heading">
              <div>
                <h2 id="comparison-title">Compare candidates</h2>
                <p>Select 2–5 recent evaluation runs. The API checks that role and scoring configurations are compatible.</p>
              </div>
              <button className="primary-button" type="button" disabled={!canCompare} onClick={() => void compareSelected()}>
                {comparing ? 'Comparing…' : `Compare selected (${selected.length})`}
              </button>
            </div>

            {evaluations.length < 2
              ? <div className="insights-state"><p>At least two recent evaluations with supported scoring versions are needed for comparison.</p><Link className="secondary-button" to="/evaluations">Run evaluations</Link></div>
              : <div className="evaluation-choice-list" aria-label="Recent evaluations available to compare">
                  {evaluations.map((item) => <label key={item.id}>
                    <input type="checkbox" checked={selected.includes(item.id)} disabled={comparing || (!selected.includes(item.id) && selected.length >= 5)} onChange={() => toggleEvaluation(item.id)}/>
                    <span><strong>{item.candidateName}</strong><small>{item.status === 'completed' ? `Score ${item.score ?? 'unavailable'} / 100` : 'Insufficient evidence · no score'} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.createdAt))}</small></span>
                  </label>)}
                </div>}

            {comparisonError && <p className="insights-error" role="alert">{comparisonError}</p>}
            {comparison && <div className="comparison-results" role="status">
              <h3>{roles.find(({ id }) => id === comparison.roleId)?.displayName ?? comparison.roleId} comparison</h3>
              <p>Scoring version {comparison.scoringVersion}. This is decision support, not an automatic hiring decision.</p>
              <div className="comparison-cards">
                {comparison.items.map((item) => {
                  const record = evaluations.find(({ id }) => id === item.evaluationId);
                  return <article key={item.evaluationId}>
                    <span>{record?.candidateName ?? 'Candidate'}</span>
                    <strong>{item.result.overallScore ?? '—'}<small>{item.result.overallScore === undefined ? 'insufficient evidence' : '/ 100'}</small></strong>
                    <small>{item.result.evaluationStatus.replaceAll('_', ' ')}</small>
                  </article>;
                })}
              </div>
            </div>}
          </section>

          <section className="insights-panel" aria-labelledby="draft-evidence-title">
            <div className="insights-panel-heading">
              <div>
                <h2 id="draft-evidence-title">Draft evidence indexes</h2>
                <p>Saved GitHub and LeetCode evidence summaries; separate from official evaluations and rankings.</p>
              </div>
            </div>
            <DraftEvidenceIndexes evaluations={dashboard.recentEvaluations}/>
          </section>
        </>}
  </div>;
}
