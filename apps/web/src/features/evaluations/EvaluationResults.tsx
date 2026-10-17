import type { Candidate, EvaluationResponse, PersistedEvaluation } from '@devrank/contracts';
import { finalRubricId, scoringCategories } from '@devrank/contracts';
import { FinalEvaluationReport } from './ProposedEvaluationReport';
import './evaluation.css';

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function EvaluationResults({ candidate, evaluation }: { candidate: Candidate; evaluation: PersistedEvaluation & { result: EvaluationResponse } }) {
  const result = evaluation.result;
  const finalReport = result.finalReport;
  const evidenceById = new Map(result.evidence.map((item) => [item.evidenceId, item]));
  const missingCategories = scoringCategories.filter(({ id }) => result.missingEvidence.includes(id));
  return <main className="evaluation-page">
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE EVALUATION</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · {result.targetRole.replaceAll('_', ' ')}</p></div><span className={`evaluation-status ${result.evaluationStatus === 'completed' ? 'is-complete' : 'is-incomplete'}`}>{result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'}</span></header>
    <section className="evaluation-summary-card" aria-label="Overall score">
      {result.overallScore !== undefined ? <><div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-score">{result.overallScore}<small>/100</small></strong></div><div className="overall-meter" role="img" aria-label={`Overall score ${result.overallScore} out of 100`}><span style={{ width: `${result.overallScore}%` }}/></div></> : <div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-missing">Not calculated</strong><p>An overall score is withheld until all six categories have scoreable evidence.</p></div>}
      <small>Active GitHub + LeetCode evaluation · saved weights are shown. Scoring version {result.scoringVersion ?? result.schemaVersion} · Evaluated {displayDate(evaluation.createdAt)}</small>
    </section>
    {finalReport ? <FinalEvaluationReport report={finalReport} title="Final GitHub + LeetCode evaluation report · v4"/> : <p className="evaluation-notice" role="status">The saved v4 report snapshot is unavailable. This result remains unchanged; run a new evaluation to create a final report.</p>}
    {missingCategories.length > 0 && <section className="evaluation-notice" role="status"><h2>Evidence needed</h2><p>These categories do not have enough normalized evidence. Missing evidence is not scored as zero.</p><ul>{missingCategories.map((category) => <li key={category.id}>{category.displayName}: {result.categoryScores.find((item) => item.categoryId === category.id)?.explanation}</li>)}</ul></section>}
    <section className="evaluation-categories" aria-labelledby="evaluation-categories-title"><div className="evaluation-section-heading"><div><h2 id="evaluation-categories-title">Final v4 GitHub + LeetCode rubric</h2><p>These saved scores come from the deterministic v4 source-specific index formulas.</p></div></div><div className="evaluation-category-grid">{scoringCategories.map((category) => {
      const score = result.categoryScores.find((item) => item.categoryId === category.id)!;
      return <article className="evaluation-category-card" key={category.id} data-category={category.id}><div className="evaluation-category-heading"><h3>{category.displayName}</h3>{score.score !== undefined ? <strong>{score.score}<small>/100</small></strong> : <span className="category-unscored">Not scored</span>}</div>{score.score !== undefined ? <progress max="100" value={score.score} aria-label={`${category.displayName}: ${score.score} out of 100`}/> : <div className="category-progress-empty" aria-hidden="true"/>}<p>{score.explanation}</p>{score.evidenceRefs.length > 0 && <details><summary>{score.evidenceRefs.length} supporting {score.evidenceRefs.length === 1 ? 'evidence item' : 'evidence items'}</summary><ul>{score.evidenceRefs.map((id) => { const item = evidenceById.get(id); return <li key={id}><strong>{item?.source ?? 'Evidence'}:</strong> {item?.description ?? id}</li>; })}</ul></details>}</article>;
    })}</div></section>
    {result.platformEvidence && result.platformEvidence.length > 0 && <section className="evaluation-categories platform-context" aria-labelledby="platform-context-title"><div className="evaluation-section-heading"><div><h2 id="platform-context-title">Saved platform evidence</h2><p>Provider snapshots are unverified evidence inputs to v4. Each score remains limited by source attribution, coverage, and the listed data limitations.</p></div></div><div className="evaluation-category-grid">{result.platformEvidence.map((item) => <article className="evaluation-category-card" key={item.evidenceId}><div className="evaluation-category-heading"><h3>{item.source === 'github' ? 'GitHub' : 'LeetCode'} · {item.evidenceType.replaceAll('_', ' ')}</h3><span className="category-unscored">{item.availability.replaceAll('_', ' ')}</span></div><p>{item.provenance.replaceAll('_', ' ')} · saved {displayDate(item.observedAt)} · freshness not assessed</p><ul>{Object.entries(item.normalizedValue).filter(([, value]) => value !== undefined).map(([name, value]) => <li key={name}><strong>{name}:</strong> {typeof value === 'string' ? value : JSON.stringify(value)}</li>)}</ul>{item.categoryMappings.length > 0 && <p>Used for {item.categoryMappings.map(({ categoryId, rubricId }) => rubricId === finalRubricId
      ? scoringCategories.find(({ id }) => id === categoryId)?.displayName ?? categoryId
      : 'historical proposal context').join(', ')}; no additional score is inferred outside the saved result.</p>}<ul>{item.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></article>)}</div></section>}
    <p className="evaluation-disclaimer">{result.decisionSupportNotice}</p>
  </main>;
}
