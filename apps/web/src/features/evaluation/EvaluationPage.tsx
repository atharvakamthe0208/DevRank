import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  candidateListResponseSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  type Candidate,
  type EvaluationRole,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import './evaluation-page.css';

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

  return <div className="evaluation-page">
    <section className="evaluation-heading"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE ASSESSMENT</span><h1>Evaluation</h1><p className="page-subtitle">Review evidence against a role profile using DevRank’s deterministic scoring rules.</p></div><Link className="secondary-button evaluation-back-link" to="/dashboard/candidates">View candidates</Link></section>
    {pageState === 'loading' ? <section className="evaluation-panel evaluation-state" role="status">Loading candidates and supported roles…</section> : pageState === 'error' ? <section className="evaluation-panel evaluation-state" role="alert"><h2>Could not load evaluation setup</h2><p>{loadError}</p><button className="secondary-button" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</button></section> : <>
      <form className="evaluation-panel evaluation-form" onSubmit={(event) => void runEvaluation(event)}>
        <div className="evaluation-panel-heading"><div><h2>Choose an evaluation</h2><p>Select a candidate and the role you’re assessing them for.</p></div><span className="evaluation-rule-tag">Deterministic scoring</span></div>
        {candidates.length === 0 ? <div className="evaluation-empty"><h3>No candidates available</h3><p>Add a candidate before starting an evaluation.</p><Link className="primary-button link-button" to="/candidates/new">Add candidate</Link></div> : <div className="evaluation-select-grid">
          <label htmlFor="evaluation-candidate">Candidate<select id="evaluation-candidate" required disabled={running} value={candidateId} onChange={(event) => { setCandidateId(event.target.value); setResult(null); setRunError(''); }}><option value="">Choose a candidate</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          <label htmlFor="evaluation-role">Role<select id="evaluation-role" required disabled={running} value={roleId} onChange={(event) => { setRoleId(event.target.value as EvaluationRole['id']); setResult(null); setRunError(''); }}><option value="">Choose a role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>)}</select></label>
        </div>}
        {candidates.length > 0 && <div className="evaluation-form-footer"><p>Role weights are preliminary and require review before hiring use.</p><button className="primary-button" type="submit" disabled={running || !candidateId || !roleId}>{running ? 'Running evaluation…' : 'Run Evaluation'}</button></div>}
        {running && <p className="evaluation-progress" role="status">Verifying candidate access and calculating available evidence…</p>}
        {runError && <p className="form-feedback form-feedback-error" role="alert">{runError}</p>}
      </form>
      {result && <EvaluationResult result={result}/>}
    </>}
  </div>;
}

function EvaluationResult({ result }: { result: EvaluationRunResponse }) {
  const evaluation = result.evaluation;
  return <section className="evaluation-results" aria-labelledby="evaluation-results-title">
    <div className="evaluation-result-top"><div><span className="eyebrow"><span className="eyebrow-line"/> EVALUATION RESULT</span><h2 id="evaluation-results-title">{result.candidate.name}</h2><p>{result.role.displayName} · Evaluated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.evaluatedAt))}</p></div><div className={`overall-score${evaluation.overallScore === undefined ? ' is-pending' : ''}`}><span>Overall score</span><strong>{evaluation.overallScore === undefined ? '—' : evaluation.overallScore}</strong><small>{evaluation.overallScore === undefined ? 'Insufficient evidence' : 'out of 100'}</small></div></div>
    <div className="evaluation-categories">{evaluation.categoryScores.map((category) => <article className="evaluation-category" key={category.categoryId}><div className="evaluation-category-heading"><h3>{category.displayName}</h3><strong>{category.score === undefined ? 'Not scored' : `${category.score} / 100`}</strong></div>{category.score !== undefined && <progress max="100" value={category.score} aria-label={`${category.displayName} score ${category.score} out of 100`}/>}<p>{category.explanation}</p><small>{category.status === 'scored' ? `${category.evidenceRefs.length} supporting evidence item${category.evidenceRefs.length === 1 ? '' : 's'}` : 'Insufficient evidence'}</small></article>)}</div>
    <div className="evaluation-limitations"><h3>Evidence limitations</h3><ul>{result.evidenceLimitations.map((item) => <li key={item}>{item}</li>)}</ul><p>{evaluation.calculationExplanation}</p></div>
    <p className="evaluation-disclaimer">{evaluation.decisionSupportNotice} Role weights are preliminary and have not been approved as hiring criteria.</p>
  </section>;
}
