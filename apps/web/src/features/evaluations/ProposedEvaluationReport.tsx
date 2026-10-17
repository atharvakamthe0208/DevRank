import type { FinalEvaluationReport } from '@devrank/contracts';

function formatMetric(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

export function FinalEvaluationReport({ report, title = 'GitHub + LeetCode evaluation report · v4' }: {
  report: FinalEvaluationReport;
  title?: string;
}) {
  return <section className="proposed-evaluation-report" aria-label={title}>
    <div className="proposed-report-heading"><div><h2>{title}</h2><p>Active v4 deterministic evidence index · these source-volume and breadth measures are not calibrated measures of engineering competence or hiring suitability.</p></div>
      <strong>{report.overallScore === undefined ? 'Overall score withheld' : `Overall index ${report.overallScore} / 100`}</strong></div>
    <p className="proposed-report-notice">{report.notice}</p>
    <div className="proposed-report-grid">{report.categories.map((category) => <article className="proposed-report-card" key={category.categoryId}>
      <div className="proposed-report-card-heading"><h3>{category.displayName}</h3><span>{category.weight}% weight</span></div>
      <div className="proposed-report-score"><strong>{category.score === undefined ? category.status === 'partial' ? 'Partial evidence' : 'Unavailable' : `${category.score} / 100`}</strong>
        {category.weightedPoints !== undefined && <small>{category.weightedPoints} weighted points</small>}</div>
      {Object.keys(category.metrics).length > 0 ? <dl>{Object.entries(category.metrics).map(([key, value]) => <div key={key}><dt>{formatMetric(key)}</dt><dd>{value}</dd></div>)}</dl> : <p>No usable source values are saved for this category.</p>}
      <small>{category.source === 'github' ? 'GitHub' : 'LeetCode'} · {category.formula}</small>
    </article>)}</div>
  </section>;
}

/** @deprecated Use FinalEvaluationReport. */
export const ProposedEvaluationReport = FinalEvaluationReport;
