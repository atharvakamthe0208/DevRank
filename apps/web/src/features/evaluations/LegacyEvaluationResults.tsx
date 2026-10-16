import type { Candidate, PersistedEvaluationRead } from '@devrank/contracts';
import './evaluation.css';

type LegacyEvaluation = Extract<PersistedEvaluationRead, { result: { schemaVersion: '1.0.0' } }>;

export function LegacyEvaluationResults({ candidate, evaluation }: { candidate: Candidate; evaluation: LegacyEvaluation }) {
  const result = evaluation.result;
  return <main className="evaluation-page">
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> HISTORICAL EVALUATION · V1</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · {result.targetRole.replaceAll('_', ' ')}</p></div><span className={`evaluation-status ${result.evaluationStatus === 'completed' ? 'is-complete' : 'is-incomplete'}`}>{result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'}</span></header>
    <section className="evaluation-notice" role="note"><h2>Historical scoring format</h2><p>This saved result uses the original six-category v1 model. Its recorded values are shown unchanged and are not converted to the current scoring model.</p></section>
    <section className="evaluation-summary-card" aria-label="Historical overall score">
      {result.overallScore !== undefined ? <div><span className="summary-label">RECORDED OVERALL SCORE</span><strong className="evaluation-overall-score">{result.overallScore}<small>/100</small></strong></div> : <div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-missing">Not calculated</strong><p>The historical snapshot did not record an overall score.</p></div>}
      <small>Historical scoring version {result.scoringVersion ?? result.schemaVersion} · Evaluated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(evaluation.createdAt))}</small>
    </section>
    <section className="evaluation-categories" aria-labelledby="legacy-evaluation-categories"><div className="evaluation-section-heading"><div><h2 id="legacy-evaluation-categories">Original six scoring categories</h2><p>Values are displayed from the validated stored snapshot.</p></div></div><div className="evaluation-category-grid">{result.categoryScores.map((category) => <article className="evaluation-category-card" key={category.categoryId}><div className="evaluation-category-heading"><h3>{category.displayName}</h3>{category.score === undefined ? <span className="category-unscored">Not scored</span> : <strong>{category.score}<small>/100</small></strong>}</div>{category.score === undefined ? <div className="category-progress-empty" aria-hidden="true"/> : <progress max="100" value={category.score} aria-label={`${category.displayName}: ${category.score} out of 100`}/>}<p>{category.explanation}</p></article>)}</div></section>
    <p className="evaluation-disclaimer">{result.decisionSupportNotice} This historical result is read-only.</p>
  </main>;
}
