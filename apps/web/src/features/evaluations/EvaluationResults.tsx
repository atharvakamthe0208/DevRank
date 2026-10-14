import type { Candidate, EvaluationResponse, PersistedEvaluation } from '@devrank/contracts';
import { scoringCategories } from '@devrank/contracts';
import './evaluation.css';

function displayDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function EvaluationResults({ candidate, evaluation }: { candidate: Candidate; evaluation: PersistedEvaluation & { result: EvaluationResponse } }) {
  const result = evaluation.result;
  const evidenceById = new Map(result.evidence.map((item) => [item.evidenceId, item]));
  const missingCategories = scoringCategories.filter(({ id }) => result.missingEvidence.includes(id));
  const ai = result.aiAnalysis;
  return <main className="evaluation-page">
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE EVALUATION</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · {result.targetRole.replaceAll('_', ' ')}</p></div><span className={`evaluation-status ${result.evaluationStatus === 'completed' ? 'is-complete' : 'is-incomplete'}`}>{result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'}</span></header>
    <section className="evaluation-summary-card" aria-label="Overall score">
      {result.overallScore !== undefined ? <><div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-score">{result.overallScore}<small>/100</small></strong></div><div className="overall-meter" role="img" aria-label={`Overall score ${result.overallScore} out of 100`}><span style={{ width: `${result.overallScore}%` }}/></div></> : <div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-missing">Not calculated</strong><p>An overall score is withheld until all five categories have scoreable evidence.</p></div>}
      <small>Role profile weights are shown as saved. Scoring version {result.scoringVersion ?? result.schemaVersion} · Evaluated {displayDate(evaluation.createdAt)}</small>
    </section>
    {missingCategories.length > 0 && <section className="evaluation-notice" role="status"><h2>Evidence needed</h2><p>These categories do not have enough normalized evidence. Missing evidence is not scored as zero.</p><ul>{missingCategories.map((category) => <li key={category.id}>{category.displayName}: {result.categoryScores.find((item) => item.categoryId === category.id)?.explanation}</li>)}</ul></section>}
    <section className="evaluation-categories" aria-labelledby="evaluation-categories-title"><div className="evaluation-section-heading"><div><h2 id="evaluation-categories-title">Scoring categories</h2><p>Scores come from the deterministic evaluation result.</p></div></div><div className="evaluation-category-grid">{scoringCategories.map((category) => {
      const score = result.categoryScores.find((item) => item.categoryId === category.id)!;
      return <article className="evaluation-category-card" key={category.id} data-category={category.id}><div className="evaluation-category-heading"><h3>{category.displayName}</h3>{score.score !== undefined ? <strong>{score.score}<small>/100</small></strong> : <span className="category-unscored">Not scored</span>}</div>{score.score !== undefined ? <progress max="100" value={score.score} aria-label={`${category.displayName}: ${score.score} out of 100`}/> : <div className="category-progress-empty" aria-hidden="true"/>}<p>{score.explanation}</p>{score.evidenceRefs.length > 0 && <details><summary>{score.evidenceRefs.length} supporting {score.evidenceRefs.length === 1 ? 'evidence item' : 'evidence items'}</summary><ul>{score.evidenceRefs.map((id) => { const item = evidenceById.get(id); return <li key={id}><strong>{item?.source ?? 'Evidence'}:</strong> {item?.description ?? id}</li>; })}</ul></details>}</article>;
    })}</div></section>
    {ai && <section className="evaluation-ai" aria-labelledby="evaluation-ai-title"><div className="evaluation-section-heading"><div><h2 id="evaluation-ai-title">AI evidence summary</h2><p>Optional, evidence-linked context. It does not set or change the scores.</p></div><span className={`ai-status ai-${ai.status}`}>{ai.status.replace('_', ' ')}</span></div>{'summary' in ai ? <><p className="ai-summary">{ai.summary}</p><div className="ai-finding-grid">{([['Strengths', ai.strengths], ['Development areas', ai.developmentAreas]] as const).map(([title, findings]) => <div key={title}><h3>{title}</h3>{findings.length ? <ul>{findings.map((finding, index) => <li key={`${finding.claim}-${index}`}>{finding.claim}<small>Evidence: {finding.evidenceReferences.map((id) => evidenceById.get(id)?.source ?? id).join(', ')}</small></li>)}</ul> : <p className="evaluation-muted">No evidence-linked items supplied.</p>}</div>)}</div>{ai.limitations.length > 0 && <p className="ai-limitations">Limitations: {ai.limitations.join(' ')}</p>}</> : <p className="evaluation-muted">AI analysis is unavailable ({ai.reason.replaceAll('_', ' ')}). The deterministic result above remains valid.</p>}</section>}
    <p className="evaluation-disclaimer">{result.decisionSupportNotice}</p>
  </main>;
}
