import type { Candidate, PersistedEvaluationRead } from '@devrank/contracts';
import { EvaluationCategoryCard } from './EvaluationCategoryCard';
import './evaluation.css';

type LegacyEvaluation = Exclude<PersistedEvaluationRead, import('@devrank/contracts').PersistedEvaluation>;

function historicalDescription(explanation: string, evidence: string[], scored: boolean): string {
  if (!scored && /leetcode/i.test(explanation) && /(no saved|no usable|snapshot|statistics)/i.test(explanation)) {
    return 'A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.';
  }
  const sourceText = evidence.find((item) => item.trim()) ?? explanation;
  const sentence = sourceText.trim().split(/(?<=[.!?])\s+/)[0]
    .replace(/^Complete language coverage\s*[·:]\s*/i, '')
    .replace(/\s*[·;]?\s*\d+ supporting items?\.?$/i, '')
    .trim();
  if (sentence && !/(arithmetic mean|normalized evidence value|scored\s*[·-]|supporting item|evidence available)/i.test(sentence)) {
    return sentence.length > 180 ? `${sentence.slice(0, 177).trimEnd()}…` : sentence;
  }
  return scored ? 'Saved evidence is available for this category.' : 'No comparable evidence is available; this category is not scored.';
}

export function LegacyEvaluationResults({ candidate, evaluation }: { candidate: Candidate; evaluation: LegacyEvaluation }) {
  const result = evaluation.result;
  const historicalVersion = result.schemaVersion.startsWith('1.') ? '1' : result.schemaVersion.startsWith('2.') ? '2' : '3';
  const evidenceById = new Map(result.evidence.map((item) => [item.evidenceId, item]));
  return <main className="evaluation-page">
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> HISTORICAL EVALUATION · V{historicalVersion}</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · {result.targetRole.replaceAll('_', ' ')}</p></div><span className={`evaluation-status ${result.evaluationStatus === 'completed' ? 'is-complete' : 'is-incomplete'}`}>{result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'}</span></header>
    <section className="evaluation-notice" role="note"><h2>Historical scoring format</h2><p>This saved result uses its original scoring model. Recorded values are shown unchanged and are not converted to the active v4 GitHub + LeetCode rubric.</p></section>
    <section className="evaluation-summary-card" aria-label="Historical overall score">
      {result.overallScore !== undefined ? <div><span className="summary-label">RECORDED OVERALL SCORE</span><strong className="evaluation-overall-score">{result.overallScore}<small>/100</small></strong></div> : <div><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-missing">Not calculated</strong><p>The historical snapshot did not record an overall score.</p></div>}
      <small>Historical scoring version {result.scoringVersion ?? result.schemaVersion} · Evaluated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(evaluation.createdAt))}</small>
    </section>
    <section className="evaluation-report-panel" aria-labelledby="legacy-evaluation-categories"><div className="evaluation-report-header"><h2 id="legacy-evaluation-categories">Evaluation report</h2><details className="evaluation-about-scoring"><summary>About scoring</summary><p>{result.calculationExplanation}</p></details></div><div className="evaluation-report-grid">{result.categoryScores.map((category) => {
      const evidence = category.evidenceRefs.flatMap((id) => {
        const item = evidenceById.get(id);
        return item ? [{ label: item.source, description: item.description, observedAt: item.observedAt }] : [];
      });
      const leetcodeUnavailable = category.categoryId === 'problem_solving_dsa' && category.score === undefined && /leetcode/i.test(category.explanation) && /(no saved|no usable|snapshot|statistics)/i.test(category.explanation);
      return <EvaluationCategoryCard key={category.categoryId} categoryId={category.categoryId} title={category.displayName} score={category.score} availabilityLabel={leetcodeUnavailable ? 'Unavailable' : undefined} description={historicalDescription(category.explanation, evidence.map(({ description }) => description), category.score !== undefined)} evidence={evidence}/>;
    })}</div></section>
    <p className="evaluation-disclaimer">{result.decisionSupportNotice} This historical result is read-only.</p>
  </main>;
}
