import { proposedRubric, type GitHubInsights } from '@devrank/contracts';

function utcTimestamp(value: string): string {
  return `${new Date(value).toISOString().replace('T', ' ').replace('.000Z', '')} UTC`;
}

const contributionTypes = [
  ['commits', 'Commit contributions'],
  ['pullRequestsOpened', 'Pull requests opened'],
  ['issuesOpened', 'Issues opened'],
  ['reviewsSubmitted', 'Reviews submitted'],
] as const;

const reasonMessages: Record<string, string> = {
  not_configured: 'The server-side GitHub contribution token is not configured. It is never sent to the browser.',
  provider_error: 'GitHub did not return contribution history.',
  provider_timeout: 'The GitHub contribution-history request timed out.',
  provider_unavailable: 'GitHub contribution history is temporarily unavailable.',
  malformed_response: 'GitHub returned contribution data in an unsupported format.',
  rate_limited: 'GitHub rate-limited the contribution-history request.',
  missing_history: 'GitHub did not return contribution history for this account and period.',
  attribution_mismatch: 'The returned account did not match the requested GitHub username.',
  partial_response: 'Some contribution fields or dates were missing from the provider response.',
  truncated_history: 'The contribution detail reached a retrieval limit.',
  duplicate_conflict: 'Duplicate contribution records disagreed; conflicting detail is not treated as complete.',
};

export function ProposedRubricPanel({ insights, snapshotState }: {
  insights?: GitHubInsights;
  snapshotState: 'loading' | 'synced' | 'idle' | 'error';
}) {
  const year = insights?.currentYearContributions;
  const status = year?.status ?? 'unavailable';
  const displayStatus = snapshotState === 'loading' && !year ? 'loading' : status;
  const unavailableText = snapshotState === 'loading'
    ? 'Loading saved contribution history…'
    : snapshotState === 'synced'
      ? 'This saved GitHub snapshot predates contribution-history capture. Sync GitHub again to request history; availability depends on the server-side provider configuration.'
      : snapshotState === 'error'
        ? 'A current contribution snapshot could not be loaded. Retry the GitHub load or sync before using contribution history.'
        : 'No saved GitHub contribution snapshot is available. Sync a GitHub profile; history requires the server-side contribution token and is never sent to the browser.';

  return <section className="proposed-rubric-panel" aria-labelledby="proposed-rubric-title">
    <div className="proposed-rubric-heading">
      <div><h3 id="proposed-rubric-title">Proposed GitHub + LeetCode Rubric</h3><p>Draft taxonomy · not approved policy · not used by the active scorer</p></div>
      <span className="source-status is-unavailable">PROPOSED</span>
    </div>
    <p className="proposed-rubric-notice">These weights are proposals only. Active v3 scoring, configured owner weights, and saved historical v1/v2/v3 evaluations remain unchanged; Communication Skills remains an active v3 category.</p>
    <div className="proposed-rubric-grid">{proposedRubric.categories.map((category) => <article className="proposed-rubric-category" key={category.id}>
      <div><h4>{category.displayName}</h4><strong>{category.proposedWeight}%</strong></div>
      <span>{category.source === 'github' ? 'Evidence source: GitHub' : 'Evidence source: LeetCode'}</span>
      <p>{category.definition}</p>
    </article>)}</div>

    <div className="contribution-history" aria-labelledby="contribution-history-title">
      <div className="contribution-history-heading"><h4 id="contribution-history-title">GitHub contribution history</h4><span className={`source-status ${displayStatus === 'available' ? 'is-available' : displayStatus === 'partial' ? 'is-unavailable' : 'is-idle'}`}>{displayStatus}</span></div>
      {year && insights ? <>
        <p className="contribution-period">{year.year} calendar year · {year.timezone} · {year.periodStart.slice(0, 10)} through {year.periodEnd.slice(0, 10)}</p>
        <ul className="contribution-metrics">
          <li><span>Username attribution check</span><strong>{insights.attributionStatus}</strong></li>
          <li><span>Calendar contribution total</span><strong>{year.totalContributions === undefined ? 'Unavailable' : year.totalContributions}</strong></li>
          <li><span>Captured at</span><strong>{utcTimestamp(year.observedAt)}</strong></li>
          <li><span>Observed through</span><strong>{utcTimestamp(year.observedThrough)}</strong></li>
          <li><span>Active UTC weeks</span><strong>{year.activeWeeks === undefined || year.observedWeeks === undefined ? 'Unavailable' : `${year.activeWeeks} / ${year.observedWeeks}${year.activeWeekCoveragePercent === undefined ? '' : ` (${year.activeWeekCoveragePercent}%)`}`}</strong></li>
          <li><span>Contributions per observed UTC week</span><strong>{year.contributionsPerObservedWeek === undefined ? 'Unavailable' : year.contributionsPerObservedWeek}</strong></li>
        </ul>
        <h5>Available contribution-type totals</h5>
        <ul className="contribution-metrics">{contributionTypes.map(([key, label]) => <li key={key}><span>{label}</span><strong>{year.contributionTypes?.[key] === undefined ? 'Unavailable' : year.contributionTypes[key]}</strong></li>)}</ul>
        {year.weeklyContributions && <details className="weekly-contributions"><summary>Contributions by observed UTC week</summary><ul>{year.weeklyContributions.map((week) => <li key={week.weekStart}><span>Week of {week.weekStart}</span><strong>{week.contributionCount}</strong></li>)}</ul></details>}
        {year.reasons.length > 0 && <ul className="contribution-reasons">{year.reasons.map((reason) => <li key={reason}>{reasonMessages[reason] ?? 'Some contribution fields are unavailable.'}</li>)}</ul>}
      <h5>Development activity · separate context</h5>
      <ul className="contribution-metrics">
        <li><span>Status</span><strong>{insights.developmentActivity.status}</strong></li>
        <li><span>Commit contributions</span><strong>{insights.developmentActivity.totalCommitContributions ?? 'Unavailable'}</strong></li>
        <li><span>Active commit days / weeks</span><strong>{insights.developmentActivity.activeCommitDays === undefined || insights.developmentActivity.activeCommitWeeks === undefined ? 'Unavailable' : `${insights.developmentActivity.activeCommitDays} / ${insights.developmentActivity.activeCommitWeeks}`}</strong></li>
      </ul>
      <h5>Collaboration · separate context</h5>
      <ul className="contribution-metrics">
        <li><span>Status</span><strong>{insights.collaboration.status}</strong></li>
        <li><span>Pull requests opened</span><strong>{insights.collaboration.pullRequestsOpened ?? 'Unavailable'}</strong></li>
        <li><span>Issues opened</span><strong>{insights.collaboration.issuesOpened ?? 'Unavailable'}</strong></li>
        <li><span>Reviews submitted</span><strong>{insights.collaboration.reviewsSubmitted ?? 'Unavailable'}</strong></li>
      </ul>
      {[...insights.developmentActivity.reasons, ...insights.collaboration.reasons].length > 0 && <ul className="contribution-reasons">{[...new Set([...insights.developmentActivity.reasons, ...insights.collaboration.reasons])].map((reason) => <li key={`activity:${reason}`}>{reasonMessages[reason] ?? 'Some GitHub activity fields are unavailable.'}</li>)}</ul>}
      </> : <p className="contribution-unavailable">{unavailableText}</p>}
      <small>Calendar totals and type totals overlap and are not added together. Missing values stay unavailable, and descriptive counts are not scores or measures of code quality.</small>
    </div>
  </section>;
}
