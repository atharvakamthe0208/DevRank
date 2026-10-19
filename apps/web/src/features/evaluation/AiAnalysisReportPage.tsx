import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { aiAnalysisResponseSchema, persistedEvaluationReadSchema, scoringCategories, type AiAnalysisResponse } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { aiAnalysisErrorMessage, analysisEmptyMessage, analysisReferenceDescriptions } from './ai-analysis-presentation';
import './ai-analysis-report.css';

type CandidateSummary = { id: string; name: string };
type PageState = { status: 'loading' } | { status: 'ready'; response: AiAnalysisResponse; candidate: CandidateSummary } | { status: 'error'; message: string };

function messageFor(error: unknown) {
  if (error instanceof ApiRequestError && error.status === 409) return 'This historical evaluation cannot be analyzed with the current scoring model.';
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
      const [evaluationValue, analysisValue] = await Promise.all([
        initialResponse ? Promise.resolve(initialResponse.evaluation) : apiRequest<unknown>(`/evaluations/${evaluationId}`, { signal }, session.access_token).then((value) => persistedEvaluationReadSchema.parse(value)),
        initialResponse ? Promise.resolve(initialResponse) : apiRequest<unknown>(`/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', body: JSON.stringify({}), signal }, session.access_token),
      ]);
      if (signal?.aborted) return;
      const response = aiAnalysisResponseSchema.parse(analysisValue);
      if (response.evaluation.id !== evaluationId) throw new Error('The analysis response did not match this evaluation.');
      if (evaluationValue.id !== evaluationId) throw new Error('The saved evaluation did not match this report.');
      const candidateValue = await apiRequest<unknown>(`/candidates/${evaluationValue.candidateId}`, { signal }, session.access_token);
      if (signal?.aborted) return;
      const candidate = parseCandidateApiResponse(candidateValue);
      if (!candidate) throw new Error('Candidate details could not be verified.');
      setState({ status: 'ready', response, candidate: { id: candidate.id, name: candidate.name } });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: messageFor(error) });
    }
  }, [session?.access_token, evaluationId, initialResponse]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, attempt]);

  if (state.status === 'loading') return <main className="ai-report-page"><p className="ai-report-state" role="status">Loading the saved evaluation and preparing its evidence-grounded explanation…</p></main>;
  if (state.status === 'error') return <main className="ai-report-page"><section className="ai-report-state" role="alert"><span className="dashboard-kicker">AI ANALYSIS</span><h1>Report unavailable</h1><p>{state.message}</p><button type="button" className="dashboard-secondary-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button><Link className="dashboard-text-link" to={`/evaluations/${evaluationId}`}>Back to evaluation</Link></section></main>;

  const { response, candidate } = state;
  return <AiAnalysisReportView response={response} candidateName={candidate.name}/>;
}

export function AiAnalysisReportView({ response, candidateName }: { response: AiAnalysisResponse; candidateName: string }) {
  const evaluation = response.evaluation;
  const result = evaluation.result;
  const analysis = response.analysis;
  const emptyMessage = analysisEmptyMessage(response);
  const summaryReferences = analysis ? analysisReferenceDescriptions(evaluation, analysis.summaryEvidenceReferences) : [];
  const roleReferences = analysis ? analysisReferenceDescriptions(evaluation, analysis.roleRelevanceEvidenceReferences) : [];
  const observations = analysis ? [
    { title: 'Strengths', items: analysis.strengths },
    { title: 'Evidence gaps', items: analysis.weaknesses },
    { title: 'Recommendations', items: analysis.recommendations },
  ] : [];

  return <main className="ai-report-page">
    <Link className="ai-report-back" to={`/evaluations/${evaluation.id}`}>← Back to saved evaluation</Link>
    <header className="ai-report-header"><div><span className="dashboard-kicker">EVIDENCE-GROUNDED EXPLANATION</span><h1>{candidateName}</h1><p>{evaluation.targetRole.replaceAll('_', ' ')} · Saved evaluation {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(evaluation.createdAt))}</p></div><span className={`ai-report-status${evaluation.status === 'completed' ? ' report-complete' : ' report-incomplete'}`}>{evaluation.status.replaceAll('_', ' ')}</span></header>
    <section className="ai-report-score-panel" aria-label="Deterministic evaluation overview"><div><span className="dashboard-kicker">DETERMINISTIC RESULT · {result.scoringVersion ?? result.schemaVersion}</span><strong>{result.overallScore === undefined ? 'Score unavailable' : `${result.overallScore} / 100`}</strong><small>{result.overallScore === undefined ? 'Insufficient evidence; no overall score was calculated.' : 'Saved score from the evaluation snapshot.'}</small></div><p>AI text below explains the saved evaluation. It does not calculate, change, or override scores.</p></section>
    <section className="ai-report-section" aria-labelledby="saved-categories-title"><div className="ai-report-section-heading"><span className="dashboard-kicker">SAVED EVALUATION</span><h2 id="saved-categories-title">Category results</h2></div><div className="ai-report-category-grid">{scoringCategories.map((category) => {
      const score = result.categoryScores.find((item) => item.categoryId === category.id);
      const available = score?.status === 'scored' && score.score !== undefined;
      return <article className="ai-report-category" key={category.id}><div><h3>{category.displayName}</h3><strong>{available ? `${score.score} / 100` : 'Not scored'}</strong></div>{available && <progress max="100" value={score.score} aria-label={`${category.displayName}: ${score.score} out of 100`}/>}<p>{score?.explanation ?? 'No category result was stored in this evaluation snapshot.'}</p></article>;
    })}</div></section>
    {emptyMessage || !analysis ? <section className="ai-report-empty" role="status"><h2>AI analysis unavailable</h2><p>{emptyMessage ?? 'No analysis was returned for this evaluation.'}</p><p>The saved deterministic evaluation remains available above. Missing evidence is not treated as a negative score.</p></section> : <>
      <section className="ai-report-section"><div className="ai-report-section-heading"><span className="dashboard-kicker">SUMMARY</span><h2>Executive summary</h2></div><p className="ai-report-lead">{analysis.summary}</p><ReferenceList references={summaryReferences}/></section>
      <section className="ai-report-section"><div className="ai-report-section-heading"><span className="dashboard-kicker">ROLE CONTEXT</span><h2>Role relevance · {evaluation.targetRole.replaceAll('_', ' ')}</h2></div><p>{analysis.roleRelevance}</p><ReferenceList references={roleReferences}/></section>
      <section className="ai-report-observation-grid">{observations.map(({ title, items }) => <article className="ai-report-section" key={title}><div className="ai-report-section-heading"><span className="dashboard-kicker">AI INTERPRETATION</span><h2>{title}</h2></div>{items.length ? items.map((item, index) => <details className="ai-report-observation" key={`${title}-${index}`} open={index === 0}><summary>{item.text}</summary><ReferenceList references={analysisReferenceDescriptions(evaluation, item.evidenceReferences)}/></details>) : <p className="ai-report-muted">No {title.toLowerCase()} were returned from the supplied evidence.</p>}</article>)}</section>
      <p className="ai-report-integrity">This AI explanation is generated on request and is not stored with the evaluation. It is grounded in the cited evidence, does not change saved scores, and does not make a hiring decision.</p>
    </>}
  </main>;
}

function ReferenceList({ references }: { references: string[] }) {
  return references.length ? <ul className="ai-report-references">{references.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="ai-report-muted">No supporting evidence references were returned.</p>;
}
