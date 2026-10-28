import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  candidateBulkImportResponseSchema,
  githubSyncResponseSchema,
  leetCodeSyncResponseSchema,
  googleDriveResumeScreenResponseSchema,
  screeningDetailsResponseSchema,
  type CandidateBulkImportResponse,
  type CandidateImportPreviewResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { requestCandidateImportPreview } from './candidate-csv-import-api';
import {
  CSV_IMPORT_MAX_ROWS,
  classifyResumeReference,
  createDriveScreeningIdempotencyKey,
  csvHeaderLabel,
  createCsvMapping,
  extractDriveFileId,
  findResumeReferenceColumns,
  getCandidateImportAttempt,
  isGoogleFormsResponseCsv,
  mapCsvRows,
  readCandidateCsvFile,
  type CsvField,
  type CsvMapping,
  type ParsedCsv,
} from './candidate-csv-import';
import { getImportSyncCandidates, getImportSyncRetryCandidates, runImportPlatformSync, type ImportSyncPlatform } from './candidate-csv-import-sync';
import { CandidateImportPlatformSyncActions, type PlatformSyncState } from './CandidateImportPlatformSyncActions';
import { CandidateImportFinalActions } from './CandidateImportFinalActions';
import { acquireCandidateImportRequest, candidateImportEligibility, candidateImportPreviewIsCurrent, canConfirmCandidateImport, getCandidateImportRowsForSubmission, releaseCandidateImportRequest } from './candidate-csv-import-workflow';

const fields: Array<{ key: CsvField; label: string; required?: boolean }> = [
  { key: 'name', label: 'Candidate name', required: true },
  { key: 'email', label: 'Email address' },
  { key: 'githubUsername', label: 'GitHub username or profile URL' },
  { key: 'leetcodeUsername', label: 'LeetCode username or profile URL' },
];

const emptyPlatformSyncState = (): PlatformSyncState => ({ running: false, completed: 0, total: 0, outcomes: [] });
const MAX_SCREENING_FILES = 20;
type DriveResumeStatus = 'candidate_imported' | 'waiting_for_drive_authorization' | 'resume_downloaded' | 'screening_in_progress' | 'screening_completed' | 'resume_inaccessible' | 'unsupported_file' | 'screening_failed';
type DriveResumeProgress = { status: DriveResumeStatus; message?: string; sessionId?: string; resumeId?: string; fileId?: string };
type DriveConnectionStatus = { configured: boolean; connected: boolean };

function driveStatusLabel(status: DriveResumeStatus) {
  return ({ candidate_imported: 'Candidate imported', waiting_for_drive_authorization: 'Waiting for Drive authorization', resume_downloaded: 'Resume downloaded', screening_in_progress: 'Screening in progress', screening_completed: 'Screening completed', resume_inaccessible: 'Resume inaccessible', unsupported_file: 'Unsupported file', screening_failed: 'Screening failed' })[status];
}

