import { scoringCategories, type AiAnalysisResponse, type PersistedEvaluation } from '@devrank/contracts';
import { ApiRequestError } from '../../lib/api/client';
import { formatEvidenceDate, readableEvidenceLabel, readableProvenance } from './evidence-presentation';

export function aiAnalysisErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'AI_NOT_CONFIGURED') return 'AI analysis is not configured on the API yet. Ask the project administrator to configure its provider key.';
    if (error.code === 'AI_RATE_LIMITED') return error.retryAfterSeconds
      ? `The AI provider is rate limiting requests. Please wait ${error.retryAfterSeconds} second${error.retryAfterSeconds === 1 ? '' : 's'} before trying again.`
      : 'The AI provider is rate limiting requests. Please wait a little before trying again.';
    if (error.code === 'AI_UNAVAILABLE') return 'AI analysis is temporarily unavailable. Your saved evaluation score is unchanged. Please try again later.';
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
    if (evidence) descriptions.set(reference, `${readableProvenance(evidence.source)} · ${evidence.description}${evidence.observedAt ? ` · observed ${formatEvidenceDate(evidence.observedAt)}` : ''}`);
    const snapshot = evaluation.result.platformEvidence?.find(({ evidenceId }) => evidenceId === reference);
    if (snapshot) descriptions.set(reference, `${snapshot.source === 'github' ? 'GitHub' : 'LeetCode'} · ${readableEvidenceLabel(snapshot.evidenceType)} · ${readableProvenance(snapshot.provenance)} · ${snapshot.availability.replaceAll('_', ' ')} · saved ${formatEvidenceDate(snapshot.observedAt)}`);
  }
  return [...descriptions.values()];
}

export function analysisEmptyMessage(response: AiAnalysisResponse): string | undefined {
  if (response.status === 'insufficient_evidence' || !response.analysis) {
    return 'AI analysis is unavailable because this evaluation does not have sufficient verified evidence.';
  }
  return undefined;
}
