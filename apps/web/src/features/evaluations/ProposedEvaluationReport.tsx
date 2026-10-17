import type { ProposedEvaluationReport } from '@devrank/contracts';

function formatMetric(name: string): string {
  return name.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').replace(/^./, (value) => value.toUpperCase());
}

export function ProposedEvaluationReport({ report, title = 'Proposed GitHub + LeetCode evaluation report' }: {
  report: ProposedEvaluationReport;
  title?: string;
}) {
  return <section className="proposed-evaluation-report" aria-label={title}>
    <div className="proposed-report-heading"><div><h2>{title}</h2><p>Proposal-only evidence index · weights are not active policy and this score does not affect v3 results or rankings.</p></div>
      <strong>{report.overallScore === undefined ? 'Weighted total withheld' : `Draft weighted index ${report.overallScore} / 100`}</strong></div>
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
