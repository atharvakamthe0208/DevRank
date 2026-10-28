import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  aiAnalysisResponseSchema,
  candidateEvaluationsResponseSchema,
  candidateListResponseSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  scoringCategories,
  type Candidate,
  type AiAnalysisResponse,
  type EvaluationRole,
  type EvaluationRunResponse,
  type CategoryScore,
  type FinalReportCategory,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useUnsavedChangesBlocker } from '../../app/useUnsavedChangesBlocker';
import { aiAnalysisErrorMessage, analysisEmptyMessage } from './ai-analysis-presentation';
import { AiAnalysisRetryButton } from './AiAnalysisRetryButton';
import { formatEvidenceDate, readableProvenance } from './evidence-presentation';
import { acquireEvaluationRun, ALL_CANDIDATES_ID, bulkEvaluationStatusLabel, bulkEvaluationSummary, candidateOptions, runBulkEvaluations, type BulkEvaluationItem, type BulkEvaluationSnapshot } from './bulk-evaluation';
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import './evaluation-page.css';
import '../evaluations/evaluation.css';

type PageState = 'loading' | 'ready' | 'error';
type EvaluationSetupDraft = { candidateId: string; roleId: string };
function isEvaluationSetupDraft(value: unknown): value is EvaluationSetupDraft {
  return typeof value === 'object' && value !== null
    && 'candidateId' in value && typeof value.candidateId === 'string' && value.candidateId.length <= 128
    && 'roleId' in value && typeof value.roleId === 'string' && value.roleId.length <= 128;
}

export function EvaluationSetupHeader({ returnToCandidate, onBackToCandidate }: { returnToCandidate: string | null; onBackToCandidate: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  return <section className="evaluation-heading">
    <h1>Evaluation</h1>
    <Link className="secondary-button evaluation-back-link" to={returnToCandidate ?? '/dashboard/candidates'} replace onClick={onBackToCandidate}>
      {returnToCandidate ? 'Back to candidate' : 'View candidates'}
    </Link>
  </section>;
}

export function EvaluationSetupCardHeading() {
  return <div className="evaluation-panel-heading">
    <div>
      <h2>Evaluation</h2>
      <p>Select a candidate and role.</p>
    </div>
  </div>;
}

function explainError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Your session expired. Sign in again to run an evaluation.';
    if (error.status === 403) return 'Recruiter access is not approved for this workspace.';
    if (error.status === 404) return 'The selected candidate is unavailable in your workspace.';
    if (error.status === 400) return 'The candidate or role selection is invalid. Review your selections and try again.';
    return error.message;
  }
  return error instanceof Error && error.name === 'ApiNetworkError'
    ? error.message
    : 'The server returned data that could not be verified. Try again.';
}

function safeEvaluationReturn(value: unknown): string | null {
  return typeof value === 'string' && /^\/candidates\/[0-9a-f-]{36}$/i.test(value) ? value : null;
}

