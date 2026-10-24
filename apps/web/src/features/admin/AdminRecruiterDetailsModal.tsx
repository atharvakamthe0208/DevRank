import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AdminRecruiterDetails } from '@devrank/contracts';

type Props = {
  recruiterId: string;
  name: string;
  state: 'loading' | 'error' | 'ready';
  details: AdminRecruiterDetails | null;
  error: string;
  onRetry: () => void;
  onClose: () => void;
};

function date(value: string) { return new Date(value).toLocaleString(); }
function shown(value: string | null) { return value?.trim() || 'Not provided'; }

export function AdminRecruiterDetailsModal({ recruiterId, name, state, details, error, onRetry, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const navigate = useNavigate();

  function requestClose(destination?: string) {
    if (closing) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) { if (destination) navigate(destination); onClose(); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => { if (destination) navigate(destination); onClose(); }, 150);
  }
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(closeTimer.current); document.body.style.overflow = previousOverflow; };
  }, []);

  return <dialog ref={dialog} className={`admin-details-dialog${closing ? ' is-closing' : ''}`} aria-labelledby="admin-modal-title"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <div className="admin-details-dialog-content">
      <header className="admin-detail-heading">
        <div><div className="eyebrow"><span className="eyebrow-line"/> RECRUITER DETAILS</div><h2 id="admin-modal-title">{name}</h2></div>
        <button className="admin-modal-close" type="button" onClick={() => requestClose()} aria-label="Close recruiter details">×</button>
      </header>
      {state === 'loading' && <div className="admin-modal-state" role="status" aria-busy="true"><span className="sr-only">Loading recruiter account details…</span><div className="admin-detail-fields" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <div key={index}><span className="admin-skeleton admin-detail-skeleton-label"/><span className="admin-skeleton admin-detail-skeleton-value"/></div>)}</div></div>}
      {state === 'error' && <div className="admin-modal-state admin-load-error" role="alert"><p>{error || 'Recruiter details could not be loaded.'}</p><button className="secondary-button" type="button" onClick={onRetry}>Try again</button></div>}
      {state === 'ready' && details && <dl className="admin-detail-fields admin-modal-fields">
        <div><dt>Work email</dt><dd>{shown(details.profile.email)}</dd></div>
        <div><dt>Account role</dt><dd>Recruiter</dd></div>
        <div><dt>Approval status</dt><dd><span className={`admin-status status-${details.profile.approvalStatus}`}>{details.profile.approvalStatus}</span></dd></div>
        <div><dt>Email confirmation</dt><dd>{details.profile.emailConfirmed ? 'Confirmed' : 'Not confirmed'}</dd></div>
        <div><dt>Registered</dt><dd><time dateTime={details.profile.registeredAt}>{date(details.profile.registeredAt)}</time></dd></div>
        <div><dt>Profile last updated</dt><dd><time dateTime={details.profile.profileUpdatedAt}>{date(details.profile.profileUpdatedAt)}</time></dd></div>
        <div><dt>Last approval decision</dt><dd>{details.profile.lastApprovalDecision ? `${details.profile.lastApprovalDecision.status} · ${date(details.profile.lastApprovalDecision.decidedAt)}` : 'No decision recorded'}</dd></div>
      </dl>}
      <footer className="admin-details-dialog-footer"><Link to={`/admin/recruiters/${encodeURIComponent(recruiterId)}`} className="admin-more-details" onClick={(event) => { event.preventDefault(); requestClose(`/admin/recruiters/${encodeURIComponent(recruiterId)}`); }}>View more details <span aria-hidden="true">→</span></Link></footer>
    </div>
  </dialog>;
}
