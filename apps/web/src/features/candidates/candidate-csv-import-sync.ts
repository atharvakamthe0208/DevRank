import type { CandidateBulkImportResponse } from '@devrank/contracts';
import type { MappedCsvRow } from './candidate-csv-import';

export type ImportSyncPlatform = 'github' | 'leetcode';
export type ImportSyncCandidate = { rowNumber: number; candidateId: string; name: string; profile: string };
export type ImportSyncSkip = { rowNumber: number; name: string; reason: string };
export type ImportSyncOutcome = { rowNumber: number; name: string; status: 'synced' } | { rowNumber: number; name: string; status: 'failed'; message: string };

export function getImportSyncCandidates(
  result: CandidateBulkImportResponse,
  rows: MappedCsvRow[],
  platform: ImportSyncPlatform,
): { candidates: ImportSyncCandidate[]; skipped: ImportSyncSkip[] } {
  const outcomesByRow = new Map(result.results.map((outcome) => [outcome.rowNumber, outcome]));
  const candidates: ImportSyncCandidate[] = [];
  const skipped: ImportSyncSkip[] = [];
  for (const row of rows) {
    const outcome = outcomesByRow.get(row.rowNumber);
    const name = row.candidate?.name ?? `CSV row ${row.rowNumber}`;
    if (outcome?.status !== 'created' || !outcome.candidateId) {
      skipped.push({ rowNumber: row.rowNumber, name, reason: 'Candidate was not persisted by this import.' });
      continue;
    }
    const profile = row?.candidate?.[platform === 'github' ? 'githubUsername' : 'leetcodeUsername']?.trim();
    if (!profile) {
      skipped.push({ rowNumber: outcome.rowNumber, name, reason: `No usable ${platform === 'github' ? 'GitHub' : 'LeetCode'} username was provided.` });
      continue;
    }
    candidates.push({ rowNumber: outcome.rowNumber, candidateId: outcome.candidateId, name, profile });
  }
  return { candidates, skipped };
}

export function getImportSyncRetryCandidates(candidates: ImportSyncCandidate[], outcomes: ImportSyncOutcome[]): ImportSyncCandidate[] {
  if (!outcomes.length) return candidates;
  const failedRows = new Set(outcomes.filter((item) => item.status === 'failed').map((item) => item.rowNumber));
  return candidates.filter((candidate) => failedRows.has(candidate.rowNumber));
}

export async function runImportPlatformSync<T>(
  candidates: ImportSyncCandidate[],
  syncOne: (candidate: ImportSyncCandidate) => Promise<T>,
  onProgress: (completed: number, total: number) => void = () => undefined,
  concurrency = 2,
): Promise<ImportSyncOutcome[]> {
  const outcomes: ImportSyncOutcome[] = new Array(candidates.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= candidates.length) return;
      const candidate = candidates[index];
      try {
        await syncOne(candidate);
        outcomes[index] = { rowNumber: candidate.rowNumber, name: candidate.name, status: 'synced' };
      } catch (error) {
        outcomes[index] = { rowNumber: candidate.rowNumber, name: candidate.name, status: 'failed', message: error instanceof Error ? error.message : 'The sync request failed. Retry this candidate.' };
      } finally {
        completed += 1;
        onProgress(completed, candidates.length);
      }
    }
  }
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), candidates.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes;
}
