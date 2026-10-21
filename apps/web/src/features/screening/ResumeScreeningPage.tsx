import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { screeningComparisonResponseSchema, screeningDetailsResponseSchema, screeningRankingResponseSchema, screeningReportResponseSchema, screeningRetryableErrorCodes, screeningRetryResponseSchema, screeningSubmissionResponseSchema, type ScreeningComparisonResponse, type ScreeningDetailsResponse, type ScreeningReportResponse } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { screeningReportCsv } from './report-export';
import { filterAndSortScreeningResumes, scoreBand, scorePresentation } from './ranking-table';
import { ScreeningSummaryCards } from './ScreeningSummaryCards';
import { screeningProgressLabel } from './screening-progress';
import './resume-screening-page.css';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.pdf', '.docx'];
const SCREENING_POLL_MS = 1000;
const SCREENING_SESSION_STORAGE_KEY = 'devrank.resume-screening.session-id';

type SelectedResume = { id: string; file: File };
type SubmittedSession = ReturnType<typeof screeningSubmissionResponseSchema.parse>;

function waitForScreeningPoll(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, SCREENING_POLL_MS));
}

function formatSize(size: number): string {
  return size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function ResumeScreeningPage() {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const nextFileId = useRef(0);
  const idempotencyKey = useRef<string | null>(null);
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [resumes, setResumes] = useState<SelectedResume[]>([]);
  const [validationMessages, setValidationMessages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedSession | null>(null);
  const [details, setDetails] = useState<ScreeningDetailsResponse | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ScreeningComparisonResponse | null>(null);
  const [rankingData, setRankingData] = useState<ReturnType<typeof screeningRankingResponseSchema.parse> | null>(null);
  const [report, setReport] = useState<ScreeningReportResponse | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [retryingResumeId, setRetryingResumeId] = useState<string | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);

  async function loadScreeningResults(sessionId: string, accessToken: string, waitForCompletion: boolean, isCurrent: () => boolean = () => true) {
    let current: ScreeningDetailsResponse;
    do {
      if (!isCurrent()) return;
      const result = await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}`, {}, accessToken);
      current = screeningDetailsResponseSchema.parse(result);
      if (!isCurrent()) return;
      setDetails(current);
      if (current.status === 'processing' && waitForCompletion) await waitForScreeningPoll();
      else break;
    } while (current.status === 'processing');
    if (!isCurrent()) return;
    const rankingResult = await apiRequest<unknown>(`/screenings/${encodeURIComponent(sessionId)}/ranking`, {}, accessToken);
    if (!isCurrent()) return;
    setRankingData(screeningRankingResponseSchema.parse(rankingResult));
  }

  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    let storedSessionId: string | null = null;
    try { storedSessionId = sessionStorage.getItem(SCREENING_SESSION_STORAGE_KEY); } catch { return; }
    if (!storedSessionId || !/^[0-9a-f-]{36}$/i.test(storedSessionId)) return;
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
        await loadScreeningResults(initial.sessionId, session.access_token, true, () => active);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not restore screening progress.');
      }
    })();
    return () => { active = false; };
  }, [session?.access_token]);

  function addFiles(files: FileList | null) {
    if (!files) return;
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
    setSubmitted(null);
    setDetails(null);
    setRankingData(null);
    setComparison(null);
    setReport(null);
    setDetails(null);
    setRankingData(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function removeFile(id: string) {
    setResumes((current) => current.filter((resume) => resume.id !== id));
    idempotencyKey.current = null;
    try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ }
    setSubmitted(null);
  }

  async function startScreening(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (submitting) return;
    setError('');
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
    try {
      const body = new FormData();
      body.set('jobTitle', jobTitle.trim());
      body.set('jobDescription', jobDescription.trim());
      resumes.forEach(({ file }) => body.append('resumes', file, file.name));
      idempotencyKey.current ??= crypto.randomUUID();
      const response = await apiRequest<unknown>('/screenings', {
        method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey.current },
      }, session.access_token);
      const parsed = screeningSubmissionResponseSchema.parse(response);
      idempotencyKey.current = null;
      try { sessionStorage.setItem(SCREENING_SESSION_STORAGE_KEY, parsed.sessionId); } catch { /* session persistence is optional when storage is unavailable */ }
      if (parsed.resumes.length !== resumes.length) {
        throw new Error('The screening service returned a different number of resumes than submitted.');
      }
      setSubmitted(parsed);
      await loadScreeningResults(parsed.sessionId, session.access_token, true);
      setSelectedIds([]);
      setComparison(null);
      setReport(null);
      setExpandedDetailsId(null);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'ApiNetworkError') {
        setError(cause.message);
      } else if (cause instanceof ApiRequestError) {
        setError(cause.message);
      } else {
        setError(cause instanceof Error && cause.message ? cause.message : 'The screening response could not be verified. No results are shown.');
      }
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
      await loadScreeningResults(submitted.sessionId, session.access_token, true);
    } catch (cause) {
      setError(cause instanceof ApiRequestError || cause instanceof Error ? cause.message : 'Could not load screening results.');
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
      setReviewError(cause instanceof Error ? cause.message : 'Could not compare the saved screening results.');
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
      setReviewError(cause instanceof Error ? cause.message : 'Could not generate a report from saved screening results.');
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
      setReviewError(cause instanceof Error ? cause.message : 'Could not retry this resume evaluation.');
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

  return (
    <div className="resume-screening-page">
      <header className="resume-screening-heading">
        <div>
          <span className="eyebrow"><span className="eyebrow-line" /> RECRUITER WORKSPACE</span>
          <h1>Resume Screening</h1>
          <p>Create a job-specific screening session and review evidence-grounded results.</p>
        </div>
        <span className="screening-rubric-label">Resume job-match · separate from developer score</span>
      </header>

      <form className="screening-form" onSubmit={(event) => void startScreening(event)}>
        <section className="screening-panel" aria-labelledby="screening-job-title">
          <div className="screening-panel-heading">
            <span className="screening-step">01</span>
            <div><h2 id="screening-job-title">Job details</h2><p>These requirements would be shared by every resume in this session.</p></div>
          </div>
          <label className="screening-field">Job title
            <input value={jobTitle} onChange={(event) => { setJobTitle(event.target.value); setSubmitted(null); idempotencyKey.current = null; try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ } }} maxLength={200} required placeholder="e.g. Backend Engineer" />
          </label>
          <label className="screening-field">Job description
            <textarea value={jobDescription} onChange={(event) => { setJobDescription(event.target.value); setSubmitted(null); idempotencyKey.current = null; try { sessionStorage.removeItem(SCREENING_SESSION_STORAGE_KEY); } catch { /* optional browser storage */ } }} minLength={50} maxLength={30000} required rows={8} placeholder="Include the role responsibilities, required skills, experience, and relevant qualifications." />
            <span className="screening-field-hint">{jobDescription.length.toLocaleString()} / 30,000 characters · minimum 50</span>
          </label>
        </section>

        <section className="screening-panel" aria-labelledby="screening-files-title">
          <div className="screening-panel-heading">
            <span className="screening-step">02</span>
            <div><h2 id="screening-files-title">Resume files</h2><p>PDF or DOCX · up to 20 files · 10 MB per file</p></div>
          </div>
          <div className="screening-upload-area">
            <span aria-hidden="true" className="screening-upload-icon">⇧</span>
            <strong>Select resumes to add</strong>
            <span>Files remain in this browser unless the screening API accepts the submission.</span>
            <input ref={inputRef} id="screening-resumes" className="screening-file-input" type="file" multiple accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={handleFileChange} aria-label="Choose PDF or DOCX resumes" />
            <label className="secondary-button screening-browse-button" htmlFor="screening-resumes">Browse files</label>
          </div>

          {validationMessages.length > 0 && <ul className="screening-validation-list" role="alert">{validationMessages.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>}
          {resumes.length > 0 ? <ul className="screening-file-list" aria-label="Selected resume files">
            {resumes.map(({ id, file }) => <li key={id}>
              <span className="screening-file-icon" aria-hidden="true">{file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOC'}</span>
              <span className="screening-file-copy"><strong>{file.name}</strong><small>{formatSize(file.size)} · Ready to submit</small></span>
              <button className="screening-remove-button" type="button" onClick={() => removeFile(id)} aria-label={`Remove ${file.name}`}>Remove</button>
            </li>)}
          </ul> : <p className="screening-empty-files">No resume files selected.</p>}
        </section>

        {error && <div className="screening-alert" role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => void retryResults()} disabled={submitting}>{submitting ? 'Retrying…' : 'Try again'}</button></div>}
        <div className="screening-form-footer">
          <p>Resume job-match results will remain separate from existing GitHub, LeetCode, and developer evaluation scores.</p>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Start Screening'}
          </button>
        </div>
      </form>

      <section className="screening-panel screening-results-panel" aria-labelledby="screening-results-title">
        <div className="screening-panel-heading">
          <span className="screening-step">03</span>
          <div><h2 id="screening-results-title">Screening status and results</h2><p>Only server-returned, validated screening data is shown here.</p></div>
        </div>
        {submitted ? <>
          <p className="screening-session-status" role="status">Session {submitted.sessionId} · {details?.status ?? submitted.status}</p>
          {details?.status === 'processing' && <p className="screening-progress" role="status">{screeningProgressLabel(details.resumes)}</p>}
          <ul className="screening-file-list screening-status-list">
            {(details?.resumes ?? submitted.resumes.map((resume) => ({ ...resume, candidate: null, evaluation: null, error: undefined }))).map((resume) => <li key={resume.id}>
              <span className="screening-file-icon" aria-hidden="true">CV</span>
              <span className="screening-file-copy"><strong>{resume.filename}</strong>
                <small>Server status: {resume.status}{resume.error ? ` · ${resume.error}` : ''}</small>
                {resume.status === 'queued' || resume.status === 'uploaded' ? <small>Pending evaluation</small> : resume.status === 'processing' ? <small>Evaluation in progress</small> : null}
                {resume.candidate?.name && <small>Candidate: {resume.candidate.name}</small>}
                {resume.evaluation && <small>{resume.evaluation.score === undefined ? 'No score · insufficient evidence' : `Resume job-match score: ${resume.evaluation.score}/100 · ${resume.evaluation.status}`}</small>}
                {resume.evaluation?.categories.map((category) => {
                  const label = category.categoryId.replaceAll('_', ' ');
                  return <small key={category.categoryId}>{label}: {category.score === undefined ? category.status.replaceAll('_', ' ') : `${category.score}/100`}</small>;
                })}
                {resume.evaluation?.requirements.filter(({ status }) => status === 'insufficient_evidence').map((requirement) => <small key={requirement.id}>Missing evidence: {requirement.description}</small>)}
              </span>
            </li>)}
          </ul>
          {!details && <button type="button" className="secondary-button" onClick={() => void retryResults()} disabled={submitting}>{submitting ? 'Loading results…' : 'Retry loading results'}</button>}
          {details && details.resumes.every((resume) => resume.status === 'failed') && <p className="screening-empty-results">No resumes produced a usable evaluation. Review each processing error and retry with supported text-based files.</p>}
          {details && <div className="screening-review-tools">
            <h3>Compare candidates and rank saved results</h3>
            <p>Select at least two completed resumes from this job. Ranking uses saved deterministic scores; tied scores share a rank. This is decision support, not a hiring decision. Score colours are presentation-only guidance, not validated hiring criteria.</p>
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
            <p>{rankingData.ranking.rankingCriteria} Preliminary document matches appear in unranked rows and do not affect validated ranks. They measure text overlap; unverified criteria mean no supporting wording was found, not that the candidate lacks the qualification.</p>
            {details && (() => {
              const { scored, unscored, rankById } = filterAndSortScreeningResumes(details, rankingData.ranking, candidateSearch);
              const visibleEligibleIds = [...scored, ...unscored].filter((resume) => resume.status === 'completed').map((resume) => resume.id);
              const successfullyScored = rankingData.ranking.ranked.length;
              const statusLabel = (resume: ScreeningDetailsResponse['resumes'][number]) => resume.status === 'failed' ? 'Failed' : resume.status === 'queued' || resume.status === 'uploaded' ? 'Pending' : resume.status === 'processing' ? 'Processing' : resume.evaluation?.score !== undefined ? 'Scored' : 'Insufficient evidence';
              const scoreCell = (resume: ScreeningDetailsResponse['resumes'][number]) => {
                const presentation = scorePresentation(resume);
                return presentation ? <div className="screening-score-cell"><div className="screening-score-copy"><span className={`screening-score-badge score-${scoreBand(presentation.score)}${presentation.preliminary ? ' score-preliminary' : ''}`}>{presentation.score}%</span><small>{presentation.label}</small></div><span className="screening-score-track" role="progressbar" aria-label={`${presentation.label} for ${resume.candidate?.name ?? 'candidate'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={presentation.score}><span className={`score-fill score-${scoreBand(presentation.score)}${presentation.preliminary ? ' score-fill-preliminary' : ''}`} style={{ width: `${presentation.score}%` }} /></span></div> : <span className="score-unavailable">Unavailable</span>;
              };
              const tableRow = (resume: ScreeningDetailsResponse['resumes'][number]) => {
                const rank = rankById.get(resume.id)?.rank;
                return <tr key={resume.id}>
                  <td><input type="checkbox" aria-label={`Select ${resume.candidate?.name ?? 'candidate'}, ${resume.filename}`} checked={selectedIds.includes(resume.id)} disabled={resume.status !== 'completed' || reviewBusy} onChange={() => toggleCandidate(resume.id)} /></td>
                  <td>{rank ? <span className="screening-rank-indicator">{rank}</span> : <span className="screening-rank-empty" aria-label="Not ranked">—</span>}</td>
                  <td><span className="screening-candidate-name">{resume.candidate?.name ?? 'Name not identified'}</span></td>
                  <td><span className="screening-resume-name" title={resume.filename}>{resume.filename}</span></td>
                  <td>{scoreCell(resume)}</td>
                  <td><span className={`screening-status-pill status-${statusLabel(resume).toLowerCase().replaceAll(' ', '-')}`}>{statusLabel(resume)}</span></td>
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
                  <table className="screening-ranking-table"><thead><tr><th scope="col" aria-label="Select" /><th scope="col">Rank</th><th scope="col">Candidate Name</th><th scope="col">Resume</th><th scope="col">Job Match Score</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
                    <tbody>{scored.map(tableRow)}</tbody>
                    {unscored.length > 0 && <tbody className="screening-unscored-group"><tr><th colSpan={7} scope="rowgroup">Unranked · preliminary matches are not part of validated ranking</th></tr>{unscored.map(tableRow)}</tbody>}
                  </table>
                </div>}
                {expandedDetailsId && details.resumes.find((resume) => resume.id === expandedDetailsId) && (() => {
                  const selectedResume = details.resumes.find((resume) => resume.id === expandedDetailsId)!;
                  return <article className="screening-candidate-details" id={`resume-detail-${selectedResume.id}`}>
                    <h4>{selectedResume.candidate?.name ?? 'Name not identified'} · {selectedResume.filename}</h4>
                    {selectedResume.error && <p>{selectedResume.error}</p>}
                    {selectedResume.preliminaryEvaluation && <><p>Preliminary document match: {selectedResume.preliminaryEvaluation.score}% · {selectedResume.preliminaryEvaluation.evidenceCoverage}% of weighted criteria have text support. Unverified means the resume does not state matching text; it does not mean the candidate lacks that qualification.</p><ul>{selectedResume.preliminaryEvaluation.criteria.map((criterion) => <li key={`preliminary-${criterion.id}`}><strong>{criterion.description}:</strong> {criterion.status === 'supported' ? `Supported by ${criterion.matchedTerms.join(', ')}` : 'Unverified in resume text'}{criterion.evidenceExcerpt ? ` — “${criterion.evidenceExcerpt}”` : ''}</li>)}</ul></>}
                    {selectedResume.evaluation ? <ul>{selectedResume.evaluation.requirements.map((item) => <li key={item.id}><strong>{item.description}:</strong> {item.status.replaceAll('_', ' ')}{item.evidence[0] ? ` — “${item.evidence[0].excerpt}”` : ' — Evidence not available'}</li>)}</ul> : <p>Detailed validated evaluation evidence is not available for this resume.</p>}
                  </article>;
                })()}
                {scored.length === 0 && unscored.length > 0 && <p className="screening-table-empty">No validated scores are available yet. Preliminary matches remain separately labeled and are not assigned a rank.</p>}
              </>;
            })()}
          </section>}
          {report && <section className="screening-report" aria-label="Generated screening report">
            <div className="screening-report-actions no-print"><h3>Saved-results report · {report.details.jobTitle}</h3><button type="button" className="secondary-button" onClick={downloadCsv}>Download CSV</button><button type="button" className="primary-button" onClick={() => window.print()}>Print / Save PDF</button></div>
            <div className="screening-report-paper">
              <h1>DevRank Resume Screening Report</h1><p>Generated {new Date(report.generatedAt).toLocaleString()} · Job: {report.details.jobTitle}</p>
              <p>{report.details.resumes.length} uploaded · {report.details.resumes.filter((item) => item.status === 'completed').length} processed · {report.details.resumes.filter((item) => item.status === 'failed').length} failed · {report.details.resumes.filter((item) => item.evaluation?.score !== undefined).length} scored</p>
              <h2>Candidate results</h2>
              <table><thead><tr><th>Selected for comparison</th><th>Candidate name</th><th>Resume</th><th>Status</th><th>Rank</th><th>Score</th></tr></thead><tbody>{report.details.resumes.map((resume) => {
                const rank = report.ranking.ranked.find((item) => item.resumeId === resume.id)?.rank;
                const score = scorePresentation(resume);
                return <tr key={resume.id}><td>{report.selectedResumeIds.includes(resume.id) ? 'Yes' : 'No'}</td><td>{resume.candidate?.name ?? 'Name not identified'}</td><td title={resume.filename}>{resume.filename}</td><td>{resume.status}</td><td>{rank ?? 'Not ranked'}</td><td>{score ? `${score.score}% · ${score.label}` : 'Unavailable'}</td></tr>;
              })}</tbody></table>
              <h2>Ranking criteria and limitations</h2><p>Ranking is based on saved deterministic resume job-match scores in descending order; equal scores are ties. Failed or unscored resumes are excluded from scored ranking. Missing evidence is not treated as zero.</p>
              <p>Scores assist recruiter review and are not hiring decisions. Resume content may be incomplete or unverified. Review the source resume and independently validate qualifications.</p>
              <h2>Requirement evidence details</h2>
              {report.details.resumes.map((resume) => <article key={resume.id}><h3>{resume.candidate?.name ?? 'Name not identified'} · {resume.filename}</h3>
                {resume.evaluation ? <ul>{resume.evaluation.requirements.map((item) => <li key={item.id}><strong>{item.description}:</strong> {item.status.replaceAll('_', ' ')}{item.evidence.map((entry) => ` — “${entry.excerpt}”`).join('') || ' — Evidence not available'}</li>)}</ul> : <p>{resume.error ?? 'No evaluation evidence is available.'}</p>}
              </article>)}
            </div>
          </section>}
        </> : <div className="screening-results-empty"><span aria-hidden="true">◷</span><strong>No screening results yet</strong><p>Results will appear only after the API accepts and processes the selected resumes.</p></div>}
      </section>
    </div>
  );
}
