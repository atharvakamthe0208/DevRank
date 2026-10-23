import type { AdminRecruiterDetails } from '@devrank/contracts';

type Props = {
  name: string;
  state: 'loading' | 'error' | 'ready';
  details: AdminRecruiterDetails | null;
  error: string;
  onRetry: () => void;
  onClose: () => void;
};

function shown(value: string | null): string {
  return value?.trim() || 'Not provided';
}

function date(value: string): string {
  return new Date(value).toLocaleString();
}

const activityLabels: Record<AdminRecruiterDetails['recentActivity'][number]['type'], string> = {
  evaluation_created: 'Evaluation created',
  screening_initiated: 'Resume screening initiated',
  screening_completed: 'Resume screening completed',
  recruiter_approved: 'Recruiter approved',
  recruiter_rejected: 'Recruiter rejected',
};

export function AdminRecruiterDetailsPanel({ name, state, details, error, onRetry, onClose }: Props) {
  return <section className="admin-detail-panel" aria-labelledby="admin-recruiter-detail-heading" aria-busy={state === 'loading'}>
    <header className="admin-detail-heading">
      <div>
        <div className="eyebrow"><span className="eyebrow-line"/> RECRUITER DETAILS</div>
        <h2 id="admin-recruiter-detail-heading">{name}</h2>
      </div>
      <button className="secondary-button" type="button" onClick={onClose}>Close details</button>
    </header>

    {state === 'loading' && <p className="admin-detail-state" role="status">Loading recruiter profile and activity…</p>}
    {state === 'error' && <div className="admin-load-error" role="alert"><p>{error || 'Recruiter details could not be loaded.'}</p><button className="secondary-button" type="button" onClick={onRetry}>Try again</button></div>}
    {state === 'ready' && details && <>
      <div className="admin-detail-columns">
        <section aria-labelledby="admin-account-details-heading">
          <h3 id="admin-account-details-heading">Account details</h3>
          <dl className="admin-detail-fields">
            <div><dt>Work email</dt><dd>{shown(details.profile.email)}</dd></div>
            <div><dt>Account role</dt><dd>Recruiter</dd></div>
            <div><dt>Approval status</dt><dd><span className={`admin-status status-${details.profile.approvalStatus}`}>{details.profile.approvalStatus}</span></dd></div>
            <div><dt>Email confirmation</dt><dd>{details.profile.emailConfirmed ? 'Confirmed' : 'Not confirmed'}</dd></div>
            <div><dt>Registered</dt><dd><time dateTime={details.profile.registeredAt}>{date(details.profile.registeredAt)}</time></dd></div>
            <div><dt>Profile last updated</dt><dd><time dateTime={details.profile.profileUpdatedAt}>{date(details.profile.profileUpdatedAt)}</time></dd></div>
            <div><dt>Last approval decision</dt><dd>{details.profile.lastApprovalDecision ? `${details.profile.lastApprovalDecision.status} · ${date(details.profile.lastApprovalDecision.decidedAt)}` : 'No decision recorded'}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="admin-professional-details-heading">
          <h3 id="admin-professional-details-heading">Professional details</h3>
          <dl className="admin-detail-fields">
            <div><dt>Phone</dt><dd>{shown(details.profile.phoneNumber)}</dd></div>
            <div><dt>Company / organization</dt><dd>{shown(details.profile.companyName)}</dd></div>
            <div><dt>Job title</dt><dd>{shown(details.profile.jobTitle)}</dd></div>
            <div><dt>Company website</dt><dd>{shown(details.profile.companyWebsite)}</dd></div>
            <div><dt>Location</dt><dd>{[details.profile.locationCity, details.profile.locationCountry].filter((part) => part?.trim()).join(', ') || 'Not provided'}</dd></div>
          </dl>
        </section>
      </div>

      <section className="admin-detail-stat-section" aria-labelledby="admin-activity-stats-heading">
        <h3 id="admin-activity-stats-heading">Activity statistics</h3>
        <div className="admin-detail-stats">
          <article><span>Total evaluations</span><strong>{details.stats.totalEvaluations}</strong></article>
          <article><span>Completed evaluations</span><strong>{details.stats.completedEvaluations}</strong></article>
          <article><span>In-progress evaluations</span><strong>{details.stats.inProgressEvaluations}</strong></article>
          <article><span>Distinct candidates evaluated</span><strong>{details.stats.distinctCandidatesEvaluated}</strong></article>
          <article><span>Resume screenings initiated</span><strong>{details.stats.resumeScreeningsInitiated}</strong></article>
          <article><span>Completed resume screenings</span><strong>{details.stats.completedResumeScreenings}</strong></article>
          <article><span>Average completed score</span><strong>{details.stats.averageCompletedEvaluationScore === null ? '—' : `${details.stats.averageCompletedEvaluationScore.toFixed(2)} / 100`}</strong></article>
          <article><span>Activity in the last 30 days</span><strong>{details.stats.recentActivityCount30Days}</strong></article>
        </div>
        <p className="admin-detail-note">Candidates evaluated counts distinct candidates with a completed or insufficient-evidence evaluation. Average score uses completed evaluations with a saved score. Recent activity counts persisted evaluation creation, screening start/completion, and approval/rejection events from the last 30 days.</p>
      </section>

      <section className="admin-detail-activity" aria-labelledby="admin-recent-activity-heading">
        <h3 id="admin-recent-activity-heading">Recent activity</h3>
        {details.recentActivity.length === 0 ? <p className="admin-detail-state">No persisted activity is available for this account.</p> : <ol>
          {details.recentActivity.map((activity) => <li key={activity.id}>
            <span>{activityLabels[activity.type]}</span>
            <time dateTime={activity.occurredAt}>{date(activity.occurredAt)}</time>
          </li>)}
        </ol>}
      </section>
    </>}
  </section>;
}
