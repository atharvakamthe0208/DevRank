import type { CandidateBulkImportResponse } from '@devrank/contracts';
import { getImportSyncCandidates, type ImportSyncOutcome, type ImportSyncPlatform } from './candidate-csv-import-sync';
import type { MappedCsvRow } from './candidate-csv-import';

export type PlatformSyncState = { running: boolean; completed: number; total: number; outcomes: ImportSyncOutcome[]; error?: string };

export function CandidateImportPlatformSyncActions({ result, rows, stateByPlatform, onSync }: {
  result: CandidateBulkImportResponse;
  rows: MappedCsvRow[];
  stateByPlatform: Record<ImportSyncPlatform, PlatformSyncState>;
  onSync: (platform: ImportSyncPlatform) => void;
}) {
  return <div className="candidate-import-sync-actions">
    <p>Sync runs only for candidates created by this import. Candidates without a usable username or a saved candidate profile are skipped. Each platform is independent; a sync failure does not affect candidate records or the other platform.</p>
    {(['github', 'leetcode'] as const).map((platform) => {
      const label = platform === 'github' ? 'GitHub' : 'LeetCode';
      const eligible = getImportSyncCandidates(result, rows, platform);
      const state = stateByPlatform[platform];
      const successes = state.outcomes.filter((item) => item.status === 'synced').length;
      const failures = state.outcomes.filter((item) => item.status === 'failed');
      const hasRetriable = failures.length > 0;
      const remaining = eligible.candidates.filter((item) => !state.outcomes.some((outcome) => outcome.rowNumber === item.rowNumber && outcome.status === 'synced')).length;
      const buttonLabel = state.running
        ? `Syncing ${state.completed}/${state.total}…`
        : hasRetriable
          ? `Retry failed ${label} syncs`
          : remaining > 0
            ? state.outcomes.length ? `Sync remaining ${label}` : `Sync all ${label}`
            : eligible.candidates.length > 0 ? `${label} sync complete` : `No ${label} syncs available`;
      return <div className="candidate-import-sync-platform" key={platform}>
        <div><strong>{label}</strong><span>{eligible.candidates.length} eligible · {eligible.skipped.length} skipped</span></div>
        <button type="button" className="secondary-button" disabled={state.running || (!remaining && !hasRetriable)} onClick={() => onSync(platform)}>{buttonLabel}</button>
        <ul aria-label={`${label} sync results`}>
          {eligible.skipped.map((item) => <li key={`skip-${item.rowNumber}`}><span>{item.name}</span> — skipped: {item.reason}</li>)}
          {state.outcomes.map((item) => <li key={`sync-${item.rowNumber}`}><span>{item.name}</span> — {item.status === 'synced' ? 'synced' : <>failed: {item.message}</>}</li>)}
        </ul>
        {state.error && <p className="candidate-import-error" role="alert">{state.error}</p>}
        {state.running && <p role="status">{label}: {state.completed} of {state.total} completed.</p>}
        {state.outcomes.length > 0 && !state.running && <p role="status">{successes} synced · {failures.length} failed · {eligible.skipped.length} skipped</p>}
      </div>;
    })}
  </div>;
}
