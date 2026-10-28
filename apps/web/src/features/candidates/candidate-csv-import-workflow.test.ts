import { describe, expect, it } from 'vitest';
import { candidateImportEligibility, candidateImportPreviewIsCurrent, canConfirmCandidateImport, acquireCandidateImportRequest, getCandidateImportRowsForSubmission, releaseCandidateImportRequest } from './candidate-csv-import-workflow';
import type { CandidateImportPreviewResponse } from '@devrank/contracts';

const preview: CandidateImportPreviewResponse = { rows: [
  { rowNumber: 2, status: 'ready', potentialDuplicate: false, candidateId: null },
  { rowNumber: 3, status: 'duplicate', potentialDuplicate: true, candidateId: '00000000-0000-4000-8000-000000000001' },
] };

describe('candidate CSV import review and confirmation workflow', () => {
  it('keeps import unavailable until a successful current duplicate preview exists', () => {
    const beforeCheck = candidateImportEligibility(3, 2, null, false, true);
    expect(beforeCheck).toEqual({ validRows: 2, validationErrors: 1, potentialMatches: null, eligibleRows: null });
    expect(canConfirmCandidateImport(false, false, beforeCheck.eligibleRows)).toBe(false);
    expect(candidateImportPreviewIsCurrent(null, 0)).toBe(false);

    expect(candidateImportPreviewIsCurrent(0, 0)).toBe(true);
    expect(candidateImportPreviewIsCurrent(0, 1)).toBe(false);
  });

  it('counts matches and applies the skip preference without treating validation errors as valid rows', () => {
    expect(candidateImportEligibility(3, 2, preview, true, true)).toEqual({
      validRows: 2, validationErrors: 1, potentialMatches: 1, eligibleRows: 1,
    });
    expect(candidateImportEligibility(3, 2, preview, true, false)).toEqual({
      validRows: 2, validationErrors: 1, potentialMatches: 1, eligibleRows: 2,
    });
    expect(canConfirmCandidateImport(true, false, 1)).toBe(true);
  });

  it('disables import when all valid rows are potential matches and skipping is enabled', () => {
    const allMatches: CandidateImportPreviewResponse = { rows: preview.rows.map((row) => ({ ...row, status: 'duplicate' as const, potentialDuplicate: true })) };
    const summary = candidateImportEligibility(2, 2, allMatches, true, true);
    expect(summary.eligibleRows).toBe(0);
    expect(canConfirmCandidateImport(true, false, summary.eligibleRows)).toBe(false);
  });

  it('ignores failed or stale preview values instead of treating them as zero matches', () => {
    expect(candidateImportEligibility(2, 2, preview, false, true)).toEqual({
      validRows: 2, validationErrors: 0, potentialMatches: null, eligibleRows: null,
    });
    expect(canConfirmCandidateImport(true, true, 2)).toBe(false);
  });

  it('locks duplicate requests against repeated clicks and releases for retry', () => {
    const lock = { current: false };
    expect(acquireCandidateImportRequest(lock)).toBe(true);
    expect(acquireCandidateImportRequest(lock)).toBe(false);
    releaseCandidateImportRequest(lock);
    expect(acquireCandidateImportRequest(lock)).toBe(true);
  });

  it('submits only rows without validation errors', () => {
    const validCandidate = { name: 'Ari Stone' };
    expect(getCandidateImportRowsForSubmission([
      { rowNumber: 2, candidate: validCandidate, errors: [] },
      { rowNumber: 3, candidate: { name: '' }, errors: ['Candidate name is required.'] },
      { rowNumber: 4, errors: ['Candidate data is invalid.'] },
    ])).toEqual([{ rowNumber: 2, candidate: validCandidate }]);
  });
});