export function CandidateCsvImportDialog({ initialFile, onChooseFile, onClose, onImported }: { initialFile: File | null; onChooseFile: () => void; onClose: () => void; onImported: () => void }) {
  const { session } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const importAttemptRef = useRef<Awaited<ReturnType<typeof getCandidateImportAttempt>> | null>(null);
  const platformSyncInFlight = useRef<Record<ImportSyncPlatform, boolean>>({ github: false, leetcode: false });
  const previewRequestLock = useRef(false);
  const importRequestLock = useRef(false);
  const reviewRevision = useRef(0);
  const previewRevision = useRef<number | null>(null);
  const drivePopupRef = useRef<Window | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMapping>({ name: null, email: null, githubUsername: null, leetcodeUsername: null });
  const [edits, setEdits] = useState<Record<number, Partial<Record<CsvField, string>>>>({});
  const [preview, setPreview] = useState<CandidateImportPreviewResponse | null>(null);
  const [result, setResult] = useState<CandidateBulkImportResponse | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [error, setError] = useState('');
  const [importFailed, setImportFailed] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [platformSync, setPlatformSync] = useState<Record<ImportSyncPlatform, PlatformSyncState>>({ github: emptyPlatformSyncState(), leetcode: emptyPlatformSyncState() });
  const [driveConnection, setDriveConnection] = useState<DriveConnectionStatus & { loading: boolean; error?: string }>({ configured: false, connected: false, loading: false });
  const [screenResumes, setScreenResumes] = useState(false);
  const [screeningJobTitle, setScreeningJobTitle] = useState('');
  const [screeningJobDescription, setScreeningJobDescription] = useState('');
  const [resumeProgress, setResumeProgress] = useState<Record<number, DriveResumeProgress>>({});
  const [retryingResumeRows, setRetryingResumeRows] = useState<number[]>([]);
  const [screeningProgress, setScreeningProgress] = useState({ running: false, completed: 0, total: 0 });
  const googleFormsCsv = parsed ? isGoogleFormsResponseCsv(parsed.headers) : false;
  const resumeReferenceColumns = parsed ? findResumeReferenceColumns(parsed.headers) : [];
  const resumeReferenceColumn = resumeReferenceColumns.length === 1 ? resumeReferenceColumns[0] : null;
  const rows = useMemo(() => parsed ? mapCsvRows(parsed.rows, mapping, edits, googleFormsCsv) : [], [parsed, mapping, edits, googleFormsCsv]);
  const importableRows = rows.filter((row) => row.candidate && !row.errors.length);
  const previewIsCurrent = candidateImportPreviewIsCurrent(previewRevision.current, reviewRevision.current);
  const importEligibility = candidateImportEligibility(rows.length, importableRows.length, preview, previewIsCurrent, skipDuplicates);
  const resumeReferenceCounts = rows.reduce((counts, row) => {
    const value = resumeReferenceColumn === null ? '' : row.original[resumeReferenceColumn] ?? '';
    counts[classifyResumeReference(value)] += 1;
    return counts;
  }, { missing: 0, drive_link_unverified: 0, unrecognized_link: 0 });
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

  useEffect(() => {
    if (!googleFormsCsv || !session?.access_token) return;
    let active = true;
    setDriveConnection((current) => ({ ...current, loading: true, error: undefined }));
    void apiRequest<DriveConnectionStatus>('/google-drive/status', {}, session.access_token).then((status) => {
      if (active) setDriveConnection({ ...status, loading: false });
    }).catch((cause: unknown) => {
      if (active) setDriveConnection((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : 'Could not check Google Drive authorization.' }));
    });
    return () => { active = false; };
  }, [googleFormsCsv, session?.access_token]);

  function clearReview() {
    reviewRevision.current += 1;
    previewRevision.current = null;
    setPreview(null);
    setResult(null);
    setError('');
    setImportFailed(false);
    setResumeProgress({});
    setScreeningProgress({ running: false, completed: 0, total: 0 });
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
    if (busy) return;
    if (!acquireCandidateImportRequest(previewRequestLock)) return;
    clearReview();
    if (!parsed) { releaseCandidateImportRequest(previewRequestLock); return; }
    if (mapping.name === null) { setError('Choose the column that contains candidate names.'); releaseCandidateImportRequest(previewRequestLock); return; }
    if (!importableRows.length) { setError('No valid rows to review. Correct the highlighted rows or upload a corrected CSV.'); releaseCandidateImportRequest(previewRequestLock); return; }
    if (!session?.access_token) {
      setSessionError('Your secure session is unavailable. Sign in again to import candidates.');
      try { await supabase?.auth.signOut({ scope: 'local' }); } finally { releaseCandidateImportRequest(previewRequestLock); }
      return;
    }
    const requestRevision = reviewRevision.current;
    setBusy(true);
    setSessionError('');
    try {
      const rowsToCheck = importableRows.map((row) => ({ rowNumber: row.rowNumber, candidate: row.candidate! }));
      const response = await requestCandidateImportPreview(rowsToCheck, session.access_token);
      if (reviewRevision.current === requestRevision) {
        previewRevision.current = requestRevision;
        setPreview(response);
        setError('');
      }
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setSessionError('Your session expired. Sign in again to review this import.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setSessionError('Recruiter access is not approved to import candidates.');
      else setError(cause instanceof Error ? cause.message : 'Could not check this import. Try again.');
    } finally { releaseCandidateImportRequest(previewRequestLock); setBusy(false); }
  }

  async function refreshDriveStatus() {
    if (!session?.access_token) return;
    setDriveConnection((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const status = await apiRequest<DriveConnectionStatus>('/google-drive/status', {}, session.access_token);
      setDriveConnection({ ...status, loading: false });
    } catch (cause) {
      setDriveConnection((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : 'Could not check Google Drive authorization.' }));
    }
  }

  async function authorizeGoogleDrive() {
    if (!session?.access_token) { setSessionError('Sign in again before connecting Google Drive.'); return; }
    const popup = window.open('about:blank', 'devrank-google-drive-oauth', 'popup,width=560,height=720');
    if (!popup) { setDriveConnection((current) => ({ ...current, error: 'Allow pop-ups for DevRank, then retry Google Drive authorization.' })); return; }
    drivePopupRef.current = popup;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'devrank-google-drive-oauth') return;
      window.removeEventListener('message', onMessage);
      drivePopupRef.current = null;
      popup.close();
      if (event.data.status === 'connected') void refreshDriveStatus();
      else setDriveConnection((current) => ({ ...current, loading: false, error: event.data.status === 'authorization_denied' ? 'Google Drive permission was not granted.' : 'Google Drive authorization did not complete. Check the OAuth configuration and retry.' }));
    };
    window.addEventListener('message', onMessage);
    setDriveConnection((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await apiRequest<{ authorizationUrl: string }>('/google-drive/connect', { method: 'POST' }, session.access_token);
      const url = new URL(response.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com') throw new Error('The API returned an invalid Google authorization URL.');
      popup.location.replace(url.toString());
    } catch (cause) {
      window.removeEventListener('message', onMessage);
      drivePopupRef.current = null;
      popup.close();
      setDriveConnection((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : 'Google Drive could not be connected.' }));
    }
  }

  function setResumeRow(rowNumber: number, value: DriveResumeProgress) {
    setResumeProgress((current) => ({ ...current, [rowNumber]: value }));
  }

  async function pollScreeningSession(sessionId: string, resumeRows: Map<string, number>, accessToken: string, fileIds: Map<number, string>) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      try {
        const details = screeningDetailsResponseSchema.parse(await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}`, {}, accessToken));
        if (details.status !== 'processing') {
          for (const resume of details.resumes) {
            const rowNumber = resumeRows.get(resume.id);
            if (rowNumber !== undefined) setResumeRow(rowNumber, { status: resume.status === 'completed' ? 'screening_completed' : 'screening_failed', message: resume.error, sessionId, resumeId: resume.id, fileId: fileIds.get(rowNumber) });
          }
          setScreeningProgress((current) => ({ ...current, completed: current.completed + resumeRows.size }));
          return;
        }
      } catch { /* Keep the durable queue running; a failed poll does not cancel screening. */ }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    }
    for (const [resumeId, rowNumber] of resumeRows) setResumeRow(rowNumber, { status: 'screening_in_progress', message: 'The durable screening queue is still processing this resume. View progress on Resume Screening.', sessionId, resumeId, fileId: fileIds.get(rowNumber) });
  }

  async function screenImportedResumes(imported: CandidateBulkImportResponse) {
    if (!session?.access_token || resumeReferenceColumn === null) return;
    const created = imported.results.filter((item) => item.status === 'created' && item.candidateId);
    for (const item of created) setResumeRow(item.rowNumber, { status: 'candidate_imported' });
    const work: Array<{ rowNumber: number; candidateId: string; name: string; fileId: string }> = [];
    for (const item of created) {
      const source = rows.find((row) => row.rowNumber === item.rowNumber);
      const rawReference = source?.original[resumeReferenceColumn] ?? '';
      const fileId = extractDriveFileId(rawReference);
      if (!fileId) {
        setResumeRow(item.rowNumber, { status: classifyResumeReference(rawReference) === 'missing' ? 'screening_failed' : 'resume_inaccessible', message: classifyResumeReference(rawReference) === 'missing' ? 'No resume link was supplied.' : 'This value is not a supported Google Drive PDF link.' });
        continue;
      }
      work.push({ rowNumber: item.rowNumber, candidateId: item.candidateId!, name: source?.candidate?.name ?? 'Candidate', fileId });
      setResumeRow(item.rowNumber, { status: 'waiting_for_drive_authorization', fileId });
    }
    if (!work.length) return;

    setScreeningProgress({ running: true, completed: 0, total: work.length });
    const submitted: Array<{ sessionId: string; resumeRows: Map<string, number>; fileIds: Map<number, string> }> = [];
    for (let offset = 0; offset < work.length; offset += MAX_SCREENING_FILES) {
      const batch = work.slice(offset, offset + MAX_SCREENING_FILES);
      try {
        const idempotencyKey = await createDriveScreeningIdempotencyKey(batch.map(({ candidateId, fileId }) => `${candidateId}:${fileId}`).join('|'), batch.map(({ fileId }) => fileId).join('|'), screeningJobTitle, screeningJobDescription);
        const response = googleDriveResumeScreenResponseSchema.parse(await apiRequest<unknown>('/google-drive/screen', {
          method: 'POST', headers: { 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ jobTitle: screeningJobTitle.trim(), jobDescription: screeningJobDescription.trim(), resumes: batch.map(({ candidateId, fileId }) => ({ candidateId, fileId })) }),
        }, session.access_token));
        const itemByCandidate = new Map(batch.map((item) => [item.candidateId, item]));
        const resumeRows = new Map<string, number>();
        const fileIds = new Map<number, string>();
        let terminal = 0;
        for (const itemResult of response.results) {
          const item = itemByCandidate.get(itemResult.candidateId);
          if (!item) continue;
          if (itemResult.status === 'failed') {
            terminal += 1;
            const status: DriveResumeStatus = itemResult.code === 'GOOGLE_DRIVE_FILE_INACCESSIBLE' || itemResult.code === 'GOOGLE_DRIVE_FILE_NOT_FOUND' || itemResult.code === 'GOOGLE_DRIVE_REAUTH_REQUIRED'
              ? 'resume_inaccessible' : itemResult.code === 'GOOGLE_DRIVE_UNSUPPORTED_FILE' || itemResult.code === 'GOOGLE_DRIVE_INVALID_PDF' || itemResult.code === 'GOOGLE_DRIVE_FILE_TOO_LARGE'
                ? 'unsupported_file' : 'screening_failed';
            setResumeRow(item.rowNumber, { status, message: itemResult.message, fileId: item.fileId, sessionId: itemResult.sessionId, resumeId: itemResult.resumeId });
          } else if (itemResult.sessionId && itemResult.resumeId) {
            resumeRows.set(itemResult.resumeId, item.rowNumber);
            fileIds.set(item.rowNumber, item.fileId);
            setResumeRow(item.rowNumber, { status: 'screening_in_progress', message: 'Downloaded to private server storage and queued in the existing screening service.', sessionId: itemResult.sessionId, resumeId: itemResult.resumeId, fileId: item.fileId });
          }
        }
        if (terminal) setScreeningProgress((current) => ({ ...current, completed: current.completed + terminal }));
        if (resumeRows.size) submitted.push({ sessionId: response.results.find((item) => item.sessionId)?.sessionId!, resumeRows, fileIds });
        else setScreeningProgress((current) => ({ ...current, completed: current.completed + batch.length }));
      } catch (cause) {
        for (const item of batch) setResumeRow(item.rowNumber, { status: 'screening_failed', message: cause instanceof Error ? cause.message : 'Resume screening could not be queued.', fileId: item.fileId });
        setScreeningProgress((current) => ({ ...current, completed: current.completed + batch.length }));
      }
    }
    await Promise.all(submitted.map(({ sessionId, resumeRows, fileIds }) => pollScreeningSession(sessionId, resumeRows, session.access_token, fileIds)));
    setScreeningProgress((current) => ({ ...current, running: false }));
  }

  async function retryResume(rowNumber: number) {
    const previous = resumeProgress[rowNumber];
    const imported = result?.results.find((item) => item.rowNumber === rowNumber && item.status === 'created' && item.candidateId);
    if (!previous?.fileId || !imported?.candidateId || !session?.access_token || retryingResumeRows.includes(rowNumber)) return;
    setRetryingResumeRows((current) => [...current, rowNumber]);
    setResumeRow(rowNumber, { ...previous, status: 'waiting_for_drive_authorization', message: undefined });
    try {
      if (previous.sessionId && previous.resumeId) {
        await apiRequest<unknown>(`/screenings/${encodeURIComponent(previous.sessionId)}/resumes/${encodeURIComponent(previous.resumeId)}/retry`, { method: 'POST' }, session.access_token);
        setResumeRow(rowNumber, { ...previous, status: 'screening_in_progress', message: 'Retry queued in the existing screening service.' });
        await pollScreeningSession(previous.sessionId, new Map([[previous.resumeId, rowNumber]]), session.access_token, new Map([[rowNumber, previous.fileId]]));
      } else {
        const key = await createDriveScreeningIdempotencyKey(imported.candidateId, previous.fileId, screeningJobTitle, screeningJobDescription);
        const submission = googleDriveResumeScreenResponseSchema.parse(await apiRequest<unknown>('/google-drive/screen', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ jobTitle: screeningJobTitle.trim(), jobDescription: screeningJobDescription.trim(), resumes: [{ candidateId: imported.candidateId, fileId: previous.fileId }] }) }, session.access_token));
        const resume = submission.results[0];
        if (resume.status === 'failed') setResumeRow(rowNumber, { status: resume.code === 'GOOGLE_DRIVE_FILE_INACCESSIBLE' || resume.code === 'GOOGLE_DRIVE_FILE_NOT_FOUND' || resume.code === 'GOOGLE_DRIVE_REAUTH_REQUIRED' ? 'resume_inaccessible' : 'screening_failed', sessionId: resume.sessionId, resumeId: resume.resumeId, fileId: previous.fileId, message: resume.message });
        else {
          setResumeRow(rowNumber, { status: 'screening_in_progress', sessionId: resume.sessionId, resumeId: resume.resumeId, fileId: previous.fileId, message: 'Queued in the existing screening service.' });
          await pollScreeningSession(resume.sessionId!, new Map([[resume.resumeId!, rowNumber]]), session.access_token, new Map([[rowNumber, previous.fileId]]));
        }
      }
    } catch (cause) {
      setResumeRow(rowNumber, { ...previous, status: cause instanceof ApiRequestError && cause.code === 'GOOGLE_DRIVE_FILE_INACCESSIBLE' ? 'resume_inaccessible' : 'screening_failed', message: cause instanceof Error ? cause.message : 'Could not retry this resume.' });
    } finally { setRetryingResumeRows((current) => current.filter((value) => value !== rowNumber)); }
  }

  async function confirmImport() {
    if (!preview || !canConfirmCandidateImport(previewIsCurrent, busy, importEligibility.eligibleRows) || previewRevision.current !== reviewRevision.current || !acquireCandidateImportRequest(importRequestLock)) return;
    if (!session?.access_token) { setSessionError('Your secure session is unavailable. Sign in again to import candidates.'); releaseCandidateImportRequest(importRequestLock); return; }
    if (screenResumes && (resumeReferenceColumn === null || !driveConnection.connected || !screeningJobTitle.trim() || screeningJobDescription.trim().length < 50)) {
      setError('Connect Google Drive and enter a job title plus a job description of at least 50 characters before importing and screening resumes.'); releaseCandidateImportRequest(importRequestLock); return;
    }
    setBusy(true);
    setError('');
    setImportFailed(false);
    setSessionError('');
    try {
      const rowsToImport = getCandidateImportRowsForSubmission(rows);
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
      onImported();
      if (screenResumes) await screenImportedResumes(validated.data);
    } catch (cause) {
      setImportFailed(true);
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setSessionError('Your session expired. Sign in again before continuing.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setSessionError('Recruiter access is not approved to import candidates.');
      else setError(cause instanceof Error ? cause.message : 'The import could not be confirmed. Retry with the same rows.');
    } finally { releaseCandidateImportRequest(importRequestLock); setBusy(false); }
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
    if (previewRequestLock.current || importRequestLock.current || Object.values(platformSyncInFlight.current).some(Boolean)) return;
    dialogRef.current?.close();
    onClose();
  }

  const anyPlatformSyncRunning = Object.values(platformSync).some((state) => state.running);
  return <dialog className="candidate-import-dialog" ref={dialogRef} aria-labelledby="candidate-import-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <header className="candidate-import-heading"><div><h2 id="candidate-import-title">Import candidates from CSV</h2><p>UTF-8 CSV · up to 1 MB and {CSV_IMPORT_MAX_ROWS} candidate rows. Candidate import remains independent; supported Drive PDFs can be screened after authorization and confirmation.</p></div><button type="button" className="candidate-import-close" aria-label="Close CSV import" onClick={close} disabled={busy || anyPlatformSyncRunning}>×</button></header>
    <section className="candidate-import-file">
      <span className="candidate-import-file-label">CSV file</span>
      <button type="button" className="secondary-button" onClick={onChooseFile} disabled={busy || anyPlatformSyncRunning}>{initialFile ? 'Choose another CSV' : 'Choose CSV file'}</button>
      {initialFile && <p role="status">Selected file: {initialFile.name}</p>}
      {readingFile && <p role="status">Reading CSV file…</p>}
      {parsed && <p>{parsed.rows.length} data rows detected. Name is required; email and developer profile fields follow the existing optional candidate fields.</p>}
    </section>
    {resumeReferenceColumns.length > 0 && <aside className="candidate-import-resume-notice" role="status">
      <strong>{googleFormsCsv ? 'Google Forms response CSV detected.' : 'Resume reference column detected.'}</strong>
      <p>Resume cells contain Drive file links, not PDF contents. DevRank downloads only files the Google account you authorize can access; each file is checked for PDF type, size, and actual PDF bytes before it reaches the existing screening queue.</p>
      {resumeReferenceColumns.length === 1
        ? <p>Resume references: {resumeReferenceCounts.drive_link_unverified} Drive links (access will be checked after confirmation), {resumeReferenceCounts.unrecognized_link} unrecognized links, {resumeReferenceCounts.missing} missing.</p>
        : <p>Multiple possible resume columns were found. Choose or rename a single resume column in the CSV before automatic screening.</p>}
      {driveConnection.loading ? <p role="status">Checking Google Drive authorization…</p>
        : driveConnection.connected ? <p role="status">Google Drive is authorized for this recruiter account.</p>
          : <p role="status">Google Drive authorization: {driveConnection.configured ? 'Not connected' : 'Server configuration required'}{driveConnection.error ? ` — ${driveConnection.error}` : ''}</p>}
      <button type="button" className="secondary-button" onClick={() => void authorizeGoogleDrive()} disabled={!driveConnection.configured || driveConnection.loading || !!result}>{driveConnection.connected ? 'Reconnect Google Drive' : 'Authorize Google Drive'}</button>
      <p>The account must be the form owner or otherwise have permission to download these files. A Drive URL alone does not grant access.</p>
      <p>If a PDF cannot be retrieved, use the authorized Drive account to download it and upload the actual file from <Link to="/screening">Resume Screening</Link>.</p>
    </aside>}
    {parsed && parsed.headers.length > 0 && <section className="candidate-import-mapping" aria-labelledby="candidate-import-mapping-title"><h3 id="candidate-import-mapping-title">Map CSV columns</h3><div className="candidate-import-mapping-grid">{fields.map((field) => <label key={field.key} htmlFor={`candidate-import-map-${field.key}`}>{field.label}{field.required ? ' *' : ''}<select id={`candidate-import-map-${field.key}`} value={mapping[field.key] ?? ''} onChange={(event) => { const value = event.currentTarget.value; setMapping((current) => ({ ...current, [field.key]: value === '' ? null : Number(value) })); clearReview(); }} disabled={busy || !!result}><option value="">{field.required ? 'Choose a column' : 'Not mapped'}</option>{parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{csvHeaderLabel(header, index, parsed.headers)}</option>)}</select></label>)}</div></section>}
    {error && <p className="candidate-import-error" role="alert">{error}</p>}
    {sessionError && <p className="candidate-import-error" role="alert">{sessionError}</p>}
    {result && completedCounts && <section className="candidate-import-results" aria-live="polite"><h3>Import results</h3><p>{completedCounts.created} created · {completedCounts.skipped} skipped · {completedCounts.failed} failed</p>{screeningProgress.total > 0 && <p role="status">Resume processing: {screeningProgress.completed} of {screeningProgress.total} candidates reached a screening result{screeningProgress.running ? ' or are still being checked' : ''}.</p>}<ul>{allResults.map((item) => {
      const sourceRow = rows.find((row) => row.rowNumber === item.rowNumber);
      const title = sourceRow?.candidate?.name ?? `CSV row ${item.rowNumber}`;
      const resume = resumeProgress[item.rowNumber];
      const mayRetryResume = !!resume?.fileId && ['resume_inaccessible', 'unsupported_file', 'screening_failed'].includes(resume.status);
      return <li key={`${item.rowNumber}-${item.status}`}><span>Row {item.rowNumber}: {title} — {item.status === 'created' ? 'candidate imported' : item.reason === 'potential_duplicate' ? 'skipped as a potential match' : item.status === 'failed' ? 'could not be created' : 'skipped'}{resume && <> · <strong>{driveStatusLabel(resume.status)}</strong>{resume.message ? ` — ${resume.message}` : ''}</>}</span>{mayRetryResume && <button type="button" className="candidate-import-retry-resume" disabled={retryingResumeRows.includes(item.rowNumber)} onClick={() => void retryResume(item.rowNumber)}>{retryingResumeRows.includes(item.rowNumber) ? 'Retrying…' : 'Retry resume'}</button>}{item.status === 'created' && item.candidateId && <Link to={`/candidates/${item.candidateId}`} aria-disabled={anyPlatformSyncRunning} onClick={(event) => { if (Object.values(platformSyncInFlight.current).some(Boolean)) { event.preventDefault(); return; } close(); }}>Open profile</Link>}</li>;
    })}</ul><CandidateImportPlatformSyncActions result={result} rows={rows} stateByPlatform={platformSync} onSync={(platform) => void syncPlatform(platform)}/></section>}
    {parsed?.rows.length ? <section className="candidate-import-preview" aria-labelledby="candidate-import-preview-title"><div className="candidate-import-preview-heading"><div><h3 id="candidate-import-preview-title">Review rows</h3><p>{importableRows.length} valid · {rows.length - importableRows.length} need correction{previewIsCurrent ? ' · duplicate check complete' : ''}</p></div><button type="button" className="secondary-button" disabled={busy || mapping.name === null || importRequestLock.current} onClick={() => void reviewRows()}>{busy && previewRequestLock.current ? 'Checking duplicates…' : previewIsCurrent ? 'Check duplicates again' : 'Check duplicates'}</button></div>
      <div className="candidate-import-table-wrap" role="region" aria-label="CSV candidate preview" tabIndex={0}><table><thead><tr><th>CSV row</th><th>Name</th><th>Email</th><th>GitHub</th><th>LeetCode</th><th>Status</th>{resumeReferenceColumns.length > 0 && <th>Resume file</th>}<th><span className="sr-only">Original CSV values</span></th></tr></thead><tbody>{rows.map((row) => {
        const checked = previewByRow.get(row.rowNumber);
        const status = row.errors.length ? 'Needs correction' : checked?.status === 'duplicate' ? 'Potential match' : checked ? 'Ready' : row.duplicateInFile ? 'Possible CSV duplicate' : 'Not checked';
        const resumeReference = resumeReferenceColumn === null ? '' : row.original[resumeReferenceColumn] ?? '';
        const resumeStatus = classifyResumeReference(resumeReference);
        return <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td>
          {fields.map((field) => <td key={field.key}><input aria-label={`Row ${row.rowNumber} ${field.label}`} value={row.candidate?.[field.key] ?? (edits[row.rowNumber]?.[field.key] ?? (mapping[field.key] === null ? '' : row.original[mapping[field.key]!] ?? ''))} onChange={(event) => changeField(row.rowNumber, field.key, event.currentTarget.value)} disabled={busy || !!result} maxLength={field.key === 'name' ? 120 : field.key === 'email' ? 254 : 500}/></td>)}
          <td className={row.errors.length ? 'candidate-import-invalid' : checked?.potentialDuplicate || row.duplicateInFile ? 'candidate-import-duplicate' : ''}>{status}{row.errors.length > 0 && <ul>{row.errors.map((message) => <li key={message}>{message}</li>)}</ul>}{checked?.potentialDuplicate && <small>Existing candidate ID: {checked.candidateId ?? 'another row in this CSV'}</small>}</td>
          {resumeReferenceColumns.length > 0 && <td className={resumeStatus === 'unrecognized_link' ? 'candidate-import-invalid' : 'candidate-import-resume-state'}>{resumeReferenceColumns.length > 1 ? 'Multiple columns; check original values' : resumeStatus === 'drive_link_unverified' ? 'Drive link found; access not checked; PDF not imported' : resumeStatus === 'unrecognized_link' ? 'Unrecognized link; upload PDF separately' : 'No link; upload PDF separately'}</td>}
          <td><details><summary>Original</summary><dl>{parsed!.headers.map((header, index) => <div key={`${header}-${index}`}><dt>{csvHeaderLabel(header, index, parsed!.headers)}</dt><dd>{row.original[index] || '—'}</dd></div>)}</dl>{row.errors.some((message) => message.includes('columns') || message.includes('quoted') || message.includes('character after')) && <p>This row has CSV structure errors. Correct the source file and upload it again.</p>}</details></td>
        </tr>;
      })}</tbody></table></div>
    </section> : null}
    {parsed?.rows.length && !result && <CandidateImportFinalActions
      eligibility={importEligibility}
      previewIsCurrent={previewIsCurrent}
      skipPotentialMatches={skipDuplicates}
      onSkipPotentialMatchesChange={setSkipDuplicates}
      busy={busy || previewRequestLock.current || importRequestLock.current}
      checkingDuplicates={busy && previewRequestLock.current}
      importing={busy && importRequestLock.current}
      importingLabel={screenResumes ? 'Importing and queuing resumes…' : 'Importing…'}
      importFailed={importFailed}
      confirmBlocked={screenResumes && (!driveConnection.connected || !screeningJobTitle.trim() || screeningJobDescription.trim().length < 50 || resumeReferenceColumn === null)}
      onConfirm={() => void confirmImport()}
      onCancel={close}
      resumeOptions={resumeReferenceColumns.length > 0 && <div className="candidate-import-screening-options"><label><input type="checkbox" checked={screenResumes} onChange={(event) => setScreenResumes(event.currentTarget.checked)} disabled={busy || resumeReferenceColumn === null}/> Download and screen supported Drive PDF links after candidates are imported</label><p>Screening starts only after import confirmation. It uses the existing private resume storage and screening workflow.</p>{screenResumes && <><label htmlFor="candidate-import-job-title">Target job title<input id="candidate-import-job-title" value={screeningJobTitle} onChange={(event) => setScreeningJobTitle(event.currentTarget.value)} maxLength={200} disabled={busy}/></label><label htmlFor="candidate-import-job-description">Job description (at least 50 characters)<textarea id="candidate-import-job-description" value={screeningJobDescription} onChange={(event) => setScreeningJobDescription(event.currentTarget.value)} minLength={50} maxLength={30000} rows={5} disabled={busy}/></label>{!driveConnection.connected ? <p>Authorize Google Drive before automatic resume screening. You can still import candidates without screening.</p> : (!screeningJobTitle.trim() || screeningJobDescription.trim().length < 50) && <p role="alert">Enter a target job title and a job description of at least 50 characters to screen resumes.</p>}</>}</div>}
    />}
    <footer className="candidate-import-footer"><span>Invalid rows are not discarded silently. Correct their fields or upload a corrected CSV.</span>{(!parsed?.rows.length || result) && <button type="button" className="secondary-button" onClick={close} disabled={busy || anyPlatformSyncRunning}>Close</button>}</footer>
  </dialog>;
}
