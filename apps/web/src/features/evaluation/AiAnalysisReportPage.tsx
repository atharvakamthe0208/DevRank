import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { aiAnalysisResponseSchema, persistedEvaluationReadSchema, persistedEvaluationSchema, type AiAnalysisResponse, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { aiAnalysisErrorMessage, analysisEmptyMessage, analysisReferenceDescriptions } from './ai-analysis-presentation';
import './ai-analysis-report.css';

type CandidateSummary = { id: string; name: string };
type PageState = { status: 'loading' } | { status: 'error'; message: string } | {
  status: 'saved'; evaluation: PersistedEvaluationRead; candidate: CandidateSummary;
  response?: AiAnalysisResponse; analysisStatus: 'loading' | 'ready' | 'error' | 'unavailable'; analysisMessage?: string;
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
  const [attempt, setAttempt] = useState(0);
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
        setState({ status: 'saved', evaluation, candidate: { id: candidate.id, name: candidate.name }, analysisStatus: 'unavailable', analysisMessage: 'AI explanations are unavailable for this historical scoring version. View the original saved result below.' });
        return;
      }
      if (initialResponse) {
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name }, response: initialResponse, analysisStatus: 'ready' });
        return;
      }
      setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name }, analysisStatus: 'loading' });
      try {
        const response = aiAnalysisResponseSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({}), signal }, session.access_token));
        if (signal?.aborted) return;
        if (response.evaluation.id !== evaluationId) throw new Error('The analysis response did not match this evaluation.');
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name }, response, analysisStatus: 'ready' });
      } catch (error) {
        if (signal?.aborted) return;
        setState({ status: 'saved', evaluation: current.data, candidate: { id: candidate.id, name: candidate.name }, analysisStatus: 'error', analysisMessage: messageFor(error) });
      }
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: messageFor(error) });
    }
  }, [session?.access_token, evaluationId, initialResponse]);

  const retryAnalysis = useCallback(async () => {
    if (state.status !== 'saved' || !session?.access_token) return;
    const current = persistedEvaluationSchema.safeParse(state.evaluation);
    if (!current.success) return;
    const savedState = state;
    setState({ ...savedState, response: undefined, analysisStatus: 'loading', analysisMessage: undefined });
    try {
      const response = aiAnalysisResponseSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({}) }, session.access_token));
      if (response.evaluation.id !== evaluationId) throw new Error('The analysis response did not match this evaluation.');
      setState({ ...savedState, response, analysisStatus: 'ready', analysisMessage: undefined });
    } catch (error) {
      setState({ ...savedState, response: undefined, analysisStatus: 'error', analysisMessage: messageFor(error) });
    }
  }, [state, session?.access_token, evaluationId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, attempt]);

  if (state.status === 'loading') return <main className="ai-report-page"><p className="ai-report-state" role="status">Loading the saved evaluation…</p></main>;
  if (state.status === 'error') return <main className="ai-report-page"><section className="ai-report-state" role="alert"><span className="dashboard-kicker">EVALUATION REPORT</span><h1>Report unavailable</h1><p>{state.message}</p><button type="button" className="dashboard-secondary-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Back to evaluation</Link></section></main>;

  const currentEvaluation = persistedEvaluationSchema.safeParse(state.evaluation);
  if (!currentEvaluation.success && state.evaluation.result.schemaVersion === '4.0.0') return <main className="ai-report-page"><Link className="ai-report-back" to={`/evaluations/${evaluationId}`}>← Back to saved evaluation</Link><header className="ai-report-header"><div><span className="dashboard-kicker">EVALUATION STATUS</span><h1>{state.candidate.name}</h1><p>{state.evaluation.targetRole.replaceAll('_', ' ')} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.evaluation.createdAt))}</p></div><span className="ai-report-status report-incomplete">{state.evaluation.status.replaceAll('_', ' ')}</span></header><section className="ai-report-empty" role="status"><h2>Evaluation result unavailable</h2><p>This saved evaluation is {state.evaluation.status.replaceAll('_', ' ')} and has no completed score report.</p><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Open evaluation status</Link></section></main>;
  if (!currentEvaluation.success) return <main className="ai-report-page"><Link className="ai-report-back" to={`/evaluations/${evaluationId}`}>← Back to saved evaluation</Link><header className="ai-report-header"><div><span className="dashboard-kicker">HISTORICAL EVALUATION</span><h1>{state.candidate.name}</h1><p>{state.evaluation.targetRole.replaceAll('_', ' ')} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.evaluation.createdAt))}</p></div><span className={`ai-report-status${state.evaluation.status === 'completed' ? ' report-complete' : ' report-incomplete'}`}>{state.evaluation.status.replaceAll('_', ' ')}</span></header><section className="ai-report-score-panel" aria-label="Historical saved evaluation"><div><span className="dashboard-kicker">ORIGINAL SAVED RESULT · {state.evaluation.result.scoringVersion ?? state.evaluation.result.schemaVersion}</span><strong>{state.evaluation.result.overallScore === undefined ? 'Score not calculated' : `${state.evaluation.result.overallScore} / 100`}</strong><small>Historical values are shown in their original scoring format.</small></div></section><section className="ai-report-empty" role="status"><h2>AI explanation unavailable</h2><p>{state.analysisMessage}</p><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Open original evaluation and category results</Link></section></main>;

  return <AiAnalysisReportView response={state.response} evaluation={currentEvaluation.data} candidateName={state.candidate.name} analysisLoading={state.analysisStatus === 'loading'} analysisError={state.analysisStatus === 'error' ? state.analysisMessage : undefined} onRetry={() => void retryAnalysis()}/>;
}

