import { describe, expect, it, vi } from 'vitest';
import { acquireEvaluationRun, ALL_CANDIDATES_ID, bulkEvaluationStatusLabel, bulkEvaluationSummary, candidateOptions, runBulkEvaluations } from './bulk-evaluation';

const candidates = [
  { id: 'candidate-1', name: 'Ada Example' },
  { id: 'candidate-2', name: 'Grace Example' },
  { id: 'candidate-3', name: 'Lin Example' },
];

describe('bulk evaluation flow', () => {
  it('places All Candidates first and keeps all individual candidate choices', () => {
    expect(candidateOptions(candidates)).toEqual([{ id: ALL_CANDIDATES_ID, name: 'All Candidates' }, ...candidates]);
  });

  it('evaluates candidates sequentially and retains insufficient-evidence results as successful evaluations', async () => {
    const evaluate = vi.fn(async (candidate: (typeof candidates)[number]) => ({
      id: `evaluation-${candidate.id}`,
      status: candidate.id === 'candidate-2' ? 'insufficient_evidence' as const : 'completed' as const,
    }));
    const snapshots: number[] = [];
    const results = await runBulkEvaluations(candidates, evaluate, () => 'failed', (snapshot) => snapshots.push(snapshot.completed));
    expect(evaluate.mock.calls.map(([candidate]) => candidate.id)).toEqual(candidates.map(({ id }) => id));
    expect(results.map(({ state }) => state)).toEqual(['completed', 'completed', 'completed']);
    expect(results[1]).toMatchObject({ evaluationStatus: 'insufficient_evidence', evaluationId: 'evaluation-candidate-2' });
    expect(snapshots.at(-1)).toBe(3);
  });

  it('continues after one candidate fails and records each outcome', async () => {
    const evaluate = vi.fn(async (candidate: (typeof candidates)[number]) => {
      if (candidate.id === 'candidate-2') throw new Error('candidate lookup failed');
      return { id: `evaluation-${candidate.id}`, status: 'completed' as const };
    });
    const results = await runBulkEvaluations(candidates, evaluate, (error) => String(error), () => undefined);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(results.map(({ state }) => state)).toEqual(['completed', 'failed', 'completed']);
    expect(results[1]?.error).toContain('candidate lookup failed');
  });

  it('returns an empty summary without calling the API when there are no candidates', async () => {
    const evaluate = vi.fn();
    const results = await runBulkEvaluations([], evaluate, () => 'failed', () => undefined);
    expect(results).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps insufficient evidence distinct from technical failure in candidate rows', () => {
    expect(bulkEvaluationStatusLabel({ candidateId: '1', candidateName: 'Ada', state: 'completed', evaluationStatus: 'insufficient_evidence' })).toBe('Insufficient evidence');
    expect(bulkEvaluationStatusLabel({ candidateId: '2', candidateName: 'Grace', state: 'failed', error: 'Unavailable' })).toBe('Failed');
    expect(bulkEvaluationStatusLabel({ candidateId: '3', candidateName: 'Lin', state: 'completed', evaluationStatus: 'completed' })).toBe('Completed');
    expect(bulkEvaluationStatusLabel({ candidateId: '4', candidateName: 'Margaret', state: 'skipped' })).toBe('Skipped');
  });

  it('summarizes saved, failed, and skipped outcomes without counting pending work as complete', () => {
    expect(bulkEvaluationSummary([
      { candidateId: '1', candidateName: 'Ada', state: 'completed', evaluationStatus: 'insufficient_evidence' },
      { candidateId: '2', candidateName: 'Grace', state: 'failed' },
      { candidateId: '3', candidateName: 'Lin', state: 'skipped' },
      { candidateId: '4', candidateName: 'Margaret', state: 'pending' },
    ])).toEqual({ completed: 1, failed: 1, skipped: 1 });
  });

  it('prevents duplicate submissions while a run is active and releases the lock afterward', () => {
    const lock = { current: false };
    expect(acquireEvaluationRun(lock)).toBe(true);
    expect(acquireEvaluationRun(lock)).toBe(false);
    lock.current = false;
    expect(acquireEvaluationRun(lock)).toBe(true);
  });
});
