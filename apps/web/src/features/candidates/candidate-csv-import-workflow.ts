import type { CandidateImportPreviewResponse } from '@devrank/contracts';

export type CandidateImportRequestLock = { current: boolean };

export function getCandidateImportRowsForSubmission<TCandidate>(
  rows: readonly { rowNumber: number; candidate?: TCandidate | null; errors: readonly string[] }[],
) {
  return rows.flatMap((row) => row.candidate && row.errors.length === 0
    ? [{ rowNumber: row.rowNumber, candidate: row.candidate }]
    : []);
}

export function acquireCandidateImportRequest(lock: CandidateImportRequestLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseCandidateImportRequest(lock: CandidateImportRequestLock) {
  lock.current = false;
}

export function candidateImportEligibility(
  totalRows: number,
  validRows: number,
  preview: CandidateImportPreviewResponse | null,
  previewIsCurrent: boolean,
  skipPotentialMatches: boolean,
) {
  const currentPreview = previewIsCurrent ? preview : null;
  const potentialMatches = currentPreview?.rows.filter((row) => row.status === 'duplicate').length ?? null;
  const eligibleRows = currentPreview
    ? skipPotentialMatches
      ? currentPreview.rows.filter((row) => row.status === 'ready').length
      : validRows
    : null;

  return {
    validRows,
    validationErrors: Math.max(0, totalRows - validRows),
    potentialMatches,
    eligibleRows,
  };
}

export function canConfirmCandidateImport(previewIsCurrent: boolean, busy: boolean, eligibleRows: number | null): boolean {
  return previewIsCurrent && !busy && eligibleRows !== null && eligibleRows > 0;
}

export function candidateImportPreviewIsCurrent(previewRevision: number | null, currentRevision: number): boolean {
  return previewRevision !== null && previewRevision === currentRevision;
}