export function EvaluationPage() {
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedCandidateId = searchParams.get('candidateId') ?? '';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const initialSelection: EvaluationSetupDraft = { candidateId: preselectedCandidateId, roleId: searchParams.get('roleId') ?? '' };
  const { value: selection, status: draftStatus, persisted, setValue: setSelection, initialize: initializeSelection, clear: clearDraft } = useSessionDraft(session?.user?.id, 'evaluation:setup', initialSelection, isEvaluationSetupDraft);
  const candidateId = selection.candidateId;
  const roleId = selection.roleId as EvaluationRole['id'] | '';
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [selectionEdited, setSelectionEdited] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [runError, setRunError] = useState('');
  const [bulkConfirmation, setBulkConfirmation] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<BulkEvaluationSnapshot | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkEvaluationItem[]>([]);
  const [result, setResult] = useState<EvaluationRunResponse | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisRetryAt, setAnalysisRetryAt] = useState<number>();
  const analysisRequestRef = useRef(false);
  useUnsavedChangesBlocker(selectionEdited && !running, 'Your evaluation selections are kept as a draft in this browser tab. Leave this page?');
  const returnToCandidate = safeEvaluationReturn((location.state as { returnTo?: unknown } | null)?.returnTo);
  function backToCandidate(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && returnToCandidate) {
      event.preventDefault();
      navigate(-1);
    }
  }

  function updateSelectionParams(candidate: string, role: string) {
    const next = new URLSearchParams(searchParams);
    if (candidate && candidate !== ALL_CANDIDATES_ID) next.set('candidateId', candidate); else next.delete('candidateId');
    if (role) next.set('roleId', role); else next.delete('roleId');
    setSearchParams(next, { replace: true, state: location.state });
  }

  useEffect(() => {
    let active = true;
    async function load() {
      if (!session?.access_token) {
        setPageState('error');
        setLoadError('Your secure session is unavailable. Sign in again to continue.');
        return;
      }
      setPageState('loading');
      setLoadError('');
      setResult(null);
      setAnalysis(null);
      setAnalysisError('');
      try {
        const roleResponse = await apiRequest<unknown>('/evaluations/roles', undefined, session.access_token);
        const parsedRoles = evaluationRolesResponseSchema.parse(roleResponse);
        const candidateItems: Candidate[] = [];
        let page = 1;
        let total = 0;
        do {
          const candidateResponse = await apiRequest<unknown>(`/candidates?page=${page}&pageSize=100`, undefined, session.access_token);
          const parsedCandidates = candidateListResponseSchema.parse(candidateResponse);
          candidateItems.push(...parsedCandidates.items);
          total = parsedCandidates.total;
          page += 1;
        } while (candidateItems.length < total && page <= 1000);
        if (!active) return;
        setCandidates(candidateItems);
        setRoles(parsedRoles.roles);
        const selectedCandidate = candidateItems.some(({ id }) => id === preselectedCandidateId)
          ? preselectedCandidateId
          : (candidateItems[0]?.id ?? '');
        const chosenRole = parsedRoles.roles.some(({ id }) => id === (searchParams.get('roleId') ?? ''))
          ? (searchParams.get('roleId') as EvaluationRole['id'])
          : (parsedRoles.roles[0]?.id || '');
        const defaults = { candidateId: selectedCandidate, roleId: chosenRole };
        const saved = selectionRef.current;
        const candidateValid = !saved.candidateId || saved.candidateId === ALL_CANDIDATES_ID || candidateItems.some(({ id }) => id === saved.candidateId);
        const roleValid = !saved.roleId || parsedRoles.roles.some(({ id }) => id === saved.roleId);
        if (candidateValid && roleValid) initializeSelection(defaults);
        else clearDraft(defaults);

        if (preselectedCandidateId && candidateItems.some(({ id }) => id === preselectedCandidateId)) {
          try {
            const historyResponse = await apiRequest<unknown>(`/candidates/${preselectedCandidateId}/evaluations`, undefined, session.access_token);
            const parsedHistory = candidateEvaluationsResponseSchema.safeParse(historyResponse);
            if (active && parsedHistory.success && parsedHistory.data.items.length > 0) {
              const latest = parsedHistory.data.items[0];
              if (latest && latest.result.schemaVersion === '4.0.0' && 'categoryScores' in latest.result) {
                const matchingRole = parsedRoles.roles.find(({ id }) => id === latest.targetRole) ?? parsedRoles.roles[0];
                const candidateRecord = candidateItems.find(({ id }) => id === preselectedCandidateId);
                setResult({
                  id: latest.id,
                  status: latest.result.evaluationStatus,
                  candidate: { id: preselectedCandidateId, name: candidateRecord?.name ?? 'Candidate' },
                  role: matchingRole ?? { id: latest.targetRole, displayName: latest.targetRole.replaceAll('_', ' '), weights: latest.result.roleWeightsUsed },
                  evaluatedAt: latest.createdAt,
                  evaluation: latest.result,
                  evidenceLimitations: latest.result.missingEvidence.length > 0
                    ? ['Insufficient rubric-normalized evidence is available for a complete overall score. Platform counts are not converted into category scores.']
                    : [],
                });
              }
            }
          } catch {
            // Fallback to launch form if saved evaluation lookup fails
          }
        }

        setPageState('ready');
      } catch (error) {
        if (!active) return;
        setPageState('error');
        setLoadError(explainError(error));
      }
    }
    void load();
    return () => { active = false; };
  }, [session?.access_token, loadAttempt, initializeSelection, clearDraft]);

  useEffect(() => {
    if (candidates.some(({ id }) => id === preselectedCandidateId) && candidateId !== preselectedCandidateId) {
      setSelection((current) => ({ ...current, candidateId: preselectedCandidateId }));
    }
  }, [preselectedCandidateId, candidates, candidateId, setSelection]);
  const preselectedRoleId = searchParams.get('roleId') ?? '';
  useEffect(() => {
    if (roles.some(({ id }) => id === preselectedRoleId) && roleId !== preselectedRoleId) {
      setSelection((current) => ({ ...current, roleId: preselectedRoleId }));
    }
  }, [preselectedRoleId, roles, roleId, setSelection]);

  async function executeEvaluation(candidateToRun = candidateId, roleToRun = roleId) {
    if (runningRef.current) return;
    setResult(null);
    setAnalysis(null);
    setAnalysisError('');
    setRunError('');
    if (!candidateToRun || !candidates.some(({ id }) => id === candidateToRun)) {
      setRunError('Choose a candidate from your workspace.');
      return;
    }
    if (!roleToRun || !roles.some(({ id }) => id === roleToRun)) {
      setRunError('Choose a supported role.');
      return;
    }
    if (!session?.access_token) {
      setRunError('Your secure session expired. Sign in again to run an evaluation.');
      return;
    }
    if (!acquireEvaluationRun(runningRef)) return;
    setRunning(true);
    try {
      const response = await apiRequest<unknown>('/evaluations', {
        method: 'POST',
        body: JSON.stringify({ candidateId: candidateToRun, roleId: roleToRun }),
      }, session.access_token);
      const parsed = evaluationRunResponseSchema.parse(response);
      if (parsed.candidate.id !== candidateToRun || parsed.role.id !== roleToRun) {
        throw new Error('The evaluation response did not match the selected candidate and role.');
      }
      setSelectionEdited(false);
      setResult(parsed);
    } catch (error) {
      setRunError(explainError(error));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function executeAllCandidates() {
    if (runningRef.current) return;
    const roleToRun = roleId;
    const candidatesToRun = [...candidates];
    if (!candidatesToRun.length) { setRunError('There are no eligible candidates in your workspace.'); return; }
    if (!roleToRun || !roles.some(({ id }) => id === roleToRun)) { setRunError('Choose a supported role.'); return; }
    if (!session?.access_token) { setRunError('Your secure session expired. Sign in again to run evaluations.'); return; }
    if (!acquireEvaluationRun(runningRef)) return;
    setRunning(true);
    setBulkConfirmation(false);
    setRunError('');
    setResult(null);
    setAnalysis(null);
    setAnalysisError('');
    setSelectionEdited(false);
    const initial: BulkEvaluationSnapshot = {
      completed: 0,
      total: candidatesToRun.length,
      results: candidatesToRun.map((candidate) => ({ candidateId: candidate.id, candidateName: candidate.name, state: 'pending' })),
    };
    setBulkProgress(initial);
    setBulkResults(initial.results);
    try {
      const outcomes = await runBulkEvaluations(candidatesToRun, async (candidate) => {
        const response = await apiRequest<unknown>('/evaluations', {
          method: 'POST', body: JSON.stringify({ candidateId: candidate.id, roleId: roleToRun }),
        }, session.access_token);
        const parsed = evaluationRunResponseSchema.parse(response);
        if (parsed.candidate.id !== candidate.id || parsed.role.id !== roleToRun) throw new Error('The evaluation response did not match the requested candidate and role.');
        return parsed;
      }, explainError, (snapshot) => {
        setBulkProgress(snapshot);
        setBulkResults(snapshot.results);
      });
      setBulkResults(outcomes);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (candidateId === ALL_CANDIDATES_ID) {
      if (!roleId || !roles.some(({ id }) => id === roleId)) { setRunError('Choose a supported role.'); return; }
      if (runningRef.current) return;
      setRunError('');
      setBulkConfirmation(true);
      return;
    }
    void executeEvaluation();
  }

  async function loadAiAnalysis() {
    if (!result || !session?.access_token || analysisLoading || analysisRequestRef.current || (analysisRetryAt && analysisRetryAt > Date.now())) return;
    analysisRequestRef.current = true;
    setAnalysis(null);
    setAnalysisError('');
    setAnalysisRetryAt(undefined);
    setAnalysisLoading(true);
    try {
      const response = await apiRequest<unknown>(`/evaluations/${result.id}/ai-analysis`, {
        method: 'POST',
        body: JSON.stringify({}),
      }, session.access_token);
      const parsed = aiAnalysisResponseSchema.parse(response);
      if (parsed.evaluation.id !== result.id) throw new Error('The AI analysis belongs to a different evaluation.');
      setAnalysis(parsed);
    } catch (error) {
      setAnalysisError(aiAnalysisErrorMessage(error));
      if (error instanceof ApiRequestError && error.retryAfterSeconds) setAnalysisRetryAt(Date.now() + error.retryAfterSeconds * 1000);
    } finally {
      analysisRequestRef.current = false;
      setAnalysisLoading(false);
    }
  }

  return (
    <div className={`evaluation-page${result ? '' : ' evaluation-setup-page'}`}>
      {!result ? (
        <>
          <EvaluationSetupHeader returnToCandidate={returnToCandidate} onBackToCandidate={backToCandidate}/>
          {pageState === 'loading' ? (
            <WorkspaceSkeleton variant="evaluations" />
          ) : pageState === 'error' ? (
            <section className="evaluation-panel evaluation-state" role="alert">
              <h2>Could not load evaluation setup</h2>
              <p>{loadError}</p>
              <button className="secondary-button" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                Try again
              </button>
            </section>
          ) : (
            <form className="evaluation-panel evaluation-form" onSubmit={handleFormSubmit}>
              <EvaluationSetupCardHeading/>
              <SessionDraftNotice status={draftStatus} persisted={persisted} onDiscard={() => {
                const defaults = { candidateId: candidates.find(({ id }) => id === preselectedCandidateId)?.id ?? candidates[0]?.id ?? '', roleId: roles.find(({ id }) => id === preselectedRoleId)?.id ?? roles[0]?.id ?? '' };
                clearDraft(defaults);
                updateSelectionParams(defaults.candidateId, defaults.roleId);
                setSelectionEdited(false);
              }}/>
              {candidates.length === 0 ? (
                <div className="evaluation-empty">
                  <h3>No candidates available</h3>
                  <p>Add a candidate before starting an evaluation.</p>
                  <Link className="primary-button link-button" to="/candidates/new">Add candidate</Link>
                </div>
              ) : (
                <div className="evaluation-select-grid">
                  <label htmlFor="evaluation-candidate">
                    Candidate
                    <select
                      id="evaluation-candidate"
                      required
                      disabled={running}
                      value={candidateId}
                      onChange={(event) => {
                        setSelection((current) => ({ ...current, candidateId: event.target.value }));
                        updateSelectionParams(event.target.value, roleId);
                        setSelectionEdited(true);
                        setResult(null);
                        setBulkConfirmation(false);
                        setBulkProgress(null);
                        setBulkResults([]);
                        setRunError('');
                      }}
                    >
                      <option value="">Choose a candidate</option>
                      {candidateOptions(candidates).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <label htmlFor="evaluation-role">
                    Role
                    <select
                      id="evaluation-role"
                      required
                      disabled={running}
                      value={roleId}
                      onChange={(event) => {
                        const value = event.target.value as EvaluationRole['id'];
                        setSelection((current) => ({ ...current, roleId: value }));
                        updateSelectionParams(candidateId, value);
                        setSelectionEdited(true);
                        setResult(null);
                        setBulkConfirmation(false);
                        setBulkProgress(null);
                        setBulkResults([]);
                        setRunError('');
                      }}
                    >
                      <option value="">Choose a role</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>{r.displayName}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {candidates.length > 0 && (
                <div className="evaluation-form-footer">
                  <details className="evaluation-weights">
                    <summary>View scoring weights</summary>
                    {roles.find(({ id }) => id === roleId)?.weights && (
                      <ul>
                        {scoringCategories.map(({ id, displayName }) => (
                          <li key={id}>
                            <span>{displayName}</span>
                            <strong>{roles.find(({ id: roleKey }) => roleKey === roleId)?.weights[id]}%</strong>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                  <button className="primary-button" type="submit" disabled={running || !candidateId || !roleId}>
                    {running ? candidateId === ALL_CANDIDATES_ID ? 'Evaluating candidates…' : 'Running evaluation…' : candidateId === ALL_CANDIDATES_ID ? 'Run Evaluation for All' : 'Run Evaluation'}
                  </button>
                </div>
              )}
              {bulkConfirmation && candidateId === ALL_CANDIDATES_ID && <section className="evaluation-bulk-confirm" aria-labelledby="evaluation-bulk-confirm-title">
                <h3 id="evaluation-bulk-confirm-title">Evaluate all {candidates.length} candidates?</h3>
                <p>DevRank will run the selected role’s active v4 evaluation for every candidate in your workspace, one at a time. Candidates with insufficient evidence keep that status; a failure will not stop the remaining evaluations.</p>
                <div><button type="button" className="secondary-button" onClick={() => setBulkConfirmation(false)}>Cancel</button><button type="button" className="primary-button" disabled={running} onClick={() => void executeAllCandidates()}>Confirm and evaluate all</button></div>
              </section>}
              {running && candidateId !== ALL_CANDIDATES_ID && <p className="evaluation-progress" role="status">Verifying candidate access and calculating available evidence…</p>}
              {bulkProgress && <section className="evaluation-bulk-results" aria-label="Bulk evaluation results" aria-live="polite">
                <div className="evaluation-bulk-results-heading">
                  <div>
                    <h3>{bulkProgress.completed < bulkProgress.total ? `Evaluating ${Math.min(bulkProgress.completed + (bulkProgress.currentCandidateId ? 1 : 0), bulkProgress.total)} of ${bulkProgress.total} candidates` : 'Bulk evaluation finished'}</h3>
                    <p>Each result reflects the saved evaluation status.</p>
                  </div>
                  <span className="evaluation-bulk-progress-count">{bulkProgress.completed} of {bulkProgress.total} processed</span>
                </div>
                {(() => {
                  const summary = bulkEvaluationSummary(bulkResults);
                  return <div className="evaluation-bulk-summary" aria-label="Evaluation summary">
                    <div><span>Total candidates</span><strong>{bulkProgress.total}</strong></div>
                    <div data-tone="success"><span>Completed evaluations</span><strong>{summary.completed}</strong></div>
                    <div data-tone="danger"><span>Failed</span><strong>{summary.failed}</strong></div>
                    <div data-tone="neutral"><span>Skipped</span><strong>{summary.skipped}</strong></div>
                  </div>;
                })()}
                <ul>{bulkResults.map((item) => <li key={item.candidateId} data-state={item.state}>
                  <div className="evaluation-bulk-candidate">
                    <strong title={item.candidateName}>{item.candidateName}</strong>
                    <span className="evaluation-bulk-status" data-state={item.state} data-evaluation-status={item.evaluationStatus}>
                      {bulkEvaluationStatusLabel(item)}
                    </span>
                    {item.state === 'failed' && <p>{item.error ?? 'Evaluation failed.'}</p>}
                  </div>
                  <div className="evaluation-bulk-links">
                    {item.evaluationId && <Link to={`/evaluations/${item.evaluationId}`}>View evaluation</Link>}
                    <Link to={`/candidates/${item.candidateId}`}>View candidate</Link>
                  </div>
                </li>)}</ul>
              </section>}
              {runError && <p className="form-feedback form-feedback-error" role="alert">{runError}</p>}
            </form>
          )}
        </>
      ) : (
        <EvaluationRunResult
          result={result}
          candidate={candidates.find(({ id }) => id === result.candidate.id)}
          analysis={analysis}
          analysisLoading={analysisLoading}
          analysisError={analysisError}
          analysisRetryAt={analysisRetryAt}
          onAnalyze={() => void loadAiAnalysis()}
          onRegenerate={() => void executeEvaluation(result.candidate.id, result.role.id)}
          onNewEvaluation={() => setResult(null)}
          returnToCandidate={returnToCandidate}
          onBackToCandidate={backToCandidate}
        />
      )}
    </div>
  );
}

export function EvaluationRunResult({
  result,
  candidate,
  analysis,
  analysisLoading,
  analysisError,
  analysisRetryAt,
  onAnalyze,
  onRegenerate,
  onNewEvaluation,
  returnToCandidate,
  onBackToCandidate,
}: {
  result: EvaluationRunResponse;
  candidate?: Candidate;
  analysis: AiAnalysisResponse | null;
  analysisLoading: boolean;
  analysisError: string;
  analysisRetryAt?: number;
  onAnalyze: () => void;
  onRegenerate?: () => void;
  onNewEvaluation?: () => void;
  returnToCandidate?: string | null;
  onBackToCandidate?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const evaluation = result.evaluation;
  const technicalCategory = evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === 'technical_skills');
  const githubRepositorySnapshot = evaluation.platformEvidence?.find(({ source, evidenceType }) => source === 'github' && evidenceType === 'repository_snapshot');
  const githubNormalized = githubRepositorySnapshot?.normalizedValue ?? {};
  const languageSummary = typeof githubNormalized.languageSummary === 'object' && githubNormalized.languageSummary !== null
    ? (githubNormalized.languageSummary as Record<string, unknown>)
    : undefined;
  const repositoryCount = metricNumber(technicalCategory, 'totalEligibleRepositories')
    ?? metricNumber(technicalCategory, 'publicRepositoryCount')
    ?? (typeof githubNormalized.publicRepositoryCount === 'number' ? githubNormalized.publicRepositoryCount : undefined);
  const languageCount = metricNumber(technicalCategory, 'distinctRepositoryLanguages')
    ?? (Array.isArray(languageSummary?.observedLanguages) ? languageSummary.observedLanguages.length : undefined);
  const evidenceBacked = evaluation.evidence.length > 0
    || evaluation.platformEvidence?.some(({ availability }) => availability === 'available' || availability === 'partial') === true;
  const isCompleted = result.status === 'completed';

  const candidateName = candidate?.name || result.candidate.name;
  const profileDetails = [
    candidate?.email,
    candidate?.githubUsername ? `GitHub @${candidate.githubUsername}` : undefined,
    candidate?.leetcodeUsername ? `LeetCode @${candidate.leetcodeUsername}` : undefined,
  ].filter((value): value is string => Boolean(value));

  const formattedDate = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(result.evaluatedAt));

  return (
    <section className="evaluation-results" aria-labelledby="evaluation-results-title">
      <div className="evaluation-candidate-card">
        <div className="candidate-card-left">
          <div className="candidate-card-meta">
            <h1 className="candidate-name">{candidateName}</h1>
            <p className="candidate-role-date">
              {result.role.displayName} <span aria-hidden="true">•</span> Evaluated on {formattedDate}
            </p>
            {profileDetails.length > 0 && (
              <p className="evaluation-profile-details">{profileDetails.join(' · ')}</p>
            )}
            {(repositoryCount !== undefined || languageCount !== undefined) && (
              <div className="evaluation-candidate-metrics" aria-label="Available profile evidence">
                {repositoryCount !== undefined && <span><strong>{repositoryCount}</strong> public {repositoryCount === 1 ? 'repository' : 'repositories'}</span>}
                {languageCount !== undefined && <span><strong>{languageCount}</strong> detected {languageCount === 1 ? 'language' : 'languages'}</span>}
              </div>
            )}
          </div>
        </div>
        <div className="candidate-card-actions">
          <span className={`evaluation-status-badge ${isCompleted ? 'is-completed' : 'is-incomplete'}`}>
            <span className="status-dot" aria-hidden="true" />
            {isCompleted ? 'Completed' : 'Insufficient evidence'}
          </span>
          {evidenceBacked && <span className="evaluation-evidence-indicator">Evidence-backed</span>}
          {onRegenerate && (
            <button
              type="button"
              className="secondary-button regenerate-button"
              onClick={onRegenerate}
              title="Run this evaluation again"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                <path d="M16 21h5v-5" />
              </svg>
              <span>Run evaluation again</span>
            </button>
          )}
          <a
            className="secondary-button evaluation-back-action"
            href={returnToCandidate ?? `/candidates/${result.candidate.id}`}
            onClick={onBackToCandidate}
          >
            View Candidate
          </a>
          {onNewEvaluation && (
            <button
              type="button"
              className="secondary-button new-eval-button"
              onClick={onNewEvaluation}
            >
              New evaluation
            </button>
          )}
        </div>
      </div>

      <section className="evaluation-overall-panel" aria-label="Overall score">
        <div className="evaluation-overall-gauge-wrap">
          <div
            className="evaluation-score-ring"
            role="img"
            aria-label={evaluation.overallScore !== undefined ? `Overall score ${evaluation.overallScore} out of 100` : 'Overall score withheld'}
          >
            <svg viewBox="0 0 110 110" width="110" height="110" className="evaluation-ring-svg" aria-hidden="true">
              <circle cx="55" cy="55" r="44" className="evaluation-ring-track" />
              {evaluation.overallScore !== undefined ? (
                <circle
                  cx="55"
                  cy="55"
                  r="44"
                  className="evaluation-ring-fill"
                  strokeDasharray="276.46"
                  strokeDashoffset={276.46 - (276.46 * Math.min(100, Math.max(0, evaluation.overallScore))) / 100}
                />
              ) : (
                <circle
                  cx="55"
                  cy="55"
                  r="44"
                  className="evaluation-ring-track is-withheld"
                  strokeDasharray="4 6"
                />
              )}
            </svg>
            <div className="evaluation-ring-center">
              <span className="evaluation-overall-score-number">
                {evaluation.overallScore !== undefined ? evaluation.overallScore : '—'}
              </span>
              <span className="evaluation-overall-score-denom">/ 100</span>
            </div>
          </div>
        </div>

        <div className="evaluation-overall-panel-copy">
          <div className="evaluation-overall-title-row">
            <span className="evaluation-overview-label">Overall score</span>
            <strong className="evaluation-overall-score-val">
              {evaluation.overallScore !== undefined ? `${evaluation.overallScore} / 100` : 'Score withheld'}
            </strong>
          </div>
          <p className="evaluation-overall-desc">
            {evaluation.overallScore !== undefined
              ? 'Weighted summary of the saved category evidence for this role.'
              : 'An overall score is withheld because the available evidence is insufficient.'}
          </p>
        </div>
      </section>

      <div className="evaluation-section-heading" aria-label="Evaluation report">
        <div className="evaluation-section-title-wrap">
          <h2 id="evaluation-results-title">Evaluation Results</h2>
          <p>Scores across key dimensions based on available evidence</p>
        </div>
      </div>

      <div className="evaluation-category-grid">
        {evaluation.categoryScores.map((category) => {
          const reportCategory = evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === category.categoryId);
          const status = categoryDisplayStatus(category, reportCategory);
          return (
            <article
              className="evaluation-category-card-v2"
              key={category.categoryId}
              data-category={category.categoryId}
              data-score-state={category.score === undefined ? 'unscored' : 'scored'}
            >
              <div className="evaluation-category-card-heading-v2">
                <div className="evaluation-category-title-wrap">
                  <span
                    className={`evaluation-category-icon evaluation-category-icon-${category.categoryId}`}
                    aria-hidden="true"
                  >
                    <CategoryGlyph category={category} />
                  </span>
                  <h3>{category.displayName}</h3>
                </div>
                <strong className="evaluation-category-score-val">
                  {category.score === undefined ? 'Not scored' : `${category.score} / 100`}
                </strong>
              </div>

              <div className="evaluation-progress-wrap">
                {category.score !== undefined ? (
                  <progress
                    className="evaluation-score-progress-v2"
                    max="100"
                    value={category.score}
                    aria-label={`${category.displayName} score ${category.score} out of 100`}
                  />
                ) : (
                  <div className="evaluation-score-progress-v2 is-empty" aria-hidden="true" />
                )}
              </div>

              {category.score === undefined && (
                <div className="evaluation-status-row">
                  <span className={`evaluation-category-status status-${status.toLowerCase().replaceAll(' ', '-')}`}>
                    <span className="status-indicator-dot" aria-hidden="true" />
                    {status}
                  </span>
                </div>
              )}

              <p className="evaluation-category-interpretation">
                {categoryInterpretation(category, reportCategory)}
              </p>

              <details className="evaluation-evidence-disclosure-v2">
                <summary>View evidence <span aria-hidden="true">→</span></summary>
                {category.evidenceRefs.length > 0 ? (
                  <ul>
                    {category.evidenceRefs.map((reference) => {
                      const item = evaluation.evidence.find(({ evidenceId }) => evidenceId === reference);
                      return (
                        <li key={reference}>
                          <strong>{readableProvenance(item?.source ?? 'Evidence')}:</strong>{' '}
                          {item?.description ?? 'Saved supporting evidence'}
                          {item?.observedAt ? ` · observed ${formatEvidenceDate(item.observedAt)}` : ''}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>
                    {category.scoreBasis === 'optional_missing_zero'
                      ? 'No source reference is available because the optional LeetCode profile was not provided.'
                      : 'No supporting references are available for this category.'}
                  </p>
                )}
              </details>
            </article>
          );
        })}
      </div>

      <section className="ai-analysis" aria-labelledby="ai-analysis-title">
        <div className="ai-analysis-heading">
          <div>
            <h3 id="ai-analysis-title">AI Candidate Insights</h3>
            <p>Strengths and improvement opportunities from the available evaluation evidence.</p>
            <p className="ai-analysis-authority-note">AI explanations are separate from the saved deterministic scores.</p>
          </div>
          <div className="ai-analysis-actions">
            <AiAnalysisRetryButton
              className="primary-button evaluation-ai-primary-action"
              onRetry={onAnalyze}
              pending={analysisLoading}
              retryAt={analysisRetryAt}
              idleLabel={analysis ? 'Regenerate Analysis' : 'Generate AI analysis'}
            />
            <Link className="ai-report-link ai-analysis-full-report-link" to={`/evaluations/${result.id}/analysis`} state={analysis ? { analysis } : undefined}>
              View full analysis <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        {analysisLoading && (
          <p className="ai-analysis-status" role="status">
            Reviewing the saved evaluation and its supporting evidence…
          </p>
        )}
        {analysisError && (
          <div className="ai-analysis-error" role="alert">
            <p>{analysisError}</p>
            <AiAnalysisRetryButton
              className="text-button"
              onRetry={onAnalyze}
              pending={analysisLoading}
              retryAt={analysisRetryAt}
            />
          </div>
        )}
        {analysis && <AiAnalysisSummary response={analysis} />}
      </section>
    </section>
  );
}

function metricNumber(category: FinalReportCategory | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = category?.metrics[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function metricString(category: FinalReportCategory | undefined, key: string): string | undefined {
  const value = category?.metrics[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function categoryDisplayStatus(score: CategoryScore, report?: FinalReportCategory): string {
  if (score.scoreBasis === 'optional_missing_zero') return 'Policy-defined zero';
  if (score.score !== undefined) return 'Scored';
  if (report?.status === 'partial') return 'Partial evidence';
  if (report?.status === 'unavailable') return 'Unavailable';
  return 'Insufficient evidence';
}

function categoryInterpretation(score: CategoryScore, report?: FinalReportCategory): string {
  const dataStatus = metricString(report, 'dataStatus');
  if (dataStatus) return dataStatus;
  switch (score.categoryId) {
    case 'project_portfolio': {
      const count = metricNumber(report, 'publicRepositoryCount');
      return count === undefined ? 'A public repository count is not available in the saved evidence.' : `${count} public ${count === 1 ? 'repository is' : 'repositories are'} included in the saved snapshot.`;
    }
    case 'technical_skills': {
      const analyzed = metricNumber(report, 'repositoriesAnalyzed');
      const total = metricNumber(report, 'totalEligibleRepositories');
      const languages = metricString(report, 'languagesObserved');
      const repositoryCount = analyzed !== undefined && total !== undefined ? `${analyzed} of ${total} eligible repositories analyzed` : undefined;
      const languageCount = metricNumber(report, 'distinctRepositoryLanguages');
      const languagesText = languages
        ? `${languageCount ?? languages.split(',').length} detected ${languageCount === 1 ? 'language' : 'languages'}: ${languages}`
        : languageCount !== undefined ? `${languageCount} detected ${languageCount === 1 ? 'language' : 'languages'}` : undefined;
      if (report?.metrics.languageCoverageStatus === 'unavailable') return 'GitHub repository language data is unavailable; no score is assigned.';
      if (repositoryCount && languagesText) return `${languagesText}; ${repositoryCount}.`;
      if (repositoryCount) return `Language coverage: ${repositoryCount}.`;
      return score.score === undefined ? 'No usable repository language evidence is available for this category.' : 'The score reflects language breadth in the saved repository evidence.';
    }
    case 'development_activity': {
      const commits = metricNumber(report, 'commitContributions', 'totalCommitContributions');
      const days = metricNumber(report, 'activeCommitDays');
      if (commits !== undefined) return `${commits} attributable commit contributions${days === undefined ? '' : ` across ${days} active days`} are recorded in the saved evidence.`;
      return score.score === undefined ? 'No usable commit activity evidence is available for this category.' : 'The score reflects the saved commit activity evidence.';
    }
    case 'collaboration': {
      const metrics = [
        ['pullRequestsOpened', 'pull requests'], ['issuesOpened', 'issues'], ['reviewsSubmitted', 'reviews'],
      ] as const;
      const available = metrics.flatMap(([key, label]) => {
        const value = metricNumber(report, key);
        return value === undefined ? [] : [`${value} ${label}`];
      });
      return available.length ? `Saved GitHub activity includes ${available.join(', ')}.` : score.score === undefined ? 'No usable collaboration activity evidence is available for this category.' : 'The score reflects the saved GitHub activity evidence.';
    }
    case 'current_year_contributions': {
      const total = metricNumber(report, 'totalContributions');
      const year = metricNumber(report, 'year');
      if (total !== undefined) return `${total} contributions are recorded${year === undefined ? '' : ` for ${year}`} in the saved UTC calendar evidence.`;
      return score.score === undefined ? 'No usable current-year contribution evidence is available.' : 'The score reflects saved UTC calendar coverage evidence.';
    }
    case 'problem_solving_dsa': {
      const difficultyCounts = [
        ['easySolved', 'easy'], ['mediumSolved', 'medium'], ['hardSolved', 'hard'],
      ] as const;
      const available = difficultyCounts.flatMap(([key, label]) => {
        const value = metricNumber(report, key);
        return value === undefined ? [] : [`${value} ${label}`];
      });
      if (available.length) return `Saved problem-solving evidence includes ${available.join(', ')} problems.`;
      return score.score === undefined ? 'No usable problem-solving evidence is available for this category.' : 'The score reflects the saved problem-solving evidence.';
    }
  }
  return score.score === undefined ? 'There is not enough usable evidence to assign a score.' : 'The score reflects the saved evidence.';
}

function CategoryGlyph({ category }: { category: CategoryScore }) {
  switch (category.categoryId) {
    case 'project_portfolio':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.5 5.5A2.5 2.5 0 0 1 5 3h4.382a2.5 2.5 0 0 1 1.768.732L12.5 5.118A1 1 0 0 0 13.207 5.4H19A2.5 2.5 0 0 1 21.5 7.9v9.6a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5v-12z" />
        </svg>
      );
    case 'technical_skills':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case 'development_activity':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="12" width="4" height="9" rx="1.5" />
          <rect x="10" y="7" width="4" height="14" rx="1.5" />
          <rect x="17" y="3" width="4" height="18" rx="1.5" />
        </svg>
      );
    case 'collaboration':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 9a6 6 0 0 1 12 0v1H3v-1zm14.5-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm1 3.5c1.4.3 2.5 1.5 2.5 3v2.5h-5V19c0-1.7-.8-3.2-2.1-4.2 1.3-.2 2.9-.3 4.6-.3z" />
        </svg>
      );
    case 'current_year_contributions':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M6 2a1 1 0 0 1 1 1v1h10V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm14 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9zm-13 3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2zm6 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-2z" />
        </svg>
      );
    case 'problem_solving_dsa':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2a4 4 0 0 0-4 4c0 .4.06.78.17 1.14A4.5 4.5 0 0 0 5 11.5c0 .66.15 1.28.4 1.84A4 4 0 0 0 6 21h1a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a4 4 0 0 0 .6-7.66 4.5 4.5 0 0 0 .4-1.84 4.5 4.5 0 0 0-3.17-4.36A4 4 0 0 0 12 2z" />
        </svg>
      );
  }
}

export function AiAnalysisSummary({ response }: { response: AiAnalysisResponse }) {
  const unavailable = analysisEmptyMessage(response);
  if (unavailable || !response.analysis) {
    return (
      <div className="ai-analysis-unavailable" role="status">
        <p>{unavailable}</p>
        <Link className="ai-report-link" to={`/evaluations/${response.evaluation.id}/analysis`} state={{ analysis: response }}>
          Open evaluation report →
        </Link>
      </div>
    );
  }
  const { analysis } = response;
  return (
    <div className="ai-analysis-content">
      <article className="ai-analysis-summary">
        <h4>Executive Summary</h4>
        <p>{analysis.summary}</p>
      </article>
      <div className="ai-analysis-preview-grid">
        <article className="ai-insight-strengths">
          <h4>Key Strengths</h4>
          {analysis.strengths.length ? (
            <ul>{analysis.strengths.slice(0, 3).map((item, index) => <li key={index}>{item.text}</li>)}</ul>
          ) : (
            <p className="ai-analysis-empty">No strengths were returned from the supplied evidence.</p>
          )}
        </article>
        <article className="ai-insight-improvements">
          <h4>Areas to Improve</h4>
          {analysis.weaknesses.length ? (
            <ul>{analysis.weaknesses.slice(0, 2).map((item, index) => <li key={index}>{item.text}</li>)}</ul>
          ) : (
            <p className="ai-analysis-empty">No improvement areas were identified from the available evidence.</p>
          )}
        </article>
        <article className="ai-insight-next-steps">
          <h4>Recommended Next Steps</h4>
          {analysis.recommendations.length ? (
            <ul>{analysis.recommendations.slice(0, 3).map((item, index) => <li key={index}>{item.text}</li>)}</ul>
          ) : (
            <p className="ai-analysis-empty">No recommendations were returned.</p>
          )}
        </article>
      </div>
    </div>
  );
}
