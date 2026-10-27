import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { evaluationResponseSchema, persistedEvaluationReadSchema, type Candidate, type EvaluationResponse, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { EvaluationResults } from './EvaluationResults';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useWorkspaceBreadcrumbLabels } from '../../components/layout/WorkspaceBreadcrumbContext';
import { LegacyEvaluationResults } from './LegacyEvaluationResults';
import './evaluation.css';

type Loaded = { candidate: Candidate; evaluation: PersistedEvaluationRead };
type State = { status: 'loading' } | { status: 'ready'; data: Loaded } | { status: 'error'; message: string; unsupported?: boolean };

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Could not load this evaluation. Check your connection and retry.';
}

function safeEvaluationReturn(value: unknown): string | null {
  return typeof value === 'string' && (/^\/candidates\/[0-9a-f-]{36}$/i.test(value) || /^\/evaluations(?:\?[^#]*)?$/.test(value)) ? value : null;
}

export function EvaluationResultPage() {
  const { evaluationId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const evaluationName = state.status === 'ready' ? `${state.data.candidate.name} · ${state.data.evaluation.targetRole.replaceAll('_', ' ')}` : undefined;
  useWorkspaceBreadcrumbLabels({ evaluationName });
  const returnTo = (location.state as { returnTo?: unknown; historyBackSteps?: unknown } | null)?.returnTo;
  const backPath = safeEvaluationReturn(returnTo) ?? '/evaluations';
  function backToParent(event: MouseEvent<HTMLAnchorElement>) {
    const steps = (location.state as { historyBackSteps?: unknown } | null)?.historyBackSteps;
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && safeEvaluationReturn(returnTo) && (steps === 1 || steps === 2)) {
      event.preventDefault();
      navigate(-steps);
    }
  }

  async function load(signal?: AbortSignal) {
    if (!session?.access_token) { setState({ status: 'error', message: 'Your secure session is unavailable. Sign in again.' }); return; }
    setState({ status: 'loading' });
    try {
      const persisted = persistedEvaluationReadSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}`, { signal }, session.access_token));
      const candidateResponse = await apiRequest<unknown>(`/candidates/${persisted.candidateId}`, { signal }, session.access_token);
      if (signal?.aborted) return;
      const candidate = parseCandidateApiResponse(candidateResponse);
      if (!candidate) throw new Error('Candidate details returned by the API were invalid.');
      if (persisted.result.schemaVersion === '4.0.0') {
        const result = evaluationResponseSchema.parse(persisted.result);
        setState({ status: 'ready', data: { candidate, evaluation: { ...persisted, result } as PersistedEvaluation } });
      } else {
        setState({ status: 'ready', data: { candidate, evaluation: persisted } });
      }
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [evaluationId, session?.access_token]);
  if (state.status === 'loading') return <main className="evaluation-page"><WorkspaceSkeleton variant="detail"/></main>;
  if (state.status === 'error') {
    return <main className="evaluation-page"><div className="evaluation-page-state" role="alert"><h1>{state.unsupported ? 'Historical evaluation' : 'Evaluation unavailable'}</h1><p>{state.message}</p>{!state.unsupported && <button className="primary-button" type="button" onClick={() => void load()}>Try again</button>}<Link className="secondary-button" to={backPath} replace onClick={backToParent}>Back</Link></div></main>;
  }
  return <>
    <Link className="back-link" to={backPath} replace onClick={backToParent}>← <span>Back</span></Link>
    {state.data.evaluation.result.schemaVersion === '4.0.0'
    ? <EvaluationResults candidate={state.data.candidate} evaluation={state.data.evaluation as PersistedEvaluation & { result: EvaluationResponse }}/>
    : <LegacyEvaluationResults candidate={state.data.candidate} evaluation={state.data.evaluation as Exclude<PersistedEvaluationRead, PersistedEvaluation>}/>}
  </>;
}
