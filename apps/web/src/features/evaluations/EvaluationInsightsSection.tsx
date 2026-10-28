import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiAnalysisResponseSchema, type AiAnalysisResponse, type PersistedEvaluation } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { aiAnalysisErrorMessage } from '../evaluation/ai-analysis-presentation';
import { AiAnalysisRetryButton } from '../evaluation/AiAnalysisRetryButton';
import { AiAnalysisSummary } from '../evaluation/EvaluationPage';

type AnalysisState = {
  response?: AiAnalysisResponse;
  loading: boolean;
  error?: string;
  retryAt?: number;
};

export function EvaluationInsightsSection({ evaluation }: { evaluation: PersistedEvaluation }) {
  const { session } = useAuth();
  const requestActive = useRef(false);
  const [state, setState] = useState<AnalysisState>({ loading: false });

  async function generateAnalysis() {
    if (!session?.access_token || requestActive.current) return;
    requestActive.current = true;
    setState((current) => ({ ...current, loading: true, error: undefined, retryAt: undefined }));
    try {
      const response = aiAnalysisResponseSchema.parse(await apiRequest<unknown>(
        `/evaluations/${evaluation.id}/ai-analysis`,
        { method: 'POST', body: JSON.stringify({}) },
        session.access_token,
      ));
      if (response.evaluation.id !== evaluation.id || response.evaluation.candidateId !== evaluation.candidateId) {
        throw new Error('The analysis response did not match this evaluation.');
      }
      setState({ response, loading: false });
    } catch (error) {
      const retryAfter = error instanceof ApiRequestError ? error.retryAfterSeconds : undefined;
      setState((current) => ({
        ...current,
        loading: false,
        error: aiAnalysisErrorMessage(error),
        retryAt: retryAfter ? Date.now() + retryAfter * 1000 : undefined,
      }));
    } finally {
      requestActive.current = false;
    }
  }

  const analysisAvailable = state.response?.status === 'completed' && state.response.analysis !== null;
  return <EvaluationInsightsPanel
    evaluationId={evaluation.id}
    response={state.response}
    loading={state.loading}
    error={state.error}
    retryAt={state.retryAt}
    onGenerate={() => void generateAnalysis()}
    analysisAvailable={analysisAvailable}
  />;
}

export function EvaluationInsightsPanel({ evaluationId, response, loading, error, retryAt, onGenerate, analysisAvailable = false }: {
  evaluationId: string;
  response?: AiAnalysisResponse;
  loading: boolean;
  error?: string;
  retryAt?: number;
  onGenerate: () => void;
  analysisAvailable?: boolean;
}) {
  return <section className="ai-analysis" aria-labelledby="persisted-ai-analysis-title">
    <div className="ai-analysis-heading">
      <div className="ai-analysis-heading-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.35 5.65L19 10l-5.65 1.35L12 17l-1.35-5.65L5 10l5.65-1.35L12 3Z"/><path d="m19 16 .65 2.35L22 19l-2.35.65L19 22l-.65-2.35L16 19l2.35-.65L19 16Z"/></svg></div>
      <div>
        <div className="ai-analysis-title-row">
          <h2 id="persisted-ai-analysis-title">AI Candidate Insights</h2>
          <span className="ai-analysis-evidence-badge">Evidence-based</span>
        </div>
        <p>AI explanations are separate from the saved deterministic scores.</p>
      </div>
      <div className="ai-analysis-actions">
        <AiAnalysisRetryButton
          className="primary-button evaluation-ai-primary-action"
          onRetry={onGenerate}
          pending={loading}
          retryAt={retryAt}
          idleLabel={error ? 'Try again' : analysisAvailable ? 'Regenerate Analysis' : 'Generate AI analysis'}
        />
        {response && <Link className="ai-report-link ai-analysis-full-report-link" to={`/evaluations/${evaluationId}/analysis`} state={{ analysis: response }}>
          View full analysis <span aria-hidden="true">→</span>
        </Link>}
      </div>
    </div>
    {loading && <p className="ai-analysis-status" role="status">Preparing AI insights from this saved evaluation…</p>}
    {error && <div className="ai-analysis-error" role="alert"><p>{error}</p></div>}
    {response
      ? <AiAnalysisSummary response={response}/>
      : !loading && !error && <p className="ai-analysis-status" role="status">Generate insights when you are ready. This action does not change the saved evaluation.</p>}
  </section>;
}
