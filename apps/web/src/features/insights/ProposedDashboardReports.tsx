import { Link } from 'react-router-dom';
import type { DashboardResponse } from '@devrank/contracts';
import { ProposedEvaluationReport } from '../evaluations/ProposedEvaluationReport';

export function ProposedDashboardReports({ evaluations }: { evaluations: DashboardResponse['recentEvaluations'] }) {
  if (evaluations.length === 0) return <p className="insights-state">No saved evaluation reports yet.</p>;
  return <div className="proposed-dashboard-reports">{evaluations.map((item) => <article key={item.id}>
    <header><div><h3><Link to={`/candidates/${item.candidateId}`}>{item.candidateName}</Link></h3><small><time dateTime={item.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</time> · active scoring version {item.scoringVersion ?? 'unavailable'}</small></div><span>{item.status.replaceAll('_', ' ')}</span></header>
    {item.proposedReport ? <ProposedEvaluationReport report={item.proposedReport} title="Draft GitHub + LeetCode report"/> : <p className="insights-state" role={item.proposedReportUnavailable ? 'status' : undefined}>{item.proposedReportUnavailable ? 'Saved proposal values are unavailable because this server cannot read the evaluation result snapshot.' : 'This evaluation has no readable saved platform evidence snapshot yet.'}</p>}
  </article>)}</div>;
}
