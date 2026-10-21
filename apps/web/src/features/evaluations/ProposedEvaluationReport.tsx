import type { FinalEvaluationReport } from '@devrank/contracts';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { AnimatedMetric } from '../../components/metrics/KpiCards';

function formatMetric(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

export function FinalEvaluationReport({ report, title = 'GitHub + LeetCode evaluation report · v4' }: {
  report: FinalEvaluationReport;
  title?: string;
}) {
  return <section className="proposed-evaluation-report" aria-label={title}>
    <div className="proposed-report-heading"><div><h2>{title}</h2></div>
      <strong>{report.overallScore === undefined ? 'Overall score withheld' : <>Overall index <AnimatedMetric value={report.overallScore} decimals={String(report.overallScore).split('.')[1]?.length ?? 0}/> / 100</>}</strong></div>
    <div className="proposed-report-grid">{report.categories.map((category) => <article className="proposed-report-card" key={category.categoryId}>
      <div className="proposed-report-card-heading"><h3>{category.displayName}</h3><span>{category.weight}% weight</span></div>
      <div className="proposed-report-score"><strong>{category.score === undefined ? category.status === 'partial' ? 'Partial evidence' : 'Unavailable' : <><AnimatedMetric value={category.score} decimals={String(category.score).split('.')[1]?.length ?? 0}/> / 100</>}</strong>
        {category.weightedPoints !== undefined && <small>{category.weightedPoints} weighted points</small>}</div>
      {category.score !== undefined && <div className="report-score-track" role="progressbar" aria-label={`${category.displayName} score`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={category.score}><span style={{ width: `${category.score}%` }}/></div>}
      {Object.keys(category.metrics).length > 0 ? <dl>{Object.entries(category.metrics).map(([key, value]) => <div key={key}><dt>{formatMetric(key)}</dt><dd>{value}</dd></div>)}</dl> : <p>No usable source values are saved for this category.</p>}
      <small className="platform-heading"><PlatformLogo platform={category.source}/>{category.source === 'github' ? 'GitHub' : 'LeetCode'} · {category.formula}</small>
    </article>)}</div>
  </section>;
}

/** @deprecated Use FinalEvaluationReport. */
export const ProposedEvaluationReport = FinalEvaluationReport;
