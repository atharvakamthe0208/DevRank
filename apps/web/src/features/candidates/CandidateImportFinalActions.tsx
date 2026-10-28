import type { ReactNode } from 'react';
import { canConfirmCandidateImport } from './candidate-csv-import-workflow';

export type CandidateImportEligibility = {
  validRows: number;
  validationErrors: number;
  potentialMatches: number | null;
  eligibleRows: number | null;
};

export function CandidateImportFinalActions({
  eligibility,
  previewIsCurrent,
  skipPotentialMatches,
  onSkipPotentialMatchesChange,
  busy,
  checkingDuplicates,
  importing,
  importingLabel,
  importFailed,
  confirmBlocked,
  resumeOptions,
  onConfirm,
  onCancel,
}: {
  eligibility: CandidateImportEligibility;
  previewIsCurrent: boolean;
  skipPotentialMatches: boolean;
  onSkipPotentialMatchesChange: (checked: boolean) => void;
  busy: boolean;
  checkingDuplicates: boolean;
  importing: boolean;
  importingLabel: string;
  importFailed: boolean;
  confirmBlocked: boolean;
  resumeOptions?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const canConfirm = canConfirmCandidateImport(previewIsCurrent, busy, eligibility.eligibleRows) && !confirmBlocked;

  return <section className="candidate-import-final-actions" aria-labelledby="candidate-import-final-title">
    <h3 id="candidate-import-final-title">Import summary</h3>
    <dl className="candidate-import-summary">
      <div><dt>Valid rows</dt><dd>{eligibility.validRows}</dd></div>
      <div><dt>Rows with validation errors</dt><dd>{eligibility.validationErrors}</dd></div>
      <div><dt>Potential matches</dt><dd>{eligibility.potentialMatches === null ? 'Check duplicates first' : eligibility.potentialMatches}</dd></div>
      <div><dt>Expected rows to create</dt><dd>{eligibility.eligibleRows === null ? 'Not ready' : eligibility.eligibleRows}</dd></div>
    </dl>
    <p className="candidate-import-final-explanation">Potential matches use exact, case-insensitive email or profile-handle matches within your workspace. Names are not unique identifiers, and existing candidates are never overwritten. {skipPotentialMatches ? 'Potential matches will be skipped.' : 'Potential matches will be submitted for the server to recheck.'}</p>
    <label className="candidate-import-skip-matches"><input type="checkbox" checked={skipPotentialMatches} onChange={(event) => onSkipPotentialMatchesChange(event.currentTarget.checked)} disabled={busy || !previewIsCurrent}/> Skip potential matches (recommended)</label>
    {!previewIsCurrent && <p className="candidate-import-final-guidance" role="status">Check duplicates after mapping columns and reviewing row values. Any later row or mapping edits require another check.</p>}
    {previewIsCurrent && eligibility.eligibleRows === 0 && <p className="candidate-import-final-guidance" role="status">No rows are eligible with the current skip preference. Uncheck “Skip potential matches” to submit valid rows for the server's final duplicate check.</p>}
    {previewIsCurrent && eligibility.eligibleRows !== null && eligibility.eligibleRows > 0 && <p className="candidate-import-final-guidance">Expected new candidates after the server rechecks duplicates: {eligibility.eligibleRows}. Validation-error rows are excluded.</p>}
    {resumeOptions}
    <div className="candidate-import-final-buttons"><button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary-button" disabled={!canConfirm} onClick={onConfirm}>{checkingDuplicates ? 'Checking duplicates…' : importing ? importingLabel : importFailed ? 'Retry import' : 'Confirm and import'}</button></div>
  </section>;
}
