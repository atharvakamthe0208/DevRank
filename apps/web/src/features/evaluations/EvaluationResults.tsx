import type { Candidate, EvaluationResponse, PersistedEvaluation } from '@devrank/contracts';
import { scoringCategories } from '@devrank/contracts';
import { EvaluationCategoryCard } from './EvaluationCategoryCard';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { AnimatedMetric } from '../../components/metrics/KpiCards';
import './evaluation.css';

function conciseCategoryDescription(
  score: EvaluationResponse['categoryScores'][number],
  evidenceById: Map<string, EvaluationResponse['evidence'][number]>,
  report?: NonNullable<EvaluationResponse['finalReport']>['categories'][number],
): string {
  const dataStatus = report?.metrics.dataStatus;
  if (score.categoryId === 'problem_solving_dsa' && score.score === undefined
    && typeof dataStatus === 'string' && /leetcode/i.test(dataStatus)
    && /(no saved|no usable|snapshot|statistics)/i.test(dataStatus)) {
    return 'A LeetCode username is configured, but no saved statistics snapshot is available. No zero is inferred.';
  }
  if (score.scoreBasis === 'optional_missing_zero') {
    return 'No LeetCode profile was provided; the rubric applies its optional-profile policy.';
  }
  const value = (key: string): number | undefined => {
    const metric = report?.metrics[key];
    return typeof metric === 'number' && Number.isFinite(metric) ? metric : undefined;
  };
  const text = (key: string): string | undefined => {
    const metric = report?.metrics[key];
    return typeof metric === 'string' && metric.trim() ? metric.trim() : undefined;
  };
  switch (score.categoryId) {
    case 'project_portfolio': {
      const count = value('publicRepositoryCount');
      if (count !== undefined) return `${count} public ${count === 1 ? 'repository is' : 'repositories are'} included in the saved snapshot.`;
      break;
    }
    case 'technical_skills': {
      const languages = text('languagesObserved');
      const analyzed = value('repositoriesAnalyzed');
      const total = value('totalEligibleRepositories');
      if (languages && analyzed !== undefined && total !== undefined) return `${languages.split(',').length} detected languages: ${languages}; ${analyzed} of ${total} eligible repositories analyzed.`;
      if (languages) return `Languages observed: ${languages}.`;
      break;
    }
    case 'development_activity': {
      const commits = value('commitContributions') ?? value('totalCommitContributions');
      const days = value('activeCommitDays');
      if (commits !== undefined) return `${commits} attributable commit contributions${days === undefined ? '' : ` across ${days} active days`} are recorded in the saved evidence.`;
      break;
    }
    case 'collaboration': {
      const items = ([['pullRequestsOpened', 'pull requests'], ['issuesOpened', 'issues'], ['reviewsSubmitted', 'reviews']] as const)
        .flatMap(([key, label]) => { const count = value(key); return count === undefined ? [] : [`${count} ${label}`]; });
      if (items.length) return `Saved GitHub activity includes ${items.join(', ')}.`;
      break;
    }
    case 'current_year_contributions': {
      const count = value('totalContributions');
      const year = value('year');
      if (count !== undefined) return `${count} contributions are recorded${year === undefined ? '' : ` for ${year}`} in the saved UTC calendar evidence.`;
      break;
    }
    case 'problem_solving_dsa': {
      const counts = ([['easySolved', 'easy'], ['mediumSolved', 'medium'], ['hardSolved', 'hard']] as const)
        .flatMap(([key, label]) => { const count = value(key); return count === undefined ? [] : [`${count} ${label}`]; });
      if (counts.length) return `Saved problem-solving evidence includes ${counts.join(', ')} problems.`;
      break;
    }
  }
  const evidenceDescription = score.evidenceRefs.map((id) => evidenceById.get(id)?.description.trim()).find((description) => description);
  if (evidenceDescription) {
    const sentence = evidenceDescription.split(/(?<=[.!?])\s+/)[0];
    if (!/(arithmetic mean|normalized evidence value|scored\s*[·-]|supporting item|evidence available)/i.test(sentence)) {
      return sentence.length > 180 ? `${sentence.slice(0, 177).trimEnd()}…` : sentence;
    }
  }
  if (score.score === undefined) return 'No comparable evidence is available; this category is not scored.';
  return 'Saved evidence is available for this category.';
}

