import { useEffect, useState } from 'react';
import devrankMark from '../../assets/devrank-mark.svg';
import { Link, useParams } from 'react-router-dom';
import type { AdminRecruiterDetails } from '@devrank/contracts';
import { useAuth } from '../auth/AuthProvider';
import { apiRequest } from '../../lib/api/client';
import { AdminRecruiterDetailsPanel } from './AdminRecruiterDetailsPanel';
import './admin-recruiters-page.css';

type DetailsState = 'loading' | 'error' | 'ready';

export function AdminRecruiterDetailsPage() {
  const { recruiterId = '' } = useParams();
  const { session, profile } = useAuth();
  const [details, setDetails] = useState<AdminRecruiterDetails | null>(null);
  const [state, setState] = useState<DetailsState>('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    if (!session || !recruiterId) {
      setError('Recruiter details could not be loaded.');
      setState('error');
      return () => { active = false; };
    }
    setState('loading');
    setError('');
    setDetails(null);
    void apiRequest<{ details: AdminRecruiterDetails }>(`/admin/recruiters/${encodeURIComponent(recruiterId)}/details`, undefined, session.access_token)
      .then((response) => { if (active) { setDetails(response.details); setState('ready'); } })
      .catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : 'Recruiter details could not be loaded.'); setState('error'); } });
    return () => { active = false; };
  }, [session, recruiterId, reload]);

  const name = details?.profile.displayName || details?.profile.email || 'Recruiter';
  return <div className="admin-page">
    <header className="admin-topbar"><Link to="/admin/recruiters" className="brand admin-brand"><><img src={devrankMark} alt=""/><span>devrank<span className="brand-period">.</span></span></></Link><div className="admin-account"><span>{profile?.display_name || 'Administrator'}</span><span className="admin-header-badge">Administrator</span></div></header>
    <main className="admin-content admin-recruiter-detail-page">
      <Link to="/admin/recruiters" className="admin-back-link">← Back to recruiter applications</Link>
      <div className="admin-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> RECRUITER DETAILS</div><h1>{name}</h1><p className="page-subtitle">Administrator view of recruiter account and activity.</p></div><span className="admin-role-badge">Project administrator</span></div>
      <AdminRecruiterDetailsPanel name={name} state={state} details={details} error={error} onRetry={() => setReload((value) => value + 1)} onClose={() => undefined} showHeader={false}/>
    </main>
  </div>;
}
