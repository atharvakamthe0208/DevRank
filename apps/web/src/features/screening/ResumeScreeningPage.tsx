import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { candidateListResponseSchema, isResumeRoleCompatible, screeningComparisonResponseSchema, screeningDetailsResponseSchema, screeningRankingResponseSchema, screeningReportResponseSchema, screeningRetryableErrorCodes, screeningRetryResponseSchema, screeningSubmissionResponseSchema, type ScreeningComparisonResponse, type ScreeningDetailsResponse, type ScreeningReportResponse } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { screeningReportCsv, sortScreeningReportResumes } from './report-export';
import { filterAndSortScreeningResumes, scoreBand, scorePresentation } from './ranking-table';
import { ScreeningSummaryCards } from './ScreeningSummaryCards';
import { ScreeningResultList } from './ScreeningResultList';
import { screeningProgressLabel } from './screening-progress';
import { createUserSessionCache } from './screening-navigation-cache';
import { isValidScreeningSessionId } from './screening-restore';
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import { pollScreeningUntilSettled } from './screening-polling';
import { buildScreeningRequest } from './screening-request';
import { screeningErrorMessage } from './screening-errors';
import './resume-screening-page.css';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'];
const SCREENING_POLL_MS = 1000;
const SCREENING_MAX_POLL_ATTEMPTS = 10;
const SCREENING_SESSION_STORAGE_KEY = 'devrank.resume-screening.session-id';
const UNIFIED_ROLE_IDS = ['software_developer', 'ai_ml_engineer', 'data_analyst'] as const;
type ScreeningFormDraft = { jobTitle: string; jobDescription: string };
const emptyScreeningDraft: ScreeningFormDraft = { jobTitle: '', jobDescription: '' };

function isScreeningDraft(value: unknown): value is ScreeningFormDraft {
  if (typeof value !== 'object' || value === null || !('jobTitle' in value) || !('jobDescription' in value)) return false;
  return typeof value.jobTitle === 'string' && value.jobTitle.length <= 200
    && typeof value.jobDescription === 'string' && value.jobDescription.length <= 30000;
}

type SelectedResume = { id: string; file: File; candidateId?: string };
type VisibleScreening = { status: string; resumes: Array<{ status: string }> };
export function canClearVisibleScreeningResults(submitted: VisibleScreening | null, details: VisibleScreening | null, busy: boolean): boolean {
  if (!submitted || busy) return false;
  const current = details ?? submitted;
  return current.resumes.length > 0 && current.status !== 'processing'
    && !current.resumes.some(({ status }) => ['uploaded', 'queued', 'processing'].includes(status));
}
export function removePendingResume(resumes: SelectedResume[], id: string): SelectedResume[] {
  return resumes.filter((resume) => resume.id !== id);
}
export function clearPendingResumes(): SelectedResume[] { return []; }
type CandidateOption = { id: string; name: string };
type SubmittedSession = ReturnType<typeof screeningSubmissionResponseSchema.parse>;
type ScreeningNavigationSnapshot = {
  submitted: SubmittedSession; details: ScreeningDetailsResponse; selectedIds: string[];
  comparison: ScreeningComparisonResponse | null; rankingData: ReturnType<typeof screeningRankingResponseSchema.parse> | null;
  report: ScreeningReportResponse | null; candidateSearch: string; expandedDetailsId: string | null;
};
const screeningNavigationCache = createUserSessionCache<ScreeningNavigationSnapshot>();

export function ExistingCandidateResumeLinks({ candidateIds, candidates }: { candidateIds: string[]; candidates: CandidateOption[] }) {
  if (!candidateIds.length) return null;
  return <ul aria-label="Candidates with saved resume results">{candidateIds.map((candidateId) => {
    const candidate = candidates.find((item) => item.id === candidateId);
    return <li key={candidateId}><Link to={`/candidates/${encodeURIComponent(candidateId)}/report`}>{candidate?.name ?? 'Open candidate'} · reuse saved resume result or explicitly replace it</Link></li>;
  })}</ul>;
}

function storedScreeningSessionId() {
  if (typeof window === 'undefined') return null;
  try { return sessionStorage.getItem(SCREENING_SESSION_STORAGE_KEY); } catch { return null; }
}

function waitForScreeningPoll(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCREENING_POLL_MS));
}

