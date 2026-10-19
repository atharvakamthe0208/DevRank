import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  aiAnalysisResponseSchema,
  candidateListResponseSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  type Candidate,
  type AiAnalysisResponse,
  type EvaluationRole,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { aiAnalysisErrorMessage, analysisEmptyMessage, analysisReferenceDescriptions } from './ai-analysis-presentation';
import './evaluation-page.css';
import '../evaluations/evaluation.css';

type PageState = 'loading' | 'ready' | 'error';

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

export function EvaluationPage() {
  const { session } = useAuth();
  const [searchParams] = useSearchParams();
  const preselectedCandidateId = searchParams.get('candidateId') ?? '';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const [candidateId, setCandidateId] = useState(preselectedCandidateId);
  const [roleId, setRoleId] = useState<EvaluationRole['id'] | ''>('');
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState<EvaluationRunResponse | null>(null);
  const [analysis, setAnalysis] = useState<AiAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

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
        setCandidateId((current) => candidateItems.some(({ id }) => id === current)
          ? current
          : candidateItems.some(({ id }) => id === preselectedCandidateId) ? preselectedCandidateId : '');
        setRoleId((current) => parsedRoles.roles.some(({ id }) => id === current)
          ? current
          : parsedRoles.roles[0]?.id || '');
        setPageState('ready');
      } catch (error) {
        if (!active) return;
        setPageState('error');
        setLoadError(explainError(error));
      }
    }
    void load();
    return () => { active = false; };
  }, [session?.access_token, preselectedCandidateId, loadAttempt]);

  async function runEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runningRef.current) return;
    setResult(null);
    setAnalysis(null);
    setAnalysisError('');
    setRunError('');
    if (!candidateId || !candidates.some(({ id }) => id === candidateId)) {
      setRunError('Choose a candidate from your workspace.');
      return;
    }
    if (!roleId || !roles.some(({ id }) => id === roleId)) {
      setRunError('Choose a supported role.');
      return;
    }
    if (!session?.access_token) {
      setRunError('Your secure session expired. Sign in again to run an evaluation.');
      return;
    }
    runningRef.current = true;
    setRunning(true);
    try {
      const response = await apiRequest<unknown>('/evaluations', {
        method: 'POST',
        body: JSON.stringify({ candidateId, roleId }),
      }, session.access_token);
      const parsed = evaluationRunResponseSchema.parse(response);
      if (parsed.candidate.id !== candidateId || parsed.role.id !== roleId) {
        throw new Error('The evaluation response did not match the selected candidate and role.');
      }
      setResult(parsed);
    } catch (error) {
      setRunError(explainError(error));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function loadAiAnalysis() {
    if (!result || !session?.access_token || analysisLoading) return;
    setAnalysis(null);
    setAnalysisError('');
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
    } finally {
      setAnalysisLoading(false);
    }
  }

  return <div className="evaluation-page">
    <section className="evaluation-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE ASSESSMENT</span><h1>Evaluation</h1><p className="page-subtitle">Evaluate saved GitHub and LeetCode evidence using the active six-category v4 rubric.</p></div><Link className="secondary-button evaluation-back-link" to="/dashboard/candidates">View candidates</Link></section>
    {pageState === 'loading' ? <section className="evaluation-panel evaluation-state" role="status">Loading candidates and supported roles…</section> : pageState === 'error' ? <section className="evaluation-panel evaluation-state" role="alert"><h2>Could not load evaluation setup</h2><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></section> : <>
      <form className="evaluation-panel evaluation-form" onSubmit={(event) => void runEvaluation(event)}>
        <div className="evaluation-panel-heading"><div><h2>Run final rubric evaluation</h2><p>Select a candidate and role. Scores use the candidate’s saved provider snapshots.</p></div><span className="evaluation-rule-tag">Active rubric · v4</span></div>
        {candidates.length === 0 ? <div className="evaluation-empty"><h3>No candidates available</h3><p>Add a candidate before starting an evaluation.</p><Link className="primary-button link-button" to="/candidates/new">Add candidate</Link></div> : <div className="evaluation-select-grid">
          <label htmlFor="evaluation-candidate">Candidate<select id="evaluation-candidate" required disabled={running} value={candidateId} onChange={(event) => { setCandidateId(event.target.value); setResult(null); setRunError(''); }}><option value="">Choose a candidate</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          <label htmlFor="evaluation-role">Role<select id="evaluation-role" required disabled={running} value={roleId} onChange={(event) => { setRoleId(event.target.value as EvaluationRole['id']); setResult(null); setRunError(''); }}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select></label>
        </div>}
        {candidates.length > 0 && <div className="evaluation-form-footer"><p>Weights: Project Portfolio 20%, Technical Skills 20%, Development Activity 15%, Collaboration 10%, Current-Year Contributions 10%, DSA &amp; Problem-Solving 25%.</p><button className="primary-button" type="submit" disabled={running || !candidateId || !roleId}>{running ? 'Running evaluation…' : 'Run Evaluation'}</button></div>}
        {running && <p className="evaluation-progress" role="status">Verifying candidate access and calculating available evidence…</p>}
        {runError && <p className="form-feedback form-feedback-error" role="alert">{runError}</p>}
      </form>
      {result && <EvaluationRunResult result={result} analysis={analysis} analysisLoading={analysisLoading} analysisError={analysisError} onAnalyze={() => void loadAiAnalysis()}/>}
    </>}
  </div>;
}

