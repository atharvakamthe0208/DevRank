import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { evaluationResponseSchema, persistedEvaluationSchema, type Candidate, type EvaluationResponse, type PersistedEvaluation } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { EvaluationResults } from './EvaluationResults';
import './evaluation.css';

type Loaded = { candidate: Candidate; evaluation: PersistedEvaluation & { result: EvaluationResponse } };
type State = { status: 'loading' } | { status: 'ready'; data: Loaded } | { status: 'error'; message: string; unsupported?: boolean };

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Could not load this evaluation. Check your connection and retry.';
}

export function EvaluationResultPage() {
  const { evaluationId = '' } = useParams();
  const { session } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  async function load(signal?: AbortSignal) {
    if (!session?.access_token) { setState({ status: 'error', message: 'Your secure session is unavailable. Sign in again.' }); return; }
    setState({ status: 'loading' });
    try {
      const persisted = persistedEvaluationSchema.parse(await apiRequest<unknown>(`/evaluations/${evaluationId}`, { signal }, session.access_token));
      const result = evaluationResponseSchema.safeParse(persisted.result);
      if (!result.success) { setState({ status: 'error', message: 'This saved evaluation uses an older scoring format and cannot be displayed as a current five-category result.', unsupported: true }); return; }
      const candidateResponse = await apiRequest<unknown>(`/candidates/${persisted.candidateId}`, { signal }, session.access_token);
      if (signal?.aborted) return;
      const candidate = parseCandidateApiResponse(candidateResponse);
      if (!candidate) throw new Error('Candidate details returned by the API were invalid.');
      setState({ status: 'ready', data: { candidate, evaluation: { ...persisted, result: result.data } } });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: errorMessage(error) });
    }
  }

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [evaluationId, session?.access_token]);
  if (state.status === 'loading') return <main className="evaluation-page"><div className="evaluation-page-state" role="status">Loading saved evaluation…</div></main>;
  if (state.status === 'error') return <main className="evaluation-page"><div className="evaluation-page-state" role="alert"><h1>{state.unsupported ? 'Historical evaluation' : 'Evaluation unavailable'}</h1><p>{state.message}</p>{!state.unsupported && <button className="primary-button" type="button" onClick={() => void load()}>Try again</button>}<Link className="secondary-button" to="/dashboard/candidates">Back to candidates</Link></div></main>;
  return <EvaluationResults candidate={state.data.candidate} evaluation={state.data.evaluation}/>;
}
