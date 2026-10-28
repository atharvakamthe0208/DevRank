import { AnimatedMetric } from '../../components/metrics/KpiCards';
import { readableProvenance } from '../evaluation/evidence-presentation';

export type EvaluationCardEvidence = {
  label?: string;
  description: string;
  observedAt?: string;
};

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function CategoryGlyph({ categoryId }: { categoryId: string }) {
  switch (categoryId) {
    case 'project_portfolio': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 5.5A2.5 2.5 0 0 1 5 3h4.382a2.5 2.5 0 0 1 1.768.732L12.5 5.118A1 1 0 0 0 13.207 5.4H19A2.5 2.5 0 0 1 21.5 7.9v9.6a2.5 2.5 0 0 1-2.5 2.5H5a2.5 2.5 0 0 1-2.5-2.5v-12z"/></svg>;
    case 'technical_skills': return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
    case 'development_activity': return <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="12" width="4" height="9" rx="1.5"/><rect x="10" y="7" width="4" height="14" rx="1.5"/><rect x="17" y="3" width="4" height="18" rx="1.5"/></svg>;
    case 'collaboration': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-6 9a6 6 0 0 1 12 0v1H3v-1zm14.5-9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm1 3.5c1.4.3 2.5 1.5 2.5 3v2.5h-5V19c0-1.7-.8-3.2-2.1-4.2 1.3-.2 2.9-.3 4.6-.3z"/></svg>;
    case 'current_year_contributions': return <svg viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M6 2a1 1 0 0 1 1 1v1h10V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1zm14 7H4v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9zm-13 3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2zm6 0a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-2z"/></svg>;
    case 'problem_solving_dsa': return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a4 4 0 0 0-4 4c0 .4.06.78.17 1.14A4.5 4.5 0 0 0 5 11.5c0 .66.15 1.28.4 1.84A4 4 0 0 0 6 21h1a1 1 0 0 0 1-1v-3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a4 4 0 0 0 .6-7.66 4.5 4.5 0 0 0 .4-1.84 4.5 4.5 0 0 0-3.17-4.36A4 4 0 0 0 12 2z"/></svg>;
    default: return null;
  }
}

export function EvaluationCategoryCard({
  categoryId,
  title,
  score,
  description,
  evidence,
  availabilityLabel,
  showProgress = score !== undefined,
  emptyEvidenceMessage = '',
}: {
  categoryId: string;
  title: string;
  score?: number;
  description: string;
  evidence: EvaluationCardEvidence[];
  availabilityLabel?: string;
  showProgress?: boolean;
  emptyEvidenceMessage?: string;
}) {
  return <article className="evaluation-category-card" data-category={categoryId} data-score-state={score === undefined ? 'unscored' : 'scored'}>
    <div className="evaluation-category-heading">
      <div className="evaluation-category-title-wrap"><span className={`evaluation-category-icon evaluation-category-icon-${categoryId}`} aria-hidden="true"><CategoryGlyph categoryId={categoryId}/></span><h3>{title}</h3></div>
      {score !== undefined
        ? <strong><AnimatedMetric value={score} decimals={String(score).split('.')[1]?.length ?? 0}/><small> / 100</small></strong>
        : <span className="category-unscored-wrap"><span className="category-unscored">Not scored</span>{availabilityLabel && <span className="category-availability">{availabilityLabel}</span>}</span>}
    </div>
    {score !== undefined && showProgress && <progress className="evaluation-score-progress" max="100" value={score} aria-label={`${title}: ${score} out of 100`}/>}
    <p>{description}</p>
    {evidence.length > 0 && <details className="evaluation-evidence-disclosure">
      <summary>View evidence <span aria-hidden="true">→</span></summary>
      <ul>{evidence.map((item, index) => <li key={`${item.label ?? 'evidence'}-${index}`}>
        {item.label && <><strong>{readableProvenance(item.label)}:</strong> </>}{item.description}{item.observedAt ? ` · observed ${displayDate(item.observedAt)}` : ''}
      </li>)}</ul>
    </details>}
    {evidence.length === 0 && emptyEvidenceMessage && <p className="evaluation-card-empty-evidence">{emptyEvidenceMessage}</p>}
  </article>;
}
