import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { unifiedCandidateReportSchema, type UnifiedCandidateReport } from '@devrank/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import './unified-candidate-report.css';

type State = { status: 'loading' } | { status: 'ready'; report: UnifiedCandidateReport } | { status: 'error'; message: string };
function readable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'Unavailable';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const text = JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}
function date(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available'; }

export function UnifiedCandidateReportPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!session?.access_token) { setState({ status: 'error', message: 'Sign in again to view this report.' }); return; }
    setState({ status: 'loading' });
    try {
      const response = unifiedCandidateReportSchema.parse(await apiRequest<unknown>(`/candidates/${encodeURIComponent(id)}/unified-report`, { signal }, session.access_token));
      if (!signal?.aborted) setState({ status: 'ready', report: response });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ status: 'error', message: error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : 'Could not load the candidate report.' });
    }
  }, [id, session?.access_token]);
  async function linkResume() {
    if (!session?.access_token || !selectedResumeId || state.status !== 'ready' || linking) return;
    setLinking(true); setLinkError('');
    try {
      await apiRequest(`/candidates/${encodeURIComponent(id)}/unified-report/resume`, { method: 'POST', body: JSON.stringify({ resumeId: selectedResumeId }) }, session.access_token);
      setSelectedResumeId(''); await load();
    } catch (error) { setLinkError(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : 'Could not attach this resume result.'); }
    finally { setLinking(false); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (state.status === 'loading') return <main className="unified-report-page"><p role="status">Loading saved evaluation report…</p></main>;
  if (state.status === 'error') return <main className="unified-report-page"><section className="unified-report-state" role="alert"><h1>Report unavailable</h1><p>{state.message}</p><button type="button" className="primary-button" onClick={() => void load()}>Try again</button><Link className="secondary-button link-button" to={`/candidates/${id}`}>Back to candidate</Link></section></main>;
  const { report } = state;
  return <UnifiedCandidateReportView report={report} selectedResumeId={selectedResumeId} linking={linking} linkError={linkError}
    onSelectResume={setSelectedResumeId} onLinkResume={() => void linkResume()}/>;
}

export function UnifiedCandidateReportView({ report, selectedResumeId = '', linking = false, linkError = '', onSelectResume = () => undefined, onLinkResume = () => undefined }: {
  report: UnifiedCandidateReport;
  selectedResumeId?: string;
  linking?: boolean;
  linkError?: string;
  onSelectResume?: (id: string) => void;
  onLinkResume?: () => void;
}) {
  const sources = [['GitHub', report.sources.github], ['LeetCode', report.sources.leetcode]] as const;
  return <main className="unified-report-page">
    <header className="unified-report-header"><div><Link className="back-link" to={`/candidates/${report.candidate.id}`}>← <span>Candidate profile</span></Link><span className="eyebrow"><span className="eyebrow-line"/> UNIFIED CANDIDATE REPORT</span><h1>{report.candidate.name}</h1><p>{report.candidate.email ?? 'Email not provided'} · {report.job.roleLabel ?? 'No saved target role'}</p></div><button className="primary-button no-print" type="button" onClick={() => window.print()}>Download / Print PDF</button></header>
    <section className="unified-report-summary"><div><span>Saved platform evaluation</span><strong>{report.platformEvaluation.overallIndex === null ? 'Overall index withheld' : `${report.platformEvaluation.overallIndex} / 100`}</strong><small>{report.platformEvaluation.status.replaceAll('_', ' ')} · evaluated {date(report.platformEvaluation.evaluatedAt)}</small></div><p>GitHub and LeetCode use the existing v4 evidence index. Resume job-match scores use a different rubric, so this report does not combine them into a single score.</p></section>
    <section className="unified-report-section"><h2>Target role</h2><p><strong>{report.job.roleLabel ?? 'Not saved'}</strong></p><p>{report.job.description ?? 'A role description was not saved with this evaluation.'}</p></section>
    <section className="unified-report-section"><h2>Saved source results</h2><div className="unified-source-grid">{sources.map(([label, source]) => <article className="unified-source-card" key={label}><header><h3>{label}</h3><span>{source.status.replaceAll('_', ' ')}</span></header><p>Source snapshot: {date(source.capturedAt)} · {source.provenance ?? 'No source snapshot'}</p>{source.findings.length > 0 ? <ul className="unified-findings">{source.findings.map((finding) => <li key={finding.categoryId}><strong>{finding.displayName}</strong><span>{finding.score === undefined ? 'No score' : `${finding.score}/100`}</span><small>{finding.formula}</small>{Object.keys(finding.metrics).length > 0 && <small>{Object.entries(finding.metrics).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ')}</small>}</li>)}</ul> : <p>No saved category score for this source.</p>}{Object.keys(source.values).length > 0 && <details><summary>Saved profile data</summary><dl>{Object.entries(source.values).map(([key, value]) => <div key={key}><dt>{key.replaceAll('_', ' ')}</dt><dd>{readable(value)}</dd></div>)}</dl></details>}<small>Provider data is unverified and snapshot freshness has not been assessed.</small>{source.limitations.length > 0 && <ul>{source.limitations.map((item) => <li key={item}>{item}</li>)}</ul>}</article>)}</div></section>
    <section className="unified-report-section"><h2>Summary and improvement areas</h2>{report.platformEvaluation.strengths.length ? <><h3>Recorded strengths</h3><ul>{report.platformEvaluation.strengths.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></> : <p>No saved strengths are available.</p>}{report.platformEvaluation.improvementAreas.length ? <><h3>Recorded improvement areas</h3><ul>{report.platformEvaluation.improvementAreas.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></> : <p>No saved improvement areas are available.</p>}{report.platformEvaluation.rubricNotice && <p className="unified-report-note">{report.platformEvaluation.rubricNotice}</p>}</section>
    <section className="unified-report-section unified-resume-section">
      <h2>Resume job-match evaluation</h2>
      <p>{report.resume.message}</p>
      {report.resume.status === 'available' && <div>
        <p><strong>{report.resume.jobTitle ?? 'Role unavailable'}</strong> · {report.resume.statusLabel} · evaluated {date(report.resume.evaluatedAt)}</p>
        {report.resume.jobDescription && <details><summary>Job description</summary><p>{report.resume.jobDescription}</p></details>}
        {report.resume.validatedScore !== null && <p>Validated resume score: <strong>{report.resume.validatedScore}/100</strong></p>}
        {report.resume.preliminaryScore !== null && <p>Preliminary match: <strong>{report.resume.preliminaryScore}/100</strong></p>}
        {report.resume.evidence.length > 0 && <div><h3>Supporting resume evidence</h3><ul>{report.resume.evidence.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
      </div>}
      {report.resume.limitations.map((item) => <small key={item}>{item}</small>)}
      {report.resume.status === 'unlinked' && report.linkableResumes.length > 0 && <div className="resume-link-control">
        <label htmlFor="resume-result-link">Attach a saved resume result</label>
        <select id="resume-result-link" value={selectedResumeId} onChange={(event) => onSelectResume(event.target.value)}>
          <option value="">Choose a saved result…</option>
          {report.linkableResumes.filter((item) => item.status === 'completed' || item.status === 'failed').map((item) => <option key={item.id} value={item.id}>{item.candidateName ?? 'Name not identified'} · {item.filename} · {item.jobTitle} · {item.status} · {item.scoreLabel}{item.score === null ? '' : ` ${item.score}/100`}</option>)}
        </select>
        <button className="secondary-button" type="button" disabled={!selectedResumeId || linking} onClick={onLinkResume}>{linking ? 'Attaching…' : 'Attach result'}</button>
        {linkError && <p role="alert">{linkError}</p>}
      </div>}
      {report.resume.status === 'unlinked' && report.linkableResumes.length === 0 && <p>No unlinked screening results are available in your workspace.</p>}
    </section>
    <footer>Generated {date(report.generatedAt)}. Scores summarize saved evidence and are decision support only; they do not establish identity, competence, or hiring suitability.</footer>
  </main>;
}
