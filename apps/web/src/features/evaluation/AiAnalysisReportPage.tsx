import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { aiAnalysisResponseSchema, persistedEvaluationReadSchema, persistedEvaluationSchema, type AiAnalysisResponse, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { aiAnalysisErrorMessage, analysisEmptyMessage, analysisReferenceDescriptions } from './ai-analysis-presentation';
import { AiAnalysisRetryButton } from './AiAnalysisRetryButton';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useWorkspaceBreadcrumbLabels } from '../../components/layout/WorkspaceBreadcrumbContext';
import './ai-analysis-report.css';

type CandidateSummary = { id: string; name: string; email?: string };
type PageState = { status: 'loading' } | { status: 'error'; message: string } | {
  status: 'saved'; evaluation: PersistedEvaluationRead; candidate: CandidateSummary;
  response?: AiAnalysisResponse; analysisStatus: 'loading' | 'ready' | 'error' | 'unavailable'; analysisMessage?: string; analysisRetryAt?: number;
};

function messageFor(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) return 'AI explanations are unavailable for this historical scoring version. Its saved scores and category names remain unchanged.';
  if (error instanceof ApiRequestError && error.status === 404) return 'This evaluation is unavailable in your workspace.';
  return aiAnalysisErrorMessage(error);
}

export function AiAnalysisReportPage() {
  const { evaluationId = '' } = useParams();
  const location = useLocation();
  const { session } = useAuth();
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const evaluationName = state.status === 'saved' ? `${state.candidate.name} · ${state.evaluation.targetRole.replaceAll('_', ' ')}` : undefined;
  useWorkspaceBreadcrumbLabels({ evaluationName });
  const [attempt, setAttempt] = useState(0);
  const retryRequestRef = useRef(false);
  const initialResponse = useMemo(() => {
    const navigationResponse = aiAnalysisResponseSchema.safeParse((location.state as { analysis?: unknown } | null)?.analysis);
    return navigationResponse.success && navigationResponse.data.evaluation.id === evaluationId ? navigationResponse.data : undefined;
  }, [location.state, evaluationId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!session?.access_token) { setState({ status: 'error', message: 'Your secure session is unavailable. Sign in again.' }); return; }
    setState({ status: 'loading' });
    try {
      const evaluation = initialResponse?.evaluation ?? persistedEvaluationReadSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}`, { signal }, session.access_token));
      if (signal?.aborted) return;
      if (evaluation.id !== evaluationId) throw new Error('The saved evaluation did not match this report.');
      const candidateValue = await apiRequest<unknown>(`/candidates/${evaluation.candidateId}`, { signal }, session.access_token);
      if (signal?.aborted) return;
      const candidate = parseCandidateApiResponse(candidateValue);
      if (!candidate) throw new Error('Candidate details could not be verified.');
      const current = persistedEvaluationSchema.safeParse(evaluation);
      if (!current.success) {
        setState({ status: 'saved', evaluation, candidate: { id: candidate.id, name: candidate.name, email: candidate.email }, analysisStatus: 'unavailable', analysisMessage: 'AI explanations are unavailable for this historical scoring version. View the original saved result below.' });
        return;
      }
      if (initialResponse) {
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name, email: candidate.email }, response: initialResponse, analysisStatus: 'ready' });
        return;
      }
      setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name, email: candidate.email }, analysisStatus: 'loading' });
      try {
        const response = aiAnalysisResponseSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({}), signal }, session.access_token));
        if (signal?.aborted) return;
        if (response.evaluation.id !== evaluationId) throw new Error('The analysis response did not match this evaluation.');
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name, email: candidate.email }, response, analysisStatus: 'ready' });
      } catch (error) {
        if (signal?.aborted) return;
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name, email: candidate.email }, analysisStatus: 'error', analysisMessage: messageFor(error), analysisRetryAt: error instanceof ApiRequestError && error.retryAfterSeconds ? Date.now() + error.retryAfterSeconds * 1000 : undefined });
      }
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: messageFor(error) });
    }
  }, [session?.access_token, evaluationId, initialResponse]);

  const retryAnalysis = useCallback(async () => {
    if (state.status !== 'saved' || !session?.access_token || retryRequestRef.current || (state.analysisRetryAt && state.analysisRetryAt > Date.now())) return;
    const current = persistedEvaluationSchema.safeParse(state.evaluation);
    if (!current.success) return;
    const savedState = state;
    retryRequestRef.current = true;
    setState({ ...savedState, response: undefined, analysisStatus: 'loading', analysisMessage: undefined });
    try {
      const response = aiAnalysisResponseSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({}) }, session.access_token));
      if (response.evaluation.id !== evaluationId) throw new Error('The analysis response did not match this evaluation.');
      setState({ ...savedState, response, analysisStatus: 'ready', analysisMessage: undefined });
    } catch (error) {
      setState({ ...savedState, response: undefined, analysisStatus: 'error', analysisMessage: messageFor(error), analysisRetryAt: error instanceof ApiRequestError && error.retryAfterSeconds ? Date.now() + error.retryAfterSeconds * 1000 : undefined });
    } finally {
      retryRequestRef.current = false;
    }
  }, [state, session?.access_token, evaluationId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, attempt]);

  if (state.status === 'loading') return <main className="ai-report-page"><WorkspaceSkeleton variant="detail"/></main>;
  if (state.status === 'error') return <main className="ai-report-page"><section className="ai-report-state" role="alert"><span className="dashboard-kicker">EVALUATION REPORT</span><h1>Report unavailable</h1><p>{state.message}</p><button type="button" className="dashboard-secondary-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Back to evaluation</Link></section></main>;

  const currentEvaluation = persistedEvaluationSchema.safeParse(state.evaluation);
  if (!currentEvaluation.success && state.evaluation.result.schemaVersion === '4.0.0') return <main className="ai-report-page"><Link className="ai-report-back" to={`/evaluations/${evaluationId}`}>← Back to saved evaluation</Link><header className="ai-report-header"><div><span className="dashboard-kicker">EVALUATION STATUS</span><h1>{state.candidate.name}</h1><p>{state.evaluation.targetRole.replaceAll('_', ' ')} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.evaluation.createdAt))}</p></div><span className="ai-report-status report-incomplete">{state.evaluation.status.replaceAll('_', ' ')}</span></header><section className="ai-report-empty" role="status"><h2>Evaluation result unavailable</h2><p>This saved evaluation is {state.evaluation.status.replaceAll('_', ' ')} and has no completed score report.</p><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Open evaluation status</Link></section></main>;
  if (!currentEvaluation.success) return <main className="ai-report-page"><Link className="ai-report-back" to={`/evaluations/${evaluationId}`}>← Back to saved evaluation</Link><header className="ai-report-header"><div><span className="dashboard-kicker">HISTORICAL EVALUATION</span><h1>{state.candidate.name}</h1><p>{state.evaluation.targetRole.replaceAll('_', ' ')} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.evaluation.createdAt))}</p></div><span className={`ai-report-status${state.evaluation.status === 'completed' ? ' report-complete' : ' report-incomplete'}`}>{state.evaluation.status.replaceAll('_', ' ')}</span></header><section className="ai-report-score-panel" aria-label="Historical saved evaluation"><div><span className="dashboard-kicker">ORIGINAL SAVED RESULT · {state.evaluation.result.scoringVersion ?? state.evaluation.result.schemaVersion}</span><strong>{state.evaluation.result.overallScore === undefined ? 'Score not calculated' : `${state.evaluation.result.overallScore} / 100`}</strong><small>Historical values are shown in their original scoring format.</small></div></section><section className="ai-report-empty" role="status"><h2>AI explanation unavailable</h2><p>{state.analysisMessage}</p><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Open original evaluation and category results</Link></section></main>;

  return <AiAnalysisReportView response={state.response} evaluation={currentEvaluation.data} candidateName={state.candidate.name} candidateEmail={state.candidate.email} analysisLoading={state.analysisStatus === 'loading'} analysisError={state.analysisStatus === 'error' ? state.analysisMessage : undefined} analysisRetryAt={state.analysisRetryAt} onRetry={() => void retryAnalysis()}/>;
}

function formatRoleLabel(role: string): string {
  return role.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

export function AiAnalysisReportView({ response, evaluation: evaluationProp, candidateName, candidateEmail, analysisLoading = false, analysisError, analysisRetryAt, onRetry }: {
  response?: AiAnalysisResponse; evaluation?: PersistedEvaluation; candidateName: string; candidateEmail?: string; analysisLoading?: boolean; analysisError?: string; analysisRetryAt?: number; onRetry?: () => void;
}) {
  const evaluation = response?.evaluation ?? evaluationProp;
  if (!evaluation) return null;
  const result = evaluation.result;
  const analysis = response?.analysis;
  const emptyMessage = response ? analysisEmptyMessage(response) : undefined;

  const allReferenceIds = analysis
    ? Array.from(new Set([
        ...analysis.summaryEvidenceReferences,
        ...analysis.roleRelevanceEvidenceReferences,
        ...analysis.strengths.flatMap((s) => s.evidenceReferences),
        ...analysis.weaknesses.flatMap((w) => w.evidenceReferences),
        ...analysis.recommendations.flatMap((r) => r.evidenceReferences),
      ]))
    : [];
  const uniqueSourceDescriptions = analysis
    ? analysisReferenceDescriptions(evaluation, allReferenceIds)
    : [];

  return (
    <main className="ai-report-page">
      <header className="ai-report-page-header">
        <div>
          <Link className="ai-report-back" to={`/evaluations/${evaluation.id}`}>← Back to evaluation</Link>
          <h1>AI Candidate Analysis</h1>
          <p>A detailed analysis of the candidate&apos;s strengths, development areas, and recommendations.</p>
        </div>
        {!emptyMessage && (
          <AiAnalysisRetryButton
            className="ai-report-primary-action"
            onRetry={onRetry}
            pending={analysisLoading}
            retryAt={analysisRetryAt}
            idleLabel={analysisError ? 'Try again' : analysis ? 'Regenerate analysis' : 'Generate analysis'}
          />
        )}
      </header>

      <section className="ai-report-candidate-summary" aria-label="Candidate and evaluation summary">
        <div className="ai-report-candidate-details">
          <h2>{candidateName}</h2>
          <p className="ai-report-role-line">{formatRoleLabel(evaluation.targetRole)}</p>
          <div className="ai-report-candidate-meta">
            {candidateEmail && <span>{candidateEmail}</span>}
            {candidateEmail && <span aria-hidden="true">·</span>}
            <span>Evaluated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(evaluation.createdAt))}</span>
          </div>
        </div>
        <div className="ai-report-candidate-result">
          <span className={`ai-report-status-badge ${evaluation.status === 'completed' ? 'is-completed' : 'is-incomplete'}`}>
            <span className="status-dot" aria-hidden="true" />
            {evaluation.status === 'completed' ? 'Completed' : evaluation.status.replaceAll('_', ' ')}
          </span>
          <div className="ai-report-candidate-score">
            <span>Overall score</span>
            <strong>{result.overallScore === undefined ? '—' : `${result.overallScore} / 100`}</strong>
            {result.overallScore === undefined && <small>No overall score calculated</small>}
          </div>
        </div>
      </section>

      {analysisLoading ? (
        <section className="ai-report-state" role="status">
          <div className="ai-report-spinner" aria-hidden="true" />
          <p>Preparing AI candidate insights from the saved evaluation and its supporting evidence…</p>
        </section>
      ) : analysisError ? (
        <section className="ai-report-ai-state" role="alert">
          <div>
            <strong>Insight generation unavailable</strong>
            <p>{analysisError} The saved evaluation above is unchanged.</p>
          </div>
        </section>
      ) : emptyMessage || !analysis ? (
        <section className="ai-report-empty" role="status">
          <h2>AI explanation unavailable</h2>
          <p>{emptyMessage ?? 'No explanation is available for this evaluation.'}</p>
          <p>The saved deterministic evaluation remains available. Missing evidence is not treated as a negative score.</p>
        </section>
      ) : (
        <>
          <section className="ai-report-card ai-report-executive-card" aria-labelledby="exec-summary-title">
            <div className="ai-report-card-header">
              <div className="ai-report-icon-tile icon-tile-blue" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
              </div>
              <div>
                <h2 id="exec-summary-title">Executive Summary</h2>
              </div>
            </div>

            <p className="ai-report-summary-text">{analysis.summary}</p>

          </section>

          <section aria-labelledby="detailed-insights-title">
            <div className="ai-report-section-heading">
              <h2 id="detailed-insights-title">Detailed insights</h2>
              <p>Evidence-grounded observations and practical next steps.</p>
            </div>
          <div className="ai-report-insights-grid">
            {/* Card 1: Strengths */}
            <article className="ai-report-card ai-insight-card card-strengths">
              <div className="ai-report-card-header">
                <div className="ai-report-icon-tile icon-tile-green" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </div>
                <div>
                  <h3 className="ai-insight-card-title">Key Strengths</h3>
                  <span className="ai-insight-card-subtitle">Observed in the available evidence</span>
                </div>
              </div>
              <ul className="ai-insight-items-list">
                {analysis.strengths.slice(0, 3).map((item, idx) => (
                  <li key={idx} className="ai-insight-item">
                    <span className="item-bullet bullet-green" aria-hidden="true">✓</span>
                    <p>{item.text}</p>
                  </li>
                ))}
                {!analysis.strengths.length && (
                  <li className="ai-insight-empty">No strengths recorded from the available evidence.</li>
                )}
              </ul>
            </article>

            {/* Card 2: Areas to Improve */}
            <article className="ai-report-card ai-insight-card card-growth">
              <div className="ai-report-card-header">
                <div className="ai-report-icon-tile icon-tile-amber" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <h3 className="ai-insight-card-title">Areas to Improve</h3>
                  <span className="ai-insight-card-subtitle">Constructive development focus</span>
                </div>
              </div>
              <ul className="ai-insight-items-list">
                {analysis.weaknesses.slice(0, 3).map((item, idx) => (
                  <li key={idx} className="ai-insight-item">
                    <span className="item-bullet bullet-amber" aria-hidden="true">•</span>
                    <p>{item.text}</p>
                  </li>
                ))}
                {!analysis.weaknesses.length && (
                  <li className="ai-insight-empty">No specific development areas identified in available evidence.</li>
                )}
              </ul>
            </article>

            {/* Card 3: Recommended Actions */}
            <article className="ai-report-card ai-insight-card card-actions">
              <div className="ai-report-card-header">
                <div className="ai-report-icon-tile icon-tile-blue" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <div>
                  <h3 className="ai-insight-card-title">Recommended Next Steps</h3>
                  <span className="ai-insight-card-subtitle">Practical ways to explore the evidence</span>
                </div>
              </div>
              <ul className="ai-insight-items-list">
                {analysis.recommendations.slice(0, 4).map((item, idx) => (
                  <li key={idx} className="ai-insight-item">
                    <span className="item-bullet bullet-blue" aria-hidden="true">→</span>
                    <p>{item.text}</p>
                  </li>
                ))}
                {!analysis.recommendations.length && (
                  <li className="ai-insight-empty">No immediate recommended actions returned.</li>
                )}
              </ul>
            </article>
          </div>
          </section>

          {analysis.roleRelevance && (
            <section className="ai-report-context-grid" aria-label="Role context">
              <article className="ai-report-context-card">
                <h2>Role Relevance</h2>
                <p>{analysis.roleRelevance}</p>
              </article>
            </section>
          )}

          {uniqueSourceDescriptions.length > 0 && (
            <details className="ai-report-sources-disclosure">
              <summary>View sources</summary>
              <ul>{uniqueSourceDescriptions.map((description, index) => <li key={index}>{description}</li>)}</ul>
            </details>
          )}
        </>
      )}
    </main>
  );
}
