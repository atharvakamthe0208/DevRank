import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  candidateBulkImportResponseSchema,
  githubSyncResponseSchema,
  leetCodeSyncResponseSchema,
  type CandidateBulkImportResponse,
  type CandidateImportPreviewResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { requestCandidateImportPreview } from './candidate-csv-import-api';
import {
  CSV_IMPORT_MAX_ROWS,
  csvHeaderLabel,
  createCsvMapping,
  getCandidateImportAttempt,
  mapCsvRows,
  readCandidateCsvFile,
  type CsvField,
  type CsvMapping,
  type ParsedCsv,
} from './candidate-csv-import';
import { getImportSyncCandidates, getImportSyncRetryCandidates, runImportPlatformSync, type ImportSyncPlatform } from './candidate-csv-import-sync';
import { CandidateImportPlatformSyncActions, type PlatformSyncState } from './CandidateImportPlatformSyncActions';

const fields: Array<{ key: CsvField; label: string; required?: boolean }> = [
  { key: 'name', label: 'Candidate name', required: true },
  { key: 'email', label: 'Email address' },
  { key: 'githubUsername', label: 'GitHub username or profile URL' },
  { key: 'leetcodeUsername', label: 'LeetCode username or profile URL' },
];

const emptyPlatformSyncState = (): PlatformSyncState => ({ running: false, completed: 0, total: 0, outcomes: [] });