export function EvaluationResults({ candidate, evaluation }: { candidate: Candidate; evaluation: PersistedEvaluation & { result: EvaluationResponse } }) {
  const result = evaluation.result;
  const evidenceById = new Map(result.evidence.map((item) => [item.evidenceId, item]));
  return <main className="evaluation-page">
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE EVALUATION</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · {result.targetRole.replaceAll('_', ' ')}</p></div><span className={`evaluation-status ${result.evaluationStatus === 'completed' ? 'is-complete' : 'is-incomplete'}`}>{result.evaluationStatus === 'completed' ? 'Completed' : 'Insufficient Evidence'}</span></header>
    <section className="evaluation-summary-card" aria-label="Overall score">
      <span className="evaluation-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
      <div className="evaluation-summary-value">{result.overallScore !== undefined ? <><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-score"><AnimatedMetric value={result.overallScore} decimals={String(result.overallScore).split('.')[1]?.length ?? 0}/><small>/100</small></strong></> : <><span className="summary-label">OVERALL SCORE</span><strong className="evaluation-overall-missing">Not calculated</strong><p>An overall score is withheld until all six categories have scoreable evidence.</p></>}</div>
      {result.overallScore !== undefined && <div className="overall-meter" role="img" aria-label={`Overall score ${result.overallScore} out of 100`}><span style={{ width: `${result.overallScore}%` }}/></div>}
      <small className="evaluation-platform-summary"><span className="platform-heading"><PlatformLogo platform="github"/><PlatformLogo platform="leetcode"/></span><span>Active GitHub + LeetCode evaluation</span></small>
    </section>
    <section className="evaluation-report-panel" aria-labelledby="evaluation-categories-title"><div className="evaluation-report-header"><div className="evaluation-report-title"><span className="evaluation-report-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3.75h7l4 4v12.5H7a2 2 0 0 1-2-2v-12.5a2 2 0 0 1-2-2Z"/><path d="M14 4v4h4M8.5 12h7M8.5 15.5h7"/></svg></span><div><h2 id="evaluation-categories-title">Evaluation report</h2><p>Optional missing LeetCode profiles use the rubric-defined DSA zero policy.</p></div></div><details className="evaluation-about-scoring"><summary>About scoring</summary><p>{result.calculationExplanation}</p></details></div><div className="evaluation-report-grid">{scoringCategories.map((category) => {
      const score = result.categoryScores.find((item) => item.categoryId === category.id)!;
      const reportCategory = result.finalReport?.categories.find(({ categoryId }) => categoryId === category.id);
      const leetcodeUnavailable = category.id === 'problem_solving_dsa' && score.score === undefined && typeof reportCategory?.metrics.dataStatus === 'string' && /leetcode/i.test(reportCategory.metrics.dataStatus) && /(no saved|no usable|snapshot|statistics)/i.test(reportCategory.metrics.dataStatus);
      return <EvaluationCategoryCard key={category.id} categoryId={category.id} title={category.displayName} score={score.score} availabilityLabel={score.score === undefined && (reportCategory?.status === 'unavailable' || leetcodeUnavailable) ? 'Unavailable' : undefined} showProgress={score.score !== undefined && score.scoreBasis !== 'optional_missing_zero'} description={conciseCategoryDescription(score, evidenceById, reportCategory)} evidence={score.evidenceRefs.flatMap((id) => { const item = evidenceById.get(id); return item ? [{ label: item.source, description: item.description, observedAt: item.observedAt }] : []; })}/>;
    })}</div></section>
    <p className="evaluation-disclaimer">{result.decisionSupportNotice} Scores describe the saved evidence and do not establish engineering quality or candidate identity.</p>
  </main>;
}
