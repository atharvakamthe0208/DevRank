import type { ScreeningDetailsResponse } from '@devrank/contracts';
import { scorePresentation } from './ranking-table';

type ScreeningResume = ScreeningDetailsResponse['resumes'][number];

function statusLabel(resume: ScreeningResume): string {
  if (resume.status === 'failed') return 'Failed';
  if (resume.status === 'processing') return 'Processing';
  if (resume.status === 'queued' || resume.status === 'uploaded') return 'Processing';
  return 'Completed';
}

function statusMessage(resume: ScreeningResume): string | null {
  if (resume.status === 'failed') return 'Processing failed. View details for the error.';
  if (resume.status === 'processing') return 'Evaluation in progress.';
  if (resume.status === 'queued' || resume.status === 'uploaded') return 'Waiting for evaluation.';
  if (resume.evaluation?.score === undefined) return 'Insufficient evidence for a validated score.';
  if (resume.evaluation.status === 'provisional') return 'Preliminary match only; full evaluation is incomplete.';
  return null;
}

function ScreeningResultDetails({ resume }: { resume: ScreeningResume }) {
  const hasDetails = Boolean(resume.error || resume.evaluation || resume.preliminaryEvaluation);
  if (!hasDetails) return null;

  return <details className="screening-result-details">
    <summary>View details</summary>
    {resume.error && <p>{resume.error}</p>}
    {resume.preliminaryEvaluation && <>
      <p>Preliminary document match: {resume.preliminaryEvaluation.score}% · {resume.preliminaryEvaluation.evidenceCoverage}% of weighted criteria have text support. Unverified means matching text was not found; it does not mean the candidate lacks that qualification.</p>
      <ul>{resume.preliminaryEvaluation.criteria.map((criterion) => <li key={`preliminary-${criterion.id}`}>
        <strong>{criterion.description}:</strong> {criterion.status === 'supported' ? `Supported by ${criterion.matchedTerms.join(', ')}` : 'Unverified in resume text'}{criterion.evidenceExcerpt ? ` — “${criterion.evidenceExcerpt}”` : ''}
      </li>)}</ul>
    </>}
    {resume.evaluation && <ul>{resume.evaluation.categories.map((category) => {
      const requirementLabels = resume.evaluation!.requirements.filter((requirement) => requirement.categoryId === category.categoryId);
      return <li key={category.categoryId}>
        <strong>{category.categoryId.replaceAll('_', ' ')}:</strong> {category.score === undefined ? category.status.replaceAll('_', ' ') : `${category.score}/100`}
        {requirementLabels.length > 0 && <ul>{requirementLabels.map((requirement) => <li key={requirement.id}>
          <strong>{requirement.description}:</strong> {requirement.status.replaceAll('_', ' ')}{requirement.evidence[0] ? ` — “${requirement.evidence[0].excerpt}”` : ' — Evidence not available'}
        </li>)}</ul>}
      </li>;
    })}</ul>}
  </details>;
}

export function ScreeningResultList({ resumes }: { resumes: ScreeningResume[] }) {
  return <ul className="screening-file-list screening-status-list" aria-label="Screening results">
    {resumes.map((resume) => {
      const presentation = scorePresentation(resume);
      const status = statusLabel(resume);
      const message = statusMessage(resume);
      return <li className="screening-result-card" key={resume.id}>
        <span className="screening-file-icon" aria-hidden="true">CV</span>
        <div className="screening-result-main">
          <div className="screening-result-heading">
            <div className="screening-result-identity">
              <strong title={resume.filename}>{resume.filename}</strong>
              <span>{resume.candidate?.name ?? 'Name not identified'}</span>
            </div>
            <span className={`screening-status-pill status-${status.toLowerCase()}`}>{status}</span>
          </div>
          <div className="screening-result-footer">
            {presentation ? <span className="screening-result-score">
              <strong>{presentation.score}/100</strong>
              {presentation.preliminary && <small>Provisional</small>}
            </span> : <span className="score-unavailable">Score unavailable</span>}
            {message && <span className={`screening-result-message${resume.status === 'failed' ? ' is-error' : ''}`}>{message}</span>}
            <ScreeningResultDetails resume={resume} />
          </div>
        </div>
      </li>;
    })}
  </ul>;
}