export function CandidateCsvImportDialog({ initialFile, onChooseFile, onClose, onImported }: { initialFile: File | null; onChooseFile: () => void; onClose: () => void; onImported: () => void }) {
  const { session } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const importAttemptRef = useRef<Awaited<ReturnType<typeof getCandidateImportAttempt>> | null>(null);
  const platformSyncInFlight = useRef<Record<ImportSyncPlatform, boolean>>({ github: false, leetcode: false });
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({ name: null, email: null, githubUsername: null, leetcodeUsername: null });
  const [edits, setEdits] = useState<Record<number, Partial<Record<CsvField, string>>>>({});
  const [preview, setPreview] = useState<CandidateImportPreviewResponse | null>(null);
  const [result, setResult] = useState<CandidateBulkImportResponse | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState('');
  const [sessionError, setSessionError] = useState('');
  const [platformSync, setPlatformSync] = useState<Record<ImportSyncPlatform, PlatformSyncState>>({ github: emptyPlatformSyncState(), leetcode: emptyPlatformSyncState() });
  const rows = useMemo(() => parsed ? mapCsvRows(parsed.rows, mapping, edits) : [], [parsed, mapping, edits]);
  const importableRows = rows.filter((row) => row.candidate && !row.errors.length);
  const previewByRow = new Map(preview?.rows.map((row) => [row.rowNumber, row]) ?? []);
  const allResults = result ? [
    ...result.results,
    ...rows.filter((row) => !row.candidate || row.errors.length > 0).map((row) => ({ rowNumber: row.rowNumber, status: 'failed' as const, reason: 'candidate_not_created' as const })),
  ].sort((left, right) => left.rowNumber - right.rowNumber) : [];
  const completedCounts = result ? {
    created: allResults.filter((item) => item.status === 'created').length,
    skipped: allResults.filter((item) => item.status === 'skipped').length,
    failed: allResults.filter((item) => item.status === 'failed').length,
  } : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (initialFile) void chooseFile(initialFile);
  }, [initialFile]);

  function clearReview() {
    setPreview(null);
    setResult(null);
    setConfirming(false);
    setError('');
  }

  function changeField(rowNumber: number, field: CsvField, value: string) {
    setEdits((current) => ({ ...current, [rowNumber]: { ...current[rowNumber], [field]: value } }));
    clearReview();
  }

  async function chooseFile(file: File) {
    clearReview();
    platformSyncInFlight.current = { github: false, leetcode: false };
    setPlatformSync({ github: emptyPlatformSyncState(), leetcode: emptyPlatformSyncState() });
    setParsed(null);
    setEdits({});
    setError('');
    setReadingFile(true);
    try {
      const contents = await readCandidateCsvFile(file);
      if (contents.error) { setParsed(contents); setError(contents.error); return; }
      if (contents.rows.length > CSV_IMPORT_MAX_ROWS) { setParsed(contents); setError(`The CSV exceeds the ${CSV_IMPORT_MAX_ROWS} candidate row limit.`); return; }
      setParsed(contents);
      setMapping(createCsvMapping(contents.headers));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this CSV file. Choose it again and retry.');
    } finally { setReadingFile(false); }
  }

  async function reviewRows() {
    clearReview();
    if (!parsed) return;
    if (mapping.name === null) { setError('Choose the column that contains candidate names.'); return; }
    if (!importableRows.length) { setError('No valid rows to review. Correct the highlighted rows or upload a corrected CSV.'); return; }
    if (!session?.access_token) { setSessionError('Your secure session is unavailable. Sign in again to import candidates.'); await supabase?.auth.signOut({ scope: 'local' }); return; }
    setBusy(true);
    setSessionError('');
    try {
      const rowsToCheck = importableRows.map((row) => ({ rowNumber: row.rowNumber, candidate: row.candidate! }));
      const response = await requestCandidateImportPreview(rowsToCheck, session.access_token);
      setPreview(response);
      setError('');
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setSessionError('Your session expired. Sign in again to review this import.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setSessionError('Recruiter access is not approved to import candidates.');
      else setError(cause instanceof Error ? cause.message : 'Could not check this import. Try again.');
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    if (!preview || busy) return;
    if (!session?.access_token) { setSessionError('Your secure session is unavailable. Sign in again to import candidates.'); return; }
    setBusy(true);
    setError('');
    setSessionError('');
    try {
      const rowsToImport = importableRows.map((row) => ({ rowNumber: row.rowNumber, candidate: row.candidate! }));
      let storage: Storage | null = null;
      try { storage = sessionStorage; } catch { /* Session storage can be disabled by browser policy. */ }
      const attempt = await getCandidateImportAttempt(rowsToImport, skipDuplicates, importAttemptRef.current, storage);
      importAttemptRef.current = attempt;
      const response = await apiRequest<unknown>('/candidates/bulk-import', {
        method: 'POST',
        headers: { 'Idempotency-Key': attempt.idempotencyKey },
        body: JSON.stringify({ rows: rowsToImport, skipDuplicates }),
      }, session.access_token);
      const validated = candidateBulkImportResponseSchema.safeParse(response);
      if (!validated.success || validated.data.results.length !== rowsToImport.length) throw new Error('The server returned incomplete import results. Retry using the same rows.');
      if (attempt.storageKey) { try { storage?.removeItem(attempt.storageKey); } catch { /* The durable database receipt remains authoritative. */ } }
      importAttemptRef.current = null;
      setResult(validated.data);
      setConfirming(false);
      onImported();
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setSessionError('Your session expired. Sign in again before continuing.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setSessionError('Recruiter access is not approved to import candidates.');
      else setError(cause instanceof Error ? cause.message : 'The import could not be confirmed. Retry with the same rows.');
    } finally { setBusy(false); }
  }

  async function syncPlatform(platform: ImportSyncPlatform) {
    if (!result || platformSyncInFlight.current[platform]) return;
    const eligible = getImportSyncCandidates(result, rows, platform);
    const state = platformSync[platform];
    const candidates = getImportSyncRetryCandidates(eligible.candidates, state.outcomes);
    if (!candidates.length) return;
    if (!session?.access_token) {
      setPlatformSync((current) => ({ ...current, [platform]: { ...current[platform], error: 'Your secure session expired. Sign in again before syncing.' } }));
      return;
    }

    platformSyncInFlight.current[platform] = true;
    setPlatformSync((current) => ({ ...current, [platform]: { ...current[platform], running: true, completed: 0, total: candidates.length, error: undefined } }));
    try {
      const outcomes = await runImportPlatformSync(candidates, async (candidate) => {
        const path = platform === 'github'
          ? `/candidates/${candidate.candidateId}/platform-data/github-sync`
          : `/candidates/${candidate.candidateId}/platform-data/leetcode-sync`;
        const response = await apiRequest<unknown>(path, { method: 'POST', body: JSON.stringify({ profile: candidate.profile }) }, session.access_token);
        if (platform === 'github') githubSyncResponseSchema.parse(response);
        else leetCodeSyncResponseSchema.parse(response);
      }, (completed, total) => {
        setPlatformSync((current) => ({ ...current, [platform]: { ...current[platform], completed, total } }));
      });
      setPlatformSync((current) => ({
        ...current,
        [platform]: { ...current[platform], running: false, completed: candidates.length, total: candidates.length, outcomes: [...current[platform].outcomes.filter((item) => !outcomes.some((next) => next.rowNumber === item.rowNumber)), ...outcomes] },
      }));
    } finally {
      platformSyncInFlight.current[platform] = false;
      setPlatformSync((current) => ({ ...current, [platform]: { ...current[platform], running: false } }));
    }
  }

  function close() {
    if (Object.values(platformSyncInFlight.current).some(Boolean)) return;
    dialogRef.current?.close();
    onClose();
  }

  const anyPlatformSyncRunning = Object.values(platformSync).some((state) => state.running);
  return <dialog className="candidate-import-dialog" ref={dialogRef} aria-labelledby="candidate-import-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="candidate-import-heading"><div><h2 id="candidate-import-title">Import candidates from CSV</h2><p>UTF-8 CSV · up to 1 MB and {CSV_IMPORT_MAX_ROWS} candidate rows. Imports create candidate records only.</p></div><button type="button" className="candidate-import-close" aria-label="Close CSV import" onClick={close} disabled={anyPlatformSyncRunning}>×</button></header>
    <section className="candidate-import-file">
      <span className="candidate-import-file-label">CSV file</span>
      <button type="button" className="secondary-button" onClick={onChooseFile} disabled={busy || anyPlatformSyncRunning}>{initialFile ? 'Choose another CSV' : 'Choose CSV file'}</button>
      {initialFile && <p role="status">Selected file: {initialFile.name}</p>}
      {readingFile && <p role="status">Reading CSV file…</p>}
      {parsed && <p>{parsed.rows.length} data rows detected. Name is required; email and developer profile fields follow the existing optional candidate fields.</p>}
    </section>
    {parsed && parsed.headers.length > 0 && <section className="candidate-import-mapping" aria-labelledby="candidate-import-mapping-title"><h3 id="candidate-import-mapping-title">Map CSV columns</h3><div className="candidate-import-mapping-grid">{fields.map((field) => <label key={field.key} htmlFor={`candidate-import-map-${field.key}`}>{field.label}{field.required ? ' *' : ''}<select id={`candidate-import-map-${field.key}`} value={mapping[field.key] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setMapping((current) => ({ ...current, [field.key]: value === '' ? null : Number(value) })); clearReview(); }} disabled={busy || !!result}><option value="">{field.required ? 'Choose a column' : 'Not mapped'}</option>{parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{csvHeaderLabel(header, index, parsed.headers)}</option>)}</select></label>)}</div></section>}
    {error && <p className="candidate-import-error" role="alert">{error}</p>}
    {sessionError && <p className="candidate-import-error" role="alert">{sessionError}</p>}
    {result && completedCounts && <section className="candidate-import-results" aria-live="polite"><h3>Import results</h3><p>{completedCounts.created} created · {completedCounts.skipped} skipped · {completedCounts.failed} failed</p><ul>{allResults.map((item) => {
      const sourceRow = rows.find((row) => row.rowNumber === item.rowNumber);
      const title = sourceRow?.candidate?.name ?? `CSV row ${item.rowNumber}`;
      return <li key={`${item.rowNumber}-${item.status}`}><span>Row {item.rowNumber}: {title} — {item.status === 'created' ? 'created' : item.reason === 'potential_duplicate' ? 'skipped as a potential match' : item.status === 'failed' ? 'could not be created' : 'skipped'}</span>{item.status === 'created' && item.candidateId && <Link to={`/candidates/${item.candidateId}`} aria-disabled={anyPlatformSyncRunning} onClick={(event) => { if (Object.values(platformSyncInFlight.current).some(Boolean)) { event.preventDefault(); return; } close(); }}>Open profile</Link>}</li>;
    })}</ul><CandidateImportPlatformSyncActions result={result} rows={rows} stateByPlatform={platformSync} onSync={(platform) => void syncPlatform(platform)}/></section>}
    {preview && !result && <section className="candidate-import-policy" aria-label="Duplicate handling"><p>Potential matches use exact, case-insensitive email, GitHub username, or LeetCode username matches within your workspace. Candidate names are not treated as unique, and existing records are never overwritten.</p><label><input type="checkbox" checked={skipDuplicates} onChange={(event) => { setSkipDuplicates(event.currentTarget.checked); setConfirming(false); setError(''); }} disabled={busy}/> Skip potential matches (recommended). Uncheck to explicitly import them.</label><p>{preview.rows.filter((row) => row.status === 'ready').length} rows have no potential match; {preview.rows.filter((row) => row.status === 'duplicate').length} potential matches.</p><button type="button" className="primary-button" disabled={busy || !importableRows.length} onClick={() => setConfirming(true)}>Continue to confirmation</button></section>}
    {confirming && preview && !result && <section className="candidate-import-confirm" aria-labelledby="candidate-import-confirm-title"><h3 id="candidate-import-confirm-title">Confirm candidate import</h3><p>{importableRows.length} valid rows will be submitted. {skipDuplicates ? 'Potential matches will be skipped.' : 'Potential matches will also be created as new records.'} Rows with validation errors will not be sent.</p><div><button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void confirmImport()}>{busy ? 'Importing…' : error ? 'Retry import' : 'Confirm and import'}</button></div></section>}
    {parsed?.rows.length ? <section className="candidate-import-preview" aria-labelledby="candidate-import-preview-title"><div className="candidate-import-preview-heading"><div><h3 id="candidate-import-preview-title">Review rows</h3><p>{importableRows.length} valid · {rows.length - importableRows.length} need correction{preview ? ' · duplicate check complete' : ''}</p></div><button type="button" className="secondary-button" disabled={busy || mapping.name === null} onClick={() => void reviewRows()}>{busy && !confirming ? 'Checking…' : preview ? 'Check duplicates again' : 'Check duplicates'}</button></div>
      <div className="candidate-import-table-wrap" role="region" aria-label="CSV candidate preview" tabIndex={0}><table><thead><tr><th>CSV row</th><th>Name</th><th>Email</th><th>GitHub</th><th>LeetCode</th><th>Status</th><th><span className="sr-only">Original CSV values</span></th></tr></thead><tbody>{rows.map((row) => {
        const checked = previewByRow.get(row.rowNumber);
        const status = row.errors.length ? 'Needs correction' : checked?.status === 'duplicate' ? 'Potential match' : checked ? 'Ready' : row.duplicateInFile ? 'Possible CSV duplicate' : 'Not checked';
        return <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td>
          {fields.map((field) => <td key={field.key}><input aria-label={`Row ${row.rowNumber} ${field.label}`} value={row.candidate?.[field.key] ?? (edits[row.rowNumber]?.[field.key] ?? (mapping[field.key] === null ? '' : row.original[mapping[field.key]!] ?? ''))} onChange={(event) => changeField(row.rowNumber, field.key, event.currentTarget.value)} disabled={busy || !!result} maxLength={field.key === 'name' ? 120 : field.key === 'email' ? 254 : 500}/></td>)}
          <td className={row.errors.length ? 'candidate-import-invalid' : checked?.potentialDuplicate || row.duplicateInFile ? 'candidate-import-duplicate' : ''}>{status}{row.errors.length > 0 && <ul>{row.errors.map((message) => <li key={message}>{message}</li>)}</ul>}{checked?.potentialDuplicate && <small>Existing candidate ID: {checked.candidateId ?? 'another row in this CSV'}</small>}</td>
          <td><details><summary>Original</summary><dl>{parsed!.headers.map((header, index) => <div key={`${header}-${index}`}><dt>{csvHeaderLabel(header, index, parsed!.headers)}</dt><dd>{row.original[index] || '—'}</dd></div>)}</dl>{row.errors.some((message) => message.includes('columns') || message.includes('quoted') || message.includes('character after')) && <p>This row has CSV structure errors. Correct the source file and upload it again.</p>}</details></td>
        </tr>;
      })}</tbody></table></div>
    </section> : null}
    <footer className="candidate-import-footer"><span>Invalid rows are not discarded silently. Correct their fields or upload a corrected CSV.</span><button type="button" className="secondary-button" onClick={close} disabled={anyPlatformSyncRunning}>Close</button></footer>
  </dialog>;
}