export function EvaluationRunResult({ result, analysis, analysisLoading, analysisError, onAnalyze }: {
  result: EvaluationRunResponse;
  analysis: AiAnalysisResponse | null;
  analysisLoading: boolean;
  analysisError: string;
  onAnalyze: () => void;
}) {
  const evaluation = result.evaluation;
  return <section className="evaluation-results" aria-labelledby="evaluation-results-title">
    <div className="evaluation-result-top"><div><span className="eyebrow"><span className="eyebrow-line"/> EVALUATION RESULT</span><h2 id="evaluation-results-title">{result.candidate.name}</h2><p>{result.role.displayName} · Evaluated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.evaluatedAt))}</p></div><div className={`overall-score${evaluation.overallScore === undefined ? ' is-pending' : ''}`}><span>Overall score</span><strong>{evaluation.overallScore === undefined ? '—' : evaluation.overallScore}</strong><small>{evaluation.overallScore === undefined ? 'Insufficient evidence' : 'out of 100'}</small></div></div>
    <section aria-labelledby="active-v4-categories-title">
      <div className="evaluation-section-heading"><div><h2 id="active-v4-categories-title">Evaluation report</h2></div></div>
      <div className="evaluation-categories">{evaluation.categoryScores.map((category) => <article className="evaluation-category" key={category.categoryId}><div className="evaluation-category-heading"><h3>{category.displayName}</h3><strong>{category.score === undefined ? 'Not scored' : `${category.score} / 100`}</strong></div>{category.score !== undefined && <progress max="100" value={category.score} aria-label={`${category.displayName} score ${category.score} out of 100`}/>}<p>{category.explanation}</p><small>{category.status === 'scored' ? `${category.evidenceRefs.length} supporting evidence item${category.evidenceRefs.length === 1 ? '' : 's'}` : 'Insufficient evidence'}</small></article>)}</div>
    </section>
    <div className="evaluation-limitations"><h3>Evidence limitations</h3><ul>{result.evidenceLimitations.map((item) => <li key={item}>{item}</li>)}</ul><p>{evaluation.calculationExplanation}</p></div>
    <p className="evaluation-disclaimer">{evaluation.decisionSupportNotice} The v4 indexes measure source volume and breadth, not engineering quality or candidate identity.</p>
    <section className="ai-analysis" aria-labelledby="ai-analysis-title">
      <div className="ai-analysis-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> EVIDENCE-GROUNDED EXPLANATION</span><h3 id="ai-analysis-title">AI analysis</h3><p>Explanatory support only. The persisted evaluation scores remain authoritative.</p></div><button className="secondary-button" type="button" onClick={onAnalyze} disabled={analysisLoading}>{analysisLoading ? 'Analyzing…' : analysis ? 'Regenerate analysis' : 'Generate AI analysis'}</button></div>
      {analysisLoading && <p className="ai-analysis-status" role="status">Reviewing the saved evaluation and its supporting evidence…</p>}
      {analysisError && <div className="ai-analysis-error" role="alert"><p>{analysisError}</p><button className="text-button" type="button" onClick={onAnalyze} disabled={analysisLoading}>Try again</button></div>}
      {analysis && <AiAnalysisSummary response={analysis}/>}
    </section>
  </section>;
}

function AnalysisReferences({ evaluation, references }: { evaluation: AiAnalysisResponse['evaluation']; references: string[] }) {
  const descriptions = analysisReferenceDescriptions(evaluation, references);
  return descriptions.length > 0 ? <ul className="ai-analysis-references">{descriptions.map((description) => <li key={description}>{description}</li>)}</ul> : <p className="ai-analysis-no-references">No supporting evidence references were returned for this item.</p>;
}

export function AiAnalysisSummary({ response }: { response: AiAnalysisResponse }) {
  const unavailable = analysisEmptyMessage(response);
  if (unavailable || !response.analysis) return <div className="ai-analysis-unavailable" role="status"><p>{unavailable}</p><Link className="ai-report-link" to={`/evaluations/${response.evaluation.id}/analysis`} state={{ analysis: response }}>Open evaluation report →</Link></div>;
  const { analysis } = response;
  return <div className="ai-analysis-content">
    <article className="ai-analysis-summary"><h4>Executive summary</h4><p>{analysis.summary}</p><AnalysisReferences evaluation={response.evaluation} references={analysis.summaryEvidenceReferences}/></article>
    <div className="ai-analysis-preview-grid"><article><h4>Evidence-backed strengths</h4>{analysis.strengths.length ? <ul>{analysis.strengths.slice(0, 3).map((item, index) => <li key={index}>{item.text}</li>)}</ul> : <p className="ai-analysis-empty">No strengths were returned from the supplied evidence.</p>}</article><article><h4>Evidence gaps</h4>{analysis.weaknesses.length ? <ul>{analysis.weaknesses.slice(0, 3).map((item, index) => <li key={index}>{item.text}</li>)}</ul> : <p className="ai-analysis-empty">No evidence gaps were returned.</p>}</article></div>
    <Link className="ai-report-link" to={`/evaluations/${response.evaluation.id}/analysis`} state={{ analysis }}>Read full AI report <span aria-hidden="true">→</span></Link>
    <p className="ai-analysis-disclaimer">AI-generated explanation grounded in the cited evaluation evidence. It does not change scores or make a hiring decision.</p>
  </div>;
}
