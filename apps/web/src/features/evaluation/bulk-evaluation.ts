export const ALL_CANDIDATES_ID = '__all_candidates__';

export type EvaluationCandidate = { id: string; name: string };
export type CandidateEvaluationState = 'pending' | 'evaluating' | 'completed' | 'failed' | 'skipped';
export type BulkEvaluationItem = {
  candidateId: string;
  candidateName: string;
  state: CandidateEvaluationState;
  evaluationId?: string;
  evaluationStatus?: 'completed' | 'insufficient_evidence';
  error?: string;
};
export type BulkEvaluationSnapshot = { completed: number; total: number; currentCandidateId?: string; results: BulkEvaluationItem[] };

export function bulkEvaluationStatusLabel(item: BulkEvaluationItem): string {
  if (item.state === 'failed') return 'Failed';
  if (item.state === 'skipped') return 'Skipped';
  if (item.state === 'pending') return 'Pending';
  if (item.state === 'evaluating') return 'Processing';
  return item.evaluationStatus === 'insufficient_evidence' ? 'Insufficient evidence' : 'Completed';
}

export function bulkEvaluationSummary(results: BulkEvaluationItem[]) {
  return {
    completed: results.filter(({ state }) => state === 'completed').length,
    failed: results.filter(({ state }) => state === 'failed').length,
    skipped: results.filter(({ state }) => state === 'skipped').length,
  };
}

export function candidateOptions(candidates: EvaluationCandidate[]) {
  return [{ id: ALL_CANDIDATES_ID, name: 'All Candidates' }, ...candidates];
}

export function acquireEvaluationRun(lock: { current: boolean }): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export async function runBulkEvaluations<TCandidate extends EvaluationCandidate>(
  candidates: TCandidate[],
  evaluate: (candidate: TCandidate) => Promise<{ id: string; status: 'completed' | 'insufficient_evidence' }>,
  explainFailure: (error: unknown) => string,
  onProgress: (snapshot: BulkEvaluationSnapshot) => void,
): Promise<BulkEvaluationItem[]> {
  let completed = 0;
  const results: BulkEvaluationItem[] = candidates.map((candidate) => ({ candidateId: candidate.id, candidateName: candidate.name, state: 'pending' }));
  onProgress({ completed, total: candidates.length, results: [...results] });

  for (const [index, candidate] of candidates.entries()) {
    results[index] = { candidateId: candidate.id, candidateName: candidate.name, state: 'evaluating' };
    onProgress({ completed, total: candidates.length, currentCandidateId: candidate.id, results: [...results] });
    try {
      const result = await evaluate(candidate);
      results[index] = { candidateId: candidate.id, candidateName: candidate.name, state: 'completed', evaluationId: result.id, evaluationStatus: result.status };
    } catch (error) {
      results[index] = { candidateId: candidate.id, candidateName: candidate.name, state: 'failed', error: explainFailure(error) };
    }
    completed += 1;
    onProgress({ completed, total: candidates.length, currentCandidateId: candidate.id, results: [...results] });
  }
  return results;
}
