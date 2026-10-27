import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { evaluationRolesResponseSchema, unifiedAssessmentSchema, unifiedCandidateReportSchema, type EvaluationRole, type UnifiedAssessment, type UnifiedCandidateReport } from '@devrank/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useWorkspaceBreadcrumbLabels } from '../../components/layout/WorkspaceBreadcrumbContext';
import './unified-candidate-report.css';

type State = { status: 'loading' } | { status: 'ready'; report: UnifiedCandidateReport } | { status: 'error'; message: string };
function readable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'Unavailable';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? String(value);
}
function date(value: string | null) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available'; }
function displayLabel(value: string) { return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\s+/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function conciseFormula(value: string) { const [summary] = value.split(';'); return summary.trim().replace(/[.!?]+$/, ''); }
function repositoryCoverage(values: Record<string, unknown>) {
  const repositories = Array.isArray(values.repositories) ? values.repositories : undefined;
  const publicCount = typeof values.publicRepositoryCount === 'number' ? values.publicRepositoryCount : undefined;
  const details = repositories ? repositories.length + ' repository detail records saved' : 'repository detail list not included';
  const count = publicCount === undefined ? 'public repository count not included' : publicCount + ' public repositories reported';
  const limit = values.repositoriesTruncated === true ? 'saved repository details are truncated' : 'saved repository details are not marked truncated';
  return count + '; ' + details + '; ' + limit + '.';
}

function AnimatedScore({ value }: { value: number }) {
  const shouldAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [displayValue, setDisplayValue] = useState(shouldAnimate ? 0 : value);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion || typeof window.requestAnimationFrame !== 'function') {
      setDisplayValue(value);
      return;
    }
    let startTime: number | undefined;
    let frame = 0;
    const duration = 450;
    const tick = (time: number) => {
      startTime ??= time;
      const progress = Math.min(1, (time - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(value * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  const decimalPlaces = String(value).split('.')[1]?.length ?? 0;
  const visibleValue = displayValue >= value ? String(value) : displayValue.toFixed(decimalPlaces);
  return <><span className="unified-score-count screen-only" aria-hidden="true">{visibleValue}</span><span className="unified-score-count unified-score-print">{value}</span></>;
}
export function UnifiedCandidateReportPage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const [roles, setRoles] = useState<EvaluationRole[]>([]);
  const [roleId, setRoleId] = useState<EvaluationRole['id']>('software_developer');
  const [assessment, setAssessment] = useState<UnifiedAssessment | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  useWorkspaceBreadcrumbLabels({ candidateName: state.status === 'ready' ? state.report.candidate.name : undefined });
  const load = useCallback(async (signal?: AbortSignal, selectedRole?: EvaluationRole['id']) => {
    if (!session?.access_token) { setState({ status: 'error', message: 'Sign in again to view this report.' }); return; }
    setState({ status: 'loading' });
    try {
      const [rawReport, rolesResult] = await Promise.all([
        apiRequest<unknown>(`/candidates/${encodeURIComponent(id)}/unified-report${selectedRole ? `?roleId=${encodeURIComponent(selectedRole)}` : ''}`, { signal }, session.access_token),
        apiRequest<unknown>('/evaluations/roles', { signal }, session.access_token).catch(() => null),
      ]);
      const response = unifiedCandidateReportSchema.parse(rawReport);
      const availableRoles = rolesResult ? evaluationRolesResponseSchema.parse(rolesResult).roles : [];
      if (!signal?.aborted) {
        setRoles(availableRoles);
        setRoleId((current) => availableRoles.some((role) => role.id === current) ? current : response.job.roleId as EvaluationRole['id'] ?? availableRoles[0]?.id ?? 'software_developer');
        setAssessment(response.assessment);
        setState({ status: 'ready', report: response });
      }
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
  async function generateAssessment() {
    if (!session?.access_token || state.status !== 'ready' || assessing || !roleId) return;
    setAssessing(true); setAssessmentError('');
    try {
      const result = unifiedAssessmentSchema.parse(await apiRequest<unknown>(`/candidates/${encodeURIComponent(id)}/unified-report/assessment`, {
        method: 'POST', body: JSON.stringify({ roleId, resumeId: state.report.resume.id }),
      }, session.access_token));
      setAssessment(result);
    } catch (error) { setAssessmentError(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : 'Could not generate the unified assessment.'); }
    finally { setAssessing(false); }
  }
  async function changeAssessmentRole(nextRole: EvaluationRole['id']) {
    setRoleId(nextRole); setAssessmentError('');
    await load(undefined, nextRole);
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  if (state.status === 'loading') return <main className="unified-report-page"><WorkspaceSkeleton variant="detail"/></main>;
  if (state.status === 'error') return <main className="unified-report-page"><section className="unified-report-state" role="alert"><h1>Report unavailable</h1><p>{state.message}</p><button type="button" className="primary-button" onClick={() => void load()}>Try again</button><Link className="secondary-button link-button" to={`/candidates/${id}`}>Back to candidate</Link></section></main>;
  const { report } = state;
  return <UnifiedCandidateReportView report={report} selectedResumeId={selectedResumeId} linking={linking} linkError={linkError} roles={roles} roleId={roleId} assessment={assessment} assessing={assessing} assessmentError={assessmentError}
    onRoleChange={(role) => void changeAssessmentRole(role)} onGenerateAssessment={() => void generateAssessment()}
    onSelectResume={setSelectedResumeId} onLinkResume={() => void linkResume()}/>;
}

export function UnifiedCandidateReportView({ report, selectedResumeId = '', linking = false, linkError = '', roles = [], roleId = 'software_developer', assessment = report.assessment, assessing = false, assessmentError = '', onRoleChange = () => undefined, onGenerateAssessment = () => undefined, onSelectResume = () => undefined, onLinkResume = () => undefined }: {
  report: UnifiedCandidateReport;
  selectedResumeId?: string;
  linking?: boolean;
  linkError?: string;
  roles?: EvaluationRole[];
  roleId?: EvaluationRole['id'];
  assessment?: UnifiedAssessment | null;
  assessing?: boolean;
  assessmentError?: string;
  onRoleChange?: (role: EvaluationRole['id']) => void;
  onGenerateAssessment?: () => void;
  onSelectResume?: (id: string) => void;
  onLinkResume?: () => void;
}) {
  const sources = [['GitHub', report.sources.github], ['LeetCode', report.sources.leetcode]] as const;
  const findings = sources.flatMap(([sourceName, source]) => source.findings.map((finding) => ({ sourceName, source, finding })));
  const missingFindings = findings.filter(({ finding }) => finding.score === undefined);
  const displayedResumeScore = assessment?.components.resume.score ?? report.resume.validatedScore ?? report.resume.preliminaryScore;
  const scoreText = (score: number | null | undefined, status?: string) => score === null || score === undefined
    ? 'Not found' : `${score}/100${status === 'preliminary' ? ' · Preliminary' : ''}`;
  const shortStrengths = (assessment?.strengths.length ? assessment.strengths : report.platformEvaluation.strengths).slice(0, 3);
  const shortImprovements = (assessment?.improvementAreas.length ? assessment.improvementAreas : report.platformEvaluation.improvementAreas).slice(0, 3);

  return <main className="unified-report-page">
    <header className="unified-report-header">
      <div className="unified-report-identity">
        <div className="unified-report-utility-row">
          <Link className="unified-report-back" to={'/candidates/' + report.candidate.id}>← <span>Candidate profile</span></Link>
          <div className="unified-report-title-row">
            <span className="unified-report-kicker">CANDIDATE EVALUATION</span>
            <span className={'unified-status unified-status-' + report.platformEvaluation.status} role="status" aria-label={'Evaluation status: ' + displayLabel(report.platformEvaluation.status)}>{displayLabel(report.platformEvaluation.status)}</span>
          </div>
        </div>
        <h1>{report.candidate.name}</h1>
        <p className="unified-report-subtitle"><span>{report.candidate.email ?? 'Email not provided'}</span><span aria-hidden="true">·</span><span>{report.job.roleLabel ?? 'No saved target role'}</span></p>
      </div>
      <button className="primary-button no-print unified-print-button" type="button" onClick={() => window.print()}>Download / Print PDF</button>
    </header>

    <section className="unified-report-panel unified-overview" aria-label="Candidate assessment summary">
      <div className="unified-overview-heading"><div><span className="unified-section-kicker">FINAL CANDIDATE SUMMARY</span><h2>{report.job.roleLabel ?? 'Target role not saved'}</h2><p>{assessment?.status === 'completed' ? 'Completed' : 'Incomplete'} · {assessment ? `${assessment.evidenceCompleteness}% validated evidence` : 'No unified assessment saved'}</p></div><div className={`unified-final-score${assessment?.overallScore === null || !assessment ? ' is-incomplete' : ''}`}><span>Final score</span><strong>{assessment?.overallScore === null || !assessment ? 'Incomplete' : `${assessment.overallScore}/100`}</strong></div></div>
      <div className="unified-overview-scores" aria-label="Component scores">
        <article><span>Resume</span><strong>{scoreText(displayedResumeScore, assessment?.components.resume.status ?? (report.resume.preliminaryScore !== null ? 'preliminary' : undefined))}</strong></article>
        <article><span>GitHub</span><strong>{scoreText(assessment?.components.github.score)}</strong></article>
        <article><span>LeetCode</span><strong>{scoreText(assessment?.components.leetcode.score)}</strong></article>
        <article><span>Evidence completion</span><strong>{assessment ? `${assessment.evidenceCompleteness}% validated` : 'Not assessed'}</strong></article>
      </div>
      <div className="unified-overview-lists">
        <section><h3>Strengths</h3>{shortStrengths.length ? <ul>{shortStrengths.map((item, index) => <li key={`strength-${index}`}>{item}</li>)}</ul> : <p>No saved strengths.</p>}</section>
        <section><h3>Development areas</h3>{shortImprovements.length ? <ul>{shortImprovements.map((item, index) => <li key={`improvement-${index}`}>{item}</li>)}</ul> : <p>No saved development areas.</p>}</section>
      </div>
      {assessment?.missingComponents.length ? <p className="unified-overview-missing">Missing validated evidence: {assessment.missingComponents.join(', ')}. Final score and rank are withheld until required evidence is validated.</p> : null}
      <div className="unified-assessment-controls no-print"><label htmlFor="unified-role">Target role<select id="unified-role" value={roleId} onChange={(event) => onRoleChange(event.target.value as EvaluationRole['id'])}>{roles.length ? roles.map((role) => <option key={role.id} value={role.id}>{role.displayName}</option>) : <option value={roleId}>{report.job.roleLabel ?? displayLabel(roleId)}</option>}</select></label><button type="button" className="primary-button" disabled={assessing} onClick={onGenerateAssessment}>{assessing ? 'Generating…' : assessment ? 'Refresh assessment' : 'Generate final assessment'}</button></div>
      {assessmentError && <p role="alert" className="unified-assessment-error">{assessmentError}</p>}
      {assessment && <details className="unified-extra-details"><summary>Assessment details and limitations</summary><p>{assessment.explanation}</p><p>Component weights: Resume · weight {assessment.weights.resume}% · GitHub · weight {assessment.weights.github}% · LeetCode · weight {assessment.weights.leetcode}%</p><p>Assessment version {assessment.scoringVersion} · saved {date(assessment.generatedAt)}</p><ul className="unified-assessment-limitations" aria-label="Assessment limitations">{assessment.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    </section>

    <details className="unified-more-report unified-report-panel">
      <summary>Detailed evaluation, resume evidence, and methodology</summary>
      <div className="unified-more-report-content">
    <section className="unified-report-summary" aria-labelledby="unified-summary-title">
      <div className="unified-index-block">
        <span className="unified-section-kicker" id="unified-summary-title">SAVED PLATFORM EVALUATION</span>
        <strong>{report.platformEvaluation.overallIndex === null ? 'Overall index withheld' : <>{report.platformEvaluation.overallIndex}<small> / 100</small></>}</strong>
        <span className={'unified-status unified-status-' + report.platformEvaluation.status}>{displayLabel(report.platformEvaluation.status)}</span>
      </div>
      <div className="unified-evaluation-context">
        <p>{report.platformEvaluation.overallIndex === null
          ? 'A complete overall index is not available in this saved evaluation. Missing or partial evidence remains unscored; it is not treated as zero.'
          : 'This is the saved GitHub and LeetCode v4 evidence index. It is not a measure of engineering competence or hiring suitability.'}</p>
        <small>Evaluated {date(report.platformEvaluation.evaluatedAt)} · Report generated {date(report.generatedAt)}</small>
      </div>
    </section>

    <section className="unified-report-context unified-report-panel" aria-labelledby="unified-role-title">
      <div><span className="unified-section-kicker">ROLE CONTEXT</span><h2 id="unified-role-title">{report.job.roleLabel ?? 'Target role not saved'}</h2></div>
      <p>{report.job.description ?? 'A role description was not saved with this evaluation.'}</p>
    </section>

    <section className="unified-report-panel unified-scores-section" aria-labelledby="unified-scores-title">
      <div className="unified-section-heading"><div><span className="unified-section-kicker">SAVED EVIDENCE</span><h2 id="unified-scores-title">Category scores</h2><p>Each index reflects the saved evidence and source shown on its card.</p></div></div>
      {findings.length > 0 ? <div className="unified-score-grid">{findings.map(({ sourceName, source, finding }, index) => <article className="unified-score-card" data-score-state={finding.score === undefined ? finding.status : 'scored'} key={sourceName + '-' + finding.categoryId}>
        <div className="unified-score-card-meta"><span className="unified-source-label">{sourceName}</span><span className={'unified-status unified-status-' + (finding.score === undefined ? finding.status : 'scored')}>{finding.score === undefined ? displayLabel(finding.status) : 'Scored'}</span></div>
        <div className="unified-score-heading-row">
          <div className="unified-score-title-row"><h3>{finding.displayName}</h3><span className="unified-score-weight">Weight {finding.weight}%</span></div>
          <div className="unified-score-card-value">{finding.score === undefined ? <span className="unified-no-score" role="status">{displayLabel(finding.status)}<small>No score assigned</small></span> : <><strong aria-label={finding.score + ' out of 100'}><AnimatedScore value={finding.score}/></strong><span className="unified-score-out-of">/100</span></>}</div>
        </div>
        {finding.score !== undefined
          ? <div className="unified-score-track" role="progressbar" aria-label={finding.displayName + ' evidence index'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={finding.score}><span style={{ width: finding.score + '%', animationDelay: Math.min(index, 5) * 45 + 'ms' }}/></div>
          : <div className="unified-score-unavailable" aria-hidden="true"/>}
        <div className="unified-score-summary-row">
          <p className="unified-score-explanation">{conciseFormula(finding.formula)}</p>
          {Object.keys(finding.metrics).length > 0 && <dl className="unified-metric-list">{Object.entries(finding.metrics).slice(0, 2).map(([key, value]) => <div key={key}><dt>{displayLabel(key)}</dt><dd>{readable(value)}</dd></div>)}</dl>}
        </div>
        <details className="unified-category-evidence">
          <summary>View source evidence</summary>
          <dl>
            <div><dt>Saved scoring formula</dt><dd>{finding.formula}</dd></div>
            <div><dt>Source status</dt><dd>{displayLabel(source.status)} · {displayLabel(finding.status)}</dd></div>
            <div><dt>Source</dt><dd>{source.provenance ? displayLabel(source.provenance) : sourceName}</dd></div>
            <div><dt>Snapshot captured</dt><dd>{date(source.capturedAt)}</dd></div>
            <div><dt>Category weight</dt><dd>{finding.weight}%</dd></div>
            {Object.entries(finding.metrics).map(([key, value]) => <div key={key}><dt>{displayLabel(key)}</dt><dd>{readable(value)}</dd></div>)}
          </dl>
        </details>
      </article>)}</div> : <p className="unified-empty-state">No category-level findings were saved for this evaluation.</p>}
    </section>

    <section className="unified-summary-grid" aria-label="Evaluation summary">
      <article className="unified-summary-card"><span className="unified-section-kicker">RECORDED IN THE SAVED EVALUATION</span><h2>Strengths</h2>{report.platformEvaluation.strengths.length ? <ul>{report.platformEvaluation.strengths.map((item, index) => <li key={index + '-' + item}>{item}</li>)}</ul> : <p className="unified-empty-state">No saved strengths are available.</p>}</article>
      <article className="unified-summary-card"><span className="unified-section-kicker">RECORDED IN THE SAVED EVALUATION</span><h2>Improvement areas</h2>{report.platformEvaluation.improvementAreas.length ? <ul>{report.platformEvaluation.improvementAreas.map((item, index) => <li key={index + '-' + item}>{item}</li>)}</ul> : <p className="unified-empty-state">No saved improvement areas are available.</p>}</article>
      <article className="unified-summary-card"><span className="unified-section-kicker">EVIDENCE STATUS</span><h2>Missing evidence</h2>
        {missingFindings.length ? <ul>{missingFindings.map(({ sourceName, finding }) => <li key={sourceName + '-' + finding.categoryId}><strong>{finding.displayName}</strong><span>{sourceName} · {displayLabel(finding.status)}</span></li>)}</ul>
          : findings.length ? <p className="unified-empty-state">All categories with saved findings have an index.</p>
            : <p className="unified-empty-state">No category-level evidence details are available for this evaluation.</p>}
      </article>
    </section>

    <section className="unified-resume-section unified-report-panel" aria-labelledby="unified-resume-title">
      <div className="unified-section-heading"><div><span className="unified-section-kicker">SEPARATE EVALUATION</span><h2 id="unified-resume-title">Resume job-match evaluation</h2></div>
        {report.resume.status === 'available' && report.resume.statusLabel && <span className={'unified-status unified-status-' + report.resume.statusLabel}>{displayLabel(report.resume.statusLabel)}</span>}
      </div>
      <p>{report.resume.message}</p>
      {report.resume.status === 'available' && <div className="unified-resume-result">
        <div className="unified-resume-meta"><strong>{report.resume.jobTitle ?? 'Role unavailable'}</strong><span>{report.resume.statusLabel ? displayLabel(report.resume.statusLabel) : 'Status unavailable'} · evaluated {date(report.resume.evaluatedAt)}</span></div>
        {report.resume.jobDescription && <details><summary>Job description</summary><p>{report.resume.jobDescription}</p></details>}
        {report.resume.validatedScore !== null && <p>Validated resume score: <strong>{report.resume.validatedScore}/100</strong></p>}
        {report.resume.preliminaryScore !== null && <p>Preliminary match: <strong>{report.resume.preliminaryScore}/100</strong></p>}
        {report.resume.evidence.length > 0 && <div><h3>Supporting resume evidence</h3><ul>{report.resume.evidence.map((item, index) => <li key={index + '-' + item}>{item}</li>)}</ul></div>}
      </div>}
      {report.resume.limitations.map((item) => <small className="unified-resume-limitation" key={item}>{item}</small>)}
      {report.resume.status === 'unlinked' && report.linkableResumes.length > 0 && <div className="resume-link-control">
        <label htmlFor="resume-result-link">Attach a saved resume result</label>
        <select id="resume-result-link" value={selectedResumeId} onChange={(event) => onSelectResume(event.target.value)}>
          <option value="">Choose a saved result…</option>
          {report.linkableResumes.filter((item) => item.status === 'completed' || item.status === 'failed').map((item) => <option key={item.id} value={item.id}>{item.candidateName ?? 'Name not identified'} · {item.filename} · {item.jobTitle} · {item.status} · {item.scoreLabel}{item.score === null ? '' : ' ' + item.score + '/100'}</option>)}
        </select>
        <button className="secondary-button" type="button" disabled={!selectedResumeId || linking} onClick={onLinkResume}>{linking ? 'Attaching…' : 'Attach result'}</button>
        {linkError && <p role="alert">{linkError}</p>}
      </div>}
      {report.resume.status === 'unlinked' && report.linkableResumes.length === 0 && <div className="unified-resume-empty"><p>No unlinked screening results are available in your workspace.</p><Link to="/screening">Open Resume Screening</Link></div>}
      <p className="unified-report-note no-print">Use an explicit saved-result selection to associate a resume evaluation. Reports are never matched by name or email.</p>
    </section>

    <details className="unified-methodology unified-report-panel">
      <summary>Evidence &amp; methodology</summary>
      <div className="unified-methodology-content">
        <section><h3>Data reliability and freshness</h3><p>Saved source data does not verify candidate identity. Snapshot freshness is not assessed against an approved threshold.</p>
          <dl>{sources.map(([sourceName, source]) => <div key={sourceName}><dt>{sourceName}</dt><dd>{source.provenance ? displayLabel(source.provenance) : 'No provenance saved'} · captured {date(source.capturedAt)} · {displayLabel(source.status)}</dd></div>)}</dl>
        </section>
        <section><h3>Evidence coverage</h3><p>Category states are shown above. Saved normalized source values are available below; values not present in a snapshot are not inferred.</p><p className="unified-coverage-note"><strong>GitHub repository coverage:</strong> {repositoryCoverage(report.sources.github.values)}</p>
          {sources.map(([sourceName, source]) => <details className="unified-values-details" key={sourceName}><summary>View {sourceName} source evidence</summary>
            {Object.keys(source.values).length ? <dl>{Object.entries(source.values).map(([key, value]) => <div key={key}><dt>{displayLabel(key)}</dt><dd><code>{readable(value)}</code></dd></div>)}</dl> : <p className="unified-empty-state">No normalized source values were saved.</p>}
          </details>)}
        </section>
        <section><h3>Scoring methodology</h3>{report.platformEvaluation.rubricNotice && <p>{report.platformEvaluation.rubricNotice}</p>}
          <p>Each category card shows its saved source formula and configured weight. The overall index follows the saved evaluation and is withheld when required evidence is incomplete.</p>
        </section>
        <section><h3>Interpretation and limitations</h3><p>Activity counts and repository volume are context, not direct proof of engineering competence, code quality, or collaboration quality. Platform indexes and resume job-match scores use different rubrics and are not combined.</p>
          {sources.map(([sourceName, source]) => <div className="unified-limitations" key={sourceName}><h4>{sourceName} limitations</h4>{source.limitations.length ? <ul>{source.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No additional source limitations were saved.</p>}</div>)}
        </section>
      </div>
    </details>
      </div>
    </details>

    <footer className="unified-report-footer">Decision support only. Saved evidence does not establish candidate identity, engineering competence, or hiring suitability.</footer>
  </main>;
}
