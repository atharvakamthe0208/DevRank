import { scoringCategories, type AiAnalysisResponse, type PersistedEvaluation } from '@devrank/contracts';
import { ApiRequestError } from '../../lib/api/client';

export function aiAnalysisErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AI_NOT_CONFIGURED') return 'AI analysis is not configured on the API yet. Ask the project administrator to configure its provider key.';
    if (error.code === 'AI_INVALID_RESPONSE') return 'The AI service returned an analysis that could not be verified. Try again.';
    if (error.status === 401) return 'Your session expired. Sign in again to continue.';
    if (error.status === 403) return 'Recruiter access is not approved for this workspace.';
    if (error.status === 404) return 'This evaluation is no longer available in your workspace.';
    return error.message;
  }
  if (error instanceof Error && error.name === 'ApiNetworkError') return error.message;
  return 'AI analysis could not be loaded. Check your connection and try again.';
}

export function analysisReferenceDescriptions(evaluation: PersistedEvaluation, references: string[]): string[] {
  const descriptions = new Map<string, string>();
  for (const reference of references) {
    const category = evaluation.result.categoryScores.find(({ categoryId }) => categoryId === reference);
    if (category) {
      const canonical = scoringCategories.find(({ id }) => id === category.categoryId);
      descriptions.set(reference, `${canonical?.displayName ?? category.displayName}: ${category.explanation}`);
      continue;
    }
    const evidence = evaluation.result.evidence.find(({ evidenceId }) => evidenceId === reference);
    if (evidence) descriptions.set(reference, `${evidence.source} · ${evidence.description}`);
  }
  return [...descriptions.values()];
}

export function analysisEmptyMessage(response: AiAnalysisResponse): string | undefined {
  if (response.status === 'insufficient_evidence' || !response.analysis) {
    return 'AI analysis is unavailable because this evaluation does not have sufficient verified evidence.';
  }
  return undefined;
}