function formatSize(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export async function refreshLinkedCandidateAssessments(details: ScreeningDetailsResponse, accessToken: string, request: typeof apiRequest = apiRequest) {
  const roleId = UNIFIED_ROLE_IDS.find((role) => isResumeRoleCompatible(role, details.jobTitle));
  if (!roleId) return { refreshed: 0, failedCandidateIds: [] as string[] };
  let refreshed = 0;
  const failedCandidateIds: string[] = [];
  for (const resume of details.resumes) {
    if (!resume.candidateId || !['completed', 'failed'].includes(resume.status)) continue;
    try {
      await request(`/candidates/${encodeURIComponent(resume.candidateId)}/unified-report/assessment`, {
        method: 'POST', body: JSON.stringify({ roleId, resumeId: resume.id }),
      }, accessToken);
      refreshed += 1;
    } catch { failedCandidateIds.push(resume.candidateId); }
  }
  return { refreshed, failedCandidateIds };
}

export function ResumeScreeningPage() {
  const { session } = useAuth();
  const storedSessionId = storedScreeningSessionId();
  const cachedNavigation = session?.user?.id && storedSessionId ? screeningNavigationCache.get(session.user.id, storedSessionId) : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const nextFileId = useRef(0);
  const idempotencyKey = useRef<string | null>(null);
  const clearingResultsRef = useRef(false);
  const refreshedAssessmentKeys = useRef(new Set<string>());
  const { value: jobDraft, status: draftStatus, persisted, setValue: setJobDraft, clear: clearDraft } = useSessionDraft(
    session?.user?.id, 'resume-screening:new', emptyScreeningDraft, isScreeningDraft,
  );
  const { jobTitle, jobDescription } = jobDraft;
  const [resumes, setResumes] = useState<SelectedResume[]>([]);
  const [candidateOptions, setCandidateOptions] = useState<CandidateOption[]>([]);
  const [candidateOptionsError, setCandidateOptionsError] = useState('');
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [duplicateCandidateIds, setDuplicateCandidateIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState<SubmittedSession | null>(cachedNavigation?.submitted ?? null);
  const [details, setDetails] = useState<ScreeningDetailsResponse | null>(cachedNavigation?.details ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>(cachedNavigation?.selectedIds ?? []);
  const [comparison, setComparison] = useState<ScreeningComparisonResponse | null>(cachedNavigation?.comparison ?? null);
  const [rankingData, setRankingData] = useState<ReturnType<typeof screeningRankingResponseSchema.parse> | null>(cachedNavigation?.rankingData ?? null);
  const [report, setReport] = useState<ScreeningReportResponse | null>(cachedNavigation?.report ?? null);
  const [clearingResults, setClearingResults] = useState(false);
  const [resultsNotice, setResultsNotice] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [retryingResumeId, setRetryingResumeId] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState(cachedNavigation?.candidateSearch ?? '');
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(cachedNavigation?.expandedDetailsId ?? null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  useEffect(() => {
    if (!session?.access_token || !details) return;
    const roleId = UNIFIED_ROLE_IDS.find((role) => isResumeRoleCompatible(role, details.jobTitle));
    if (!roleId) return;
    const pending = details.resumes.filter((resume) => resume.candidateId && ['completed', 'failed'].includes(resume.status))
      .filter((resume) => {
        const key = `${details.sessionId}:${resume.id}:${JSON.stringify(resume.evaluation)}:${JSON.stringify(resume.preliminaryEvaluation)}`;
        if (refreshedAssessmentKeys.current.has(key)) return false;
        refreshedAssessmentKeys.current.add(key);
        return true;
      });
    if (!pending.length) return;
    let active = true;
    void (async () => {
      const result = await refreshLinkedCandidateAssessments({ ...details, resumes: pending }, session.access_token);
      if (active && result.failedCandidateIds.length) {
        setReviewError(`Screening results were saved, but ${result.failedCandidateIds.length} linked candidate assessment(s) could not be refreshed. Use Assess All Candidates in Insights to retry.`);
      }
    })();
    return () => { active = false; };
  }, [details, session?.access_token]);

  useEffect(() => {
    let active = true;
    if (!session?.access_token) return () => { active = false; };
    void (async () => {
      try {
        const first = candidateListResponseSchema.parse(await apiRequest<unknown>('/candidates?page=1&pageSize=100', {}, session.access_token));
        const candidates = [...first.items];
        for (let page = 2; candidates.length < first.total; page += 1) {
          const next = candidateListResponseSchema.parse(await apiRequest<unknown>(`/candidates?page=${page}&pageSize=100`, {}, session.access_token));
          candidates.push(...next.items);
          if (!next.items.length) break;
        }
        if (active) setCandidateOptions(candidates.map(({ id, name }) => ({ id, name })));
      } catch {
        if (active) setCandidateOptionsError('Candidate records could not be loaded. You can still screen resumes and link them later from each candidate report.');
      }
    })();
    return () => { active = false; };
  }, [session?.access_token]);

  async function loadScreeningResults(sessionId: string, accessToken: string, waitForCompletion: boolean, isCurrent: () => boolean = () => true, initialDetails?: ScreeningDetailsResponse) {
    let current = initialDetails;
    if (!current) {
      if (!isCurrent()) return;
      current = screeningDetailsResponseSchema.parse(await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}`, {}, accessToken));
      if (!isCurrent()) return;
      setDetails(current);
    }
    if (current.status === 'processing' && waitForCompletion) {
      const latest = await pollScreeningUntilSettled(current, async () => screeningDetailsResponseSchema.parse(
        await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}`, {}, accessToken),
      ), {
        wait: waitForScreeningPoll,
        maxAttempts: SCREENING_MAX_POLL_ATTEMPTS,
        isCurrent,
        onUpdate: setDetails,
      });
      if (!latest || !isCurrent()) return;
      current = latest;
    }
    if (!isCurrent()) return;
    const rankingResult = await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}/ranking`, {}, accessToken);
    if (!isCurrent()) return;
    setRankingData(screeningRankingResponseSchema.parse(rankingResult));
  }

  useEffect(() => {
    let active = true;
    if (!session?.access_token || !isValidScreeningSessionId(storedSessionId)) return;
    if (cachedNavigation?.details.sessionId === storedSessionId) {
      if (cachedNavigation.details.status === 'processing' || !cachedNavigation.rankingData) {
        void loadScreeningResults(storedSessionId, session.access_token, cachedNavigation.details.status === 'processing', () => active, cachedNavigation.details)
          .catch((cause) => { if (active) setError(screeningErrorMessage(cause, 'Could not refresh screening results.')); });
      }
      return () => { active = false; };
    }
    void (async () => {
      try {
        const value = await apiRequest<unknown>(`/screenings/${encodeURIComponent(storedSessionId!)}`, {}, session.access_token);
        if (!active) return;
        const initial = screeningDetailsResponseSchema.parse(value);
        setDetails(initial);
        setSubmitted(screeningSubmissionResponseSchema.parse({
          sessionId: initial.sessionId, status: initial.status,
          resumes: initial.resumes.map(({ id, filename, status }) => ({ id, filename, status })),
        }));
        if (!active) return;
        await loadScreeningResults(initial.sessionId, session.access_token, true, () => active, initial);
      } catch (cause) {
        if (active) setError(screeningErrorMessage(cause, 'Could not restore screening progress.'));
      }
    })();
    return () => { active = false; };
  }, [session?.access_token, session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id || !submitted || !details || submitted.sessionId !== details.sessionId) return;
    screeningNavigationCache.set(session.user.id, submitted.sessionId, { submitted, details, selectedIds, comparison, rankingData, report, candidateSearch, expandedDetailsId });
  }, [session?.user?.id, submitted, details, selectedIds, comparison, rankingData, report, candidateSearch, expandedDetailsId]);

  function addFiles(files: FileList | null) {
    if (!files || submitting) return;
    if (session?.user?.id && submitted?.sessionId) screeningNavigationCache.delete(session.user.id, submitted.sessionId);
    const messages: string[] = [];
    const accepted: SelectedResume[] = [];
    const currentTotal = resumes.length;
    for (const file of Array.from(files)) {
      const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        messages.push(`${file.name}: unsupported format. Choose a PDF or DOCX resume.`);
      } else if (file.size === 0) {
        messages.push(`${file.name}: the selected file is empty.`);
      } else if (file.size > MAX_FILE_BYTES) {
        messages.push(`${file.name}: exceeds the 10 MB per-file limit.`);
      } else if (currentTotal + accepted.length >= MAX_FILES) {
        messages.push(`${file.name}: a screening session can include at most ${MAX_FILES} resumes.`);
      } else {
        accepted.push({ id: `resume-${nextFileId.current++}`, file });
      }
    }
    setResumes((current) => [...current, ...accepted]);
    idempotencyKey.current = null;
    try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ }
    setValidationMessages(messages);
    setError('');
    setDuplicateCandidateIds([]);
    setSubmitted(null);
    setDetails(null);
    setRankingData(null);
    setComparison(null);
    setReport(null);
    setSelectedIds([]);
    setCandidateSearch('');
    setExpandedDetailsId(null);
    setDetails(null);
    setRankingData(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeFile(id: string) {
    setResumes((current) => removePendingResume(current, id));
    idempotencyKey.current = null;
    try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ }
    setValidationMessages([]);
    setError('');
    setDuplicateCandidateIds([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeAllFiles() {
    if (submitting || resumes.length === 0) return;
    setResumes(clearPendingResumes());
    setValidationMessages([]);
    setError('');
    setDuplicateCandidateIds([]);
    idempotencyKey.current = null;
    try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ }
    if (inputRef.current) inputRef.current.value = '';
  }

  function clearVisibleResults() {
    if (clearingResultsRef.current || !canClearVisibleScreeningResults(submitted, details, clearingResults)) return;
    clearingResultsRef.current = true;
    setClearingResults(true);
    if (session?.user?.id && submitted) screeningNavigationCache.delete(session.user.id, submitted.sessionId);
    if (submitted && storedScreeningSessionId() === submitted.sessionId) {
      try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ }
    }
    setSubmitted(null);
    setDetails(null);
    setSelectedIds([]);
    setComparison(null);
    setRankingData(null);
    setReport(null);
    setCandidateSearch('');
    setExpandedDetailsId(null);
    setReviewError('');
    setResultsNotice('Screening results were cleared from this view. Saved screening records and files were not deleted.');
  }

  async function startScreening(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (submitting) return;
    setError('');
    setResultsNotice('');
    clearingResultsRef.current = false;
    setClearingResults(false);
    setDuplicateCandidateIds([]);
    setSubmitted(null);
    if (!session?.access_token) {
      setError('Your secure session is unavailable. Sign in again before submitting resumes.');
      return;
    }
    if (!jobTitle.trim() || jobTitle.trim().length > 200) {
      setError('Enter a job title of no more than 200 characters.');
      return;
    }
    if (jobDescription.trim().length < 50 || jobDescription.trim().length > 30000) {
      setError('Enter a job description between 50 and 30,000 characters.');
      return;
    }
    if (resumes.length === 0) {
      setError('Select at least one PDF or DOCX resume.');
      return;
    }

    setSubmitting(true);
    let submissionAccepted = false;
    try {
      const body = buildScreeningRequest(jobTitle.trim(), jobDescription.trim(), resumes);
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await apiRequest<unknown>('/screenings', {
        method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey.current },
      }, session.access_token);
      const parsed = screeningSubmissionResponseSchema.parse(response);
      if (parsed.resumes.length !== resumes.length) {
        throw new Error('The screening service returned a different number of resumes than submitted.');
      }
      idempotencyKey.current = null;
      clearDraft(jobDraft);
      setResumes(clearPendingResumes());
      setValidationMessages([]);
      if (inputRef.current) inputRef.current.value = '';
      try { sessionStorage.setItem(SCREENING_SESSION_STORAGE_KEY, parsed.sessionId); } catch { /* session persistence is optional when storage is unavailable */ }
      setSubmitted(parsed);
      submissionAccepted = true;
      await loadScreeningResults(parsed.sessionId, session.access_token, true);
      setSelectedIds([]);
      setComparison(null);
      setReport(null);
      setExpandedDetailsId(null);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'CANDIDATE_RESUME_ALREADY_LINKED') {
        const details = cause.details && typeof cause.details === 'object' ? cause.details as { candidateIds?: unknown } : {};
        setDuplicateCandidateIds(Array.isArray(details.candidateIds) ? details.candidateIds.filter((id): id is string => typeof id === 'string') : []);
      }
      setError(submissionAccepted
        ? `Screening was accepted, but its results could not be loaded yet. Your session is saved. ${screeningErrorMessage(cause, 'Try loading the results again.')}`
        : screeningErrorMessage(cause, 'The screening response could not be verified. No results are shown.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function retryResults() {
    if (!submitted || !session?.access_token) {
      await startScreening();
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await loadScreeningResults(submitted.sessionId, session.access_token, false);
    } catch (cause) {
      setError(screeningErrorMessage(cause, 'Could not load screening results.'));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleCandidate(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setComparison(null);
    setReport(null);
    setReviewError('');
  }

  function toggleVisibleCandidates(ids: string[]) {
    setSelectedIds((current) => {
      const allVisibleSelected = ids.length > 0 && ids.every((id) => current.includes(id));
      return allVisibleSelected
        ? current.filter((id) => !ids.includes(id))
        : Array.from(new Set([...current, ...ids])).slice(0, MAX_FILES);
    });
    setComparison(null);
    setReport(null);
    setReviewError('');
  }

  async function compareCandidates() {
    if (!submitted || !session?.access_token || selectedIds.length < 2 || reviewBusy) return;
    setReviewBusy(true);
    setReviewError('');
    try {
      const value = await apiRequest<unknown>(`/screenings/${encodeURIComponent(submitted.sessionId)}/compare`, {
        method: 'POST', body: JSON.stringify({ resumeIds: selectedIds }),
      }, session.access_token);
      setComparison(screeningComparisonResponseSchema.parse(value));
    } catch (cause) {
      setReviewError(screeningErrorMessage(cause, 'Could not compare the saved screening results.'));
      setComparison(null);
    } finally { setReviewBusy(false); }
  }

  async function generateReport() {
    if (!submitted || !session?.access_token || selectedIds.length < 2 || reviewBusy) return;
    setReviewBusy(true);
    setReviewError('');
    try {
      const value = await apiRequest<unknown>(`/screenings/${encodeURIComponent(submitted.sessionId)}/report`, {
        method: 'POST', body: JSON.stringify({ resumeIds: selectedIds }),
      }, session.access_token);
      setReport(screeningReportResponseSchema.parse(value));
    } catch (cause) {
      setReviewError(screeningErrorMessage(cause, 'Could not generate a report from saved screening results.'));
      setReport(null);
    } finally { setReviewBusy(false); }
  }

  async function retryResume(resumeId: string) {
    if (!submitted || !session?.access_token || retryingResumeId) return;
    setRetryingResumeId(resumeId);
    setReviewError('');
    try {
      const result = await apiRequest<unknown>(`/screenings/${encodeURIComponent(submitted.sessionId)}/resumes/${encodeURIComponent(resumeId)}/retry`, { method: 'POST' }, session.access_token);
      screeningRetryResponseSchema.parse(result);
      await loadScreeningResults(submitted.sessionId, session.access_token, true);
    } catch (cause) {
      setReviewError(screeningErrorMessage(cause, 'Could not retry this resume evaluation.'));
    } finally { setRetryingResumeId(null); }
  }

  function downloadCsv() {
    if (!report) return;
    const blob = new Blob([screeningReportCsv(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `devrank-screening-${report.details.sessionId}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(event.currentTarget.files);
  }

  function handleFileDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);
    addFiles(event.dataTransfer.files);
  }

  const canStartScreening = jobTitle.trim().length > 0 && jobTitle.trim().length <= 200
    && jobDescription.trim().length >= 50 && jobDescription.trim().length <= 30000
    && resumes.length > 0;
  return (
    <div className="resume-screening-page">
      <header className="resume-screening-heading">
        <div>
          <h1>Resume Screening</h1>
          <p>Create a job-specific screening session and review evidence-grounded results.</p>
        </div>
        <span className="screening-rubric-label">Resume job-match · separate from developer score</span>
      </header>

      <form className="screening-form" onSubmit={(event) => void startScreening(event)}>
        <SessionDraftNotice status={draftStatus} persisted={persisted} onDiscard={() => { clearDraft(emptyScreeningDraft); setResumes([]); setValidationMessages([]); setError(''); if (inputRef.current) inputRef.current.value = ''; }} restoredMessage="Job details restored from this browser tab. Resume files are not stored and must be selected again."/>
        <section className="screening-panel" aria-labelledby="screening-job-title">
          <div className="screening-panel-heading">
            <span className="screening-step">01</span>
            <div><h2 id="screening-job-title">Job details</h2></div>
          </div>
          <div className="screening-job-layout">
            <div className="screening-job-fields">
              <label className="screening-field">Job title
                <input value={jobTitle} onChange={(event) => { setJobDraft((current) => ({ ...current, jobTitle: event.target.value })); setSubmitted(null); idempotencyKey.current = null; try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ } }} maxLength={200} required placeholder="e.g. Senior Backend Engineer" />
              </label>
              <label className="screening-field">Job description
                <textarea value={jobDescription} onChange={(event) => { setJobDraft((current) => ({ ...current, jobDescription: event.target.value })); setSubmitted(null); idempotencyKey.current = null; try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ } }} minLength={50} maxLength={30000} required rows={7} placeholder="Describe the role responsibilities, required skills, experience, and qualifications." />
                <span className="screening-field-hint">{jobDescription.length.toLocaleString()} / 30,000 characters · minimum 50</span>
              </label>
            </div>
          </div>
        </section>

        <section className="screening-panel" aria-labelledby="screening-files-title">
          <div className="screening-panel-heading">
            <span className="screening-step">02</span>
            <div><h2 id="screening-files-title">Resume files</h2><p>PDF or DOCX · up to 20 files · 10 MB per file</p></div>
          </div>
          <div className="screening-upload-layout">
          <div className={`screening-upload-area${isDraggingFiles ? ' is-dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setIsDraggingFiles(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFiles(false); }} onDrop={handleFileDrop}>
            <span aria-hidden="true" className="screening-upload-icon">⇧</span>
            <strong>{isDraggingFiles ? 'Drop resumes to add' : 'Add resumes to this screening'}</strong>
            <span>PDF or DOCX · up to 20 files · 10 MB maximum per file</span>
            <input ref={inputRef} id="screening-resumes" className="screening-file-input" type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} aria-label="Choose PDF or DOCX resumes" />
            <label className="secondary-button screening-browse-button" htmlFor="screening-resumes">Browse files</label>
            <small>Files are sent to the screening service when you start screening.</small>
          </div>
          </div>

          {validationMessages.length > 0 && <ul className="screening-validation-list" role="alert">{validationMessages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>}
          <div className="screening-selected-files-toolbar">
            <span>{resumes.length} of {MAX_FILES} resumes selected</span>
            <button className="screening-remove-all-button" type="button" onClick={removeAllFiles} disabled={submitting || resumes.length === 0} aria-label="Remove all selected resumes">Remove All</button>
          </div>
          {resumes.length > 0 ? <ul className="screening-file-list" aria-label="Selected resume files">
            {resumes.map(({ id, file }) => <li key={id}>
              <span className="screening-file-icon" aria-hidden="true">{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOC'}</span>
              <span className="screening-file-copy"><strong>{file.name}</strong><small>{formatSize(file.size)} · Ready to submit</small></span>
              <button className="screening-remove-button" type="button" onClick={() => removeFile(id)} disabled={submitting} aria-label={`Remove ${file.name}`}>Remove</button>
            </li>)}
          </ul> : <p className="screening-empty-files">No resume files selected.</p>}
          {candidateOptionsError && <p className="screening-field-hint" role="status">{candidateOptionsError}</p>}
        </section>

        {error && <div className="screening-alert" role="alert"><p>{error}</p><ExistingCandidateResumeLinks candidateIds={duplicateCandidateIds} candidates={candidateOptions}/>{duplicateCandidateIds.length > 0
          ? <p>The duplicate check stopped this batch before creating a screening session. To evaluate a new file, leave its candidate unlinked, submit it, then use Replace linked result from that candidate’s report after processing completes.</p>
          : <button type="button" className="secondary-button" onClick={() => void retryResults()} disabled={submitting}>{submitting ? 'Retrying…' : 'Try again'}</button>}</div>}
        <div className="screening-form-footer">
          <p>Resume job-match results will remain separate from existing GitHub, LeetCode, and developer evaluation scores.</p>
          <button className="primary-button" type="submit" disabled={submitting || !canStartScreening}>
            {submitting ? 'Submitting…' : <>Start Screening <span aria-hidden="true">→</span></>}
          </button>
        </div>
      </form>

      <section className="screening-panel screening-results-panel" aria-labelledby="screening-results-title">
        <div className="screening-panel-heading">
          <span className="screening-step">03</span>
          <div><h2 id="screening-results-title">Screening status and results</h2></div>
        </div>
          {submitted ? <>
          <p className="screening-session-status" role="status">Screening {details?.status ?? submitted.status}</p>
          {details?.status === 'processing' && <p className="screening-progress" role="status">{screeningProgressLabel(details.resumes)}</p>}
          <ScreeningResultList resumes={details?.resumes ?? submitted.resumes.map((resume) => ({ ...resume, candidate: null, evaluation: null, error: undefined }))} />
          {(!details || details.status === 'processing' || !rankingData) && <button type="button" className="secondary-button" onClick={() => void retryResults()} disabled={submitting}>{submitting ? 'Loading results…' : details?.status === 'processing' ? 'Refresh results' : 'Retry loading results'}</button>}
          {details && details.resumes.every((resume) => resume.status === 'failed') && <p className="screening-empty-results">No resumes produced a usable evaluation. Review each processing error and retry with supported text-based files.</p>}
          {details && <div className="screening-review-tools">
            <h3>Compare candidates and rank saved results</h3>
            <div className="screening-review-actions">
              <button type="button" className="primary-button" onClick={() => void compareCandidates()} disabled={reviewBusy || selectedIds.length < 2}>{reviewBusy ? 'Comparing…' : 'Compare selected candidates'}</button>
              <button type="button" className="secondary-button" onClick={() => void generateReport()} disabled={reviewBusy || selectedIds.length < 2}>{reviewBusy ? 'Generating…' : 'Generate Report'}</button>
              {selectedIds.length < 2 && <small>Select at least two completed resumes in the table.</small>}
            </div>
            {comparison && <p role="status">The API confirmed {comparison.candidates.length} selected candidates in this screening context.</p>}
            {reviewError && <p className="screening-alert" role="alert">{reviewError}</p>}
          </div>}
          {rankingData && <section className="screening-comparison" aria-label="Candidate comparison">
            <h3>Candidate ranking · {rankingData.jobTitle}</h3>
            {details && (() => {
              const { scored, unscored, rankById } = filterAndSortScreeningResumes(details, rankingData.ranking, candidateSearch);
              const visibleEligibleIds = [...scored, ...unscored].filter((resume) => resume.status === 'completed').map((resume) => resume.id);
              const successfullyScored = details.resumes.filter((resume) => resume.evaluation?.score !== undefined).length;
              const scoreCell = (resume: ScreeningDetailsResponse['resumes'][number]) => {
                const presentation = scorePresentation(resume);
                return presentation ? <div className="screening-score-cell"><div className="screening-score-copy"><span className={`screening-score-badge score-${scoreBand(presentation.score)}`}>{presentation.score}%</span></div><span className="screening-score-track" role="progressbar" aria-label={`Job match score for ${resume.candidate?.name ?? 'candidate'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={presentation.score}><span className={`score-fill score-${scoreBand(presentation.score)}`} style={{ width: `${presentation.score}%` }} /></span></div> : <span className="score-unavailable">Unavailable</span>;
              };
              const tableRow = (resume: ScreeningDetailsResponse['resumes'][number]) => {
                const rank = rankById.get(resume.id)?.rank;
                return <tr key={resume.id}>
                  <td><input type="checkbox" aria-label={`Select ${resume.candidate?.name ?? 'candidate'}, ${resume.filename}`} checked={selectedIds.includes(resume.id)} disabled={resume.status !== 'completed' || reviewBusy} onChange={() => toggleCandidate(resume.id)} /></td>
                  <td>{rank ? <span className="screening-rank-indicator">{rank}</span> : <span className="screening-rank-empty" aria-label="Not ranked">—</span>}</td>
                  <td><span className="screening-candidate-name">{resume.candidate?.name ?? 'Name not identified'}</span></td>
                  <td><span className="screening-resume-name" title={resume.filename}>{resume.filename}</span></td>
                  <td>{scoreCell(resume)}</td>
                  <td><div className="screening-row-actions"><button type="button" className="screening-details-button" aria-expanded={expandedDetailsId === resume.id} onClick={() => setExpandedDetailsId((current) => current === resume.id ? null : resume.id)}>View details</button>{resume.status === 'failed' && resume.retryCount !== undefined && resume.retryCount < 3 && screeningRetryableErrorCodes.includes(resume.errorCode as typeof screeningRetryableErrorCodes[number]) && <button type="button" className="screening-details-button" onClick={() => void retryResume(resume.id)} disabled={retryingResumeId !== null}>{retryingResumeId === resume.id ? 'Retrying…' : 'Retry'}</button>}</div></td>
                </tr>;
              };
              return <>
                <ScreeningSummaryCards totalResumes={details.resumes.length} successfullyScored={successfullyScored} />
                <div className="screening-table-controls">
                  <label>Search candidates<input type="search" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Name or filename" /></label>
                  <label className="screening-select-visible"><input type="checkbox" aria-label="Select all eligible candidates in the current result set" checked={visibleEligibleIds.length > 0 && visibleEligibleIds.every((id) => selectedIds.includes(id))} disabled={!visibleEligibleIds.length || reviewBusy} onChange={() => toggleVisibleCandidates(visibleEligibleIds)} />Select all eligible ({visibleEligibleIds.length})</label>
                </div>
                {(scored.length + unscored.length) === 0 ? <p className="screening-table-empty">No resumes match your search.</p> : <div className="screening-table-scroll" role="region" aria-label="Candidate ranking table" tabIndex={0}>
                  <table className="screening-ranking-table"><thead><tr><th scope="col" aria-label="Select" /><th scope="col">Rank</th><th scope="col">Candidate Name</th><th scope="col">Resume</th><th scope="col">Job Match Score</th><th scope="col">Action</th></tr></thead>
                    <tbody>{[...scored, ...unscored].map(tableRow)}</tbody>
                  </table>
                </div>}
                {expandedDetailsId && details.resumes.find((resume) => resume.id === expandedDetailsId) && (() => {
                  const selectedResume = details.resumes.find((resume) => resume.id === expandedDetailsId)!;
                  return <article className="screening-candidate-details" id={`resume-detail-${selectedResume.id}`}>
                    <h4>{selectedResume.candidate?.name ?? 'Name not identified'} · {selectedResume.filename}</h4>
                    {selectedResume.error && <p>{selectedResume.error}</p>}
                    {selectedResume.preliminaryEvaluation && <ul>{selectedResume.preliminaryEvaluation.criteria.filter((criterion) => criterion.matchedTerms.length > 0 || Boolean(criterion.evidenceExcerpt)).map((criterion) => <li key={`criterion-${criterion.id}`}><strong>{criterion.description}:</strong> {criterion.matchedTerms.join(', ')}{criterion.evidenceExcerpt ? ` — “${criterion.evidenceExcerpt}”` : ''}</li>)}</ul>}
                    {selectedResume.evaluation && <ul>{selectedResume.evaluation.requirements.filter((item) => item.evidence.length > 0).map((item) => <li key={item.id}><strong>{item.description}:</strong> {item.evidence.map(({ excerpt }) => `“${excerpt}”`).join(' · ')}</li>)}</ul>}
                  </article>;
                })()}
                {scored.length === 0 && unscored.length > 0 && <p className="screening-table-empty">No candidate scores are available yet. These resumes remain listed without a rank.</p>}
              </>;
            })()}
          </section>}
          {report && <section className="screening-report" aria-label="Generated screening report">
            <div className="screening-report-actions no-print"><h3>Saved-results report · {report.details.jobTitle}</h3><button type="button" className="secondary-button" onClick={downloadCsv}>Download CSV</button><button type="button" className="primary-button" onClick={() => window.print()}>Print / Save PDF</button></div>
            <div className="screening-report-paper">
              <h1>DevRank Resume Screening Report</h1><p>Generated {new Date(report.generatedAt).toLocaleString()} · Job: {report.details.jobTitle}</p>
              <p>{report.details.resumes.length} uploaded · {report.details.resumes.filter((item) => item.status === 'completed').length} processed · {report.details.resumes.filter((item) => item.status === 'failed').length} failed · {report.details.resumes.filter((item) => item.evaluation?.score !== undefined).length} scored</p>
              <h2>Candidate results</h2>
              <table><thead><tr><th>Candidate name</th><th>Resume</th><th>Rank</th><th>Score</th></tr></thead><tbody>{sortScreeningReportResumes(report).map((resume) => {
                const rank = report.ranking.ranked.find((item) => item.resumeId === resume.id)?.rank;
                const score = scorePresentation(resume);
                return <tr key={resume.id}><td>{resume.candidate?.name ?? 'Name not identified'}</td><td title={resume.filename}>{resume.filename}</td><td>{rank ?? 'Not ranked'}</td><td>{score ? `${score.score}%` : 'Unavailable'}</td></tr>;
              })}</tbody></table>
              <h2>Requirement evidence details</h2>
              {report.details.resumes.map((resume) => <article key={resume.id}><h3>{resume.candidate?.name ?? 'Name not identified'} · {resume.filename}</h3>
                {resume.evaluation ? <ul>{resume.evaluation.requirements.filter((item) => item.evidence.length > 0).map((item) => <li key={item.id}><strong>{item.description}:</strong> {item.evidence.map((entry) => `“${entry.excerpt}”`).join(' · ')}</li>)}</ul>
                  : resume.preliminaryEvaluation ? <ul>{resume.preliminaryEvaluation.criteria.filter((item) => item.matchedTerms.length > 0 || Boolean(item.evidenceExcerpt)).map((item) => <li key={item.id}><strong>{item.description}:</strong> {item.matchedTerms.join(', ')}{item.evidenceExcerpt ? ` — “${item.evidenceExcerpt}”` : ''}</li>)}</ul>
                    : <p>{resume.error ?? 'No resume details are available.'}</p>}
              </article>)}
            </div>
          </section>}
        </> : <div className="screening-results-empty"><span aria-hidden="true">◷</span><strong>No screening results yet</strong><p>Results will appear only after the API accepts and processes the selected resumes.</p></div>}
        {resultsNotice && <p className="screening-results-notice" role="status">{resultsNotice}</p>}
        <div className="screening-clear-results">
          <button className="screening-remove-all-button" type="button" onClick={clearVisibleResults}
            disabled={!canClearVisibleScreeningResults(submitted, details, clearingResults)}
            aria-label="Remove all screening results from this view">Remove All from view</button>
          <small>This clears only the current page view. Saved screening records, evaluations, candidates, and files are retained.</small>
        </div>
      </section>
    </div>
  );
}