export function AiAnalysisReportView({ response, evaluation: evaluationProp, candidateName, analysisLoading = false, analysisError, onRetry }: {
  response?: AiAnalysisResponse; evaluation?: PersistedEvaluation; candidateName: string; analysisLoading?: boolean; analysisError?: string; onRetry?: () => void;
}) {
  const evaluation = response?.evaluation ?? evaluationProp;
  if (!evaluation) return null;
  const result = evaluation.result;
  const analysis = response?.analysis;
  const emptyMessage = response ? analysisEmptyMessage(response) : undefined;
  const summaryReferences = analysis ? analysisReferenceDescriptions(evaluation, analysis.summaryEvidenceReferences) : [];
  const roleReferences = analysis ? analysisReferenceDescriptions(evaluation, analysis.roleRelevanceEvidenceReferences) : [];
  const observations = analysis ? [
    { title: 'Strengths', items: analysis.strengths },
    { title: 'Evidence gaps', items: analysis.weaknesses },
    { title: 'Recommendations', items: analysis.recommendations },
  ] : [];

  return <main className="ai-report-page">
    <Link className="ai-report-back" to={`/evaluations/${evaluation.id}`}>← Back to saved evaluation</Link>
    <header className="ai-report-header"><div><span className="dashboard-kicker">DETAILED EVALUATION REPORT</span><h1>{candidateName}</h1><p>{evaluation.targetRole.replaceAll('_', ' ')} · Saved {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(evaluation.createdAt))}</p></div><span className={`ai-report-status${evaluation.status === 'completed' ? ' report-complete' : ' report-incomplete'}`}>{evaluation.status === 'completed' ? 'Completed' : 'Insufficient evidence'}</span></header>
    <section className="ai-report-score-panel" aria-label="Saved deterministic evaluation score"><div><span className="dashboard-kicker">SAVED EVALUATION · {result.scoringVersion ?? result.schemaVersion}</span><strong>{result.overallScore === undefined ? 'Score not calculated' : `${result.overallScore} / 100`}</strong><small>{result.overallScore === undefined ? 'Insufficient evidence; no overall score was calculated.' : 'Deterministic score from the saved evaluation.'}</small></div><p>AI text below is explanatory only. It does not calculate or change scores.</p><Link className="dashboard-text-link" to={`/evaluations/${evaluation.id}`}>View six category results</Link></section>
    {analysisLoading && <section className="ai-report-state" role="status"><p>Requesting an AI explanation for this saved evaluation. The saved score above is already available.</p></section>}
    {analysisError && <section className="ai-report-ai-state" role="alert"><p>{analysisError} The saved evaluation above is unchanged.</p><button type="button" className="dashboard-secondary-button" onClick={onRetry}>Try again</button></section>}
    {emptyMessage || !analysis ? <section className="ai-report-empty" role="status"><h2>AI explanation unavailable</h2><p>{emptyMessage ?? (analysisLoading ? 'The explanation is being prepared.' : analysisError ? 'The explanation could not be loaded.' : 'No explanation is available for this evaluation.')}</p>{!analysisLoading && !analysisError && <p>The saved deterministic evaluation remains available. Missing evidence is not treated as a negative score.</p>}</section> : <>
      <section className="ai-report-section"><div className="ai-report-section-heading"><span className="dashboard-kicker">AI SUMMARY</span><h2>Summary</h2></div><p className="ai-report-lead">{analysis.summary}</p><ReferenceList references={summaryReferences}/></section>
      <section className="ai-report-section"><div className="ai-report-section-heading"><span className="dashboard-kicker">ROLE CONTEXT</span><h2>Role relevance · {evaluation.targetRole.replaceAll('_', ' ')}</h2></div><p>{analysis.roleRelevance}</p><ReferenceList references={roleReferences}/></section>
      <section className="ai-report-observation-grid">{observations.map(({ title, items }) => <article className="ai-report-section" key={title}><div className="ai-report-section-heading"><span className="dashboard-kicker">AI EXPLANATION</span><h2>{title}</h2></div>{items.length ? items.map((item, index) => <details className="ai-report-observation" key={`${title}-${index}`}><summary>{item.text}</summary><ReferenceList references={analysisReferenceDescriptions(evaluation, item.evidenceReferences)}/></details>) : <p className="ai-report-muted">No {title.toLowerCase()} were returned from the supplied evidence.</p>}</article>)}</section>
      <details className="ai-report-integrity"><summary>About this AI explanation</summary><p>Generated on request and not stored with the evaluation. It is grounded in the cited evidence, does not change saved scores, and does not make a hiring decision.</p></details>
    </>}
  </main>;
}

function ReferenceList({ references }: { references: string[] }) {
  return <details className="ai-report-reference-disclosure"><summary>Supporting references ({references.length})</summary>{references.length ? <ul className="ai-report-references">{references.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="ai-report-muted">No supporting evidence references were returned.</p>}</details>;
}
