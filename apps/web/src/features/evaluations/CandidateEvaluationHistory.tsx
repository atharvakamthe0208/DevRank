import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { candidateEvaluationsResponseSchema, type PersistedEvaluationRead } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import './evaluation.css';
import './candidate-evaluation-history.css';

function roleLabel(value: string): string { return value.replaceAll('_', ' '); }
function dateLabel(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)); }

export function CandidateEvaluationHistory({ candidateId }: { candidateId: string }) {
  const { session } = useAuth();
  const [items, setItems] = useState<PersistedEvaluationRead[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!session?.access_token) { setError('Your secure session is unavailable. Sign in again.'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      const response = candidateEvaluationsResponseSchema.parse(await apiRequest<unknown>(`/candidates/${candidateId}/evaluations`, { signal }, session.access_token));
      setItems(response.items); setState('ready');
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof ApiRequestError ? cause.message : cause instanceof Error ? cause.message : 'Could not load saved evaluations.');
      setState('error');
    }
  }, [candidateId, session?.access_token]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  function evaluationLink(item: PersistedEvaluationRead) {
      const score = 'overallScore' in item.result ? item.result.overallScore : undefined;
      const statusLabel = 'evaluationStatus' in item.result
        ? item.result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'
        : item.status.replaceAll('_', ' ');
      const isComplete = statusLabel === 'Completed';
      return <Link to={`/evaluations/${item.id}`}><span><strong>{roleLabel(item.result.targetRole)}</strong><small>{dateLabel(item.createdAt)}</small></span><span className={`evaluation-status ${isComplete ? 'is-complete' : 'is-incomplete'}`}>{statusLabel}</span><strong className="history-score">{score === undefined ? 'No overall score' : `${score}/100`}</strong><span aria-hidden="true">→</span></Link>;
  }
  return <section className="detail-section evaluation-history" aria-labelledby="evaluation-history-title"><div className="section-heading"><div><h2 id="evaluation-history-title">Latest evaluation</h2><p>Most recent saved result</p></div></div>
    {state === 'loading' ? <p className="evaluation-history-state" role="status">Loading saved evaluations…</p> : state === 'error' ? <div className="evaluation-history-state" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => void load()}>Try again</button></div> : items.length === 0 ? <p className="evaluation-history-state">No evaluations have been saved yet.</p> : <>
      <ul className="evaluation-history-list latest-evaluation-list"><li>{evaluationLink(items[0])}</li></ul>
      {items.length > 1 && <details className="older-evaluations"><summary>Older evaluations ({items.length - 1})</summary><ul className="evaluation-history-list">{items.slice(1).map((item) => <li key={item.id}>{evaluationLink(item)}</li>)}</ul></details>}
    </>}
  </section>;
}
