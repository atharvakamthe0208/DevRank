import { useEffect, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Candidate } from '@devrank/contracts';
import { useAuth } from '../auth/AuthProvider';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { supabase } from '../../lib/supabase/client';
import { parseCandidateApiResponse } from './candidate-response-validation';
import { CandidatePlatformDataPanel } from './CandidatePlatformDataPanel';
import { CandidateEvaluationHistory } from '../evaluations/CandidateEvaluationHistory';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useWorkspaceBreadcrumbLabels } from '../../components/layout/WorkspaceBreadcrumbContext';
import './candidate-workflow.css';

type LoadState = { loading: true } | { loading: false; candidate: Candidate } | { loading: false; error: string; missing?: boolean };

export function CandidateDetailsPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [state, setState] = useState<LoadState>({ loading: true });
  const candidateName = !state.loading && 'candidate' in state ? state.candidate.name : undefined;
  useWorkspaceBreadcrumbLabels({ candidateName });

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        setState({ loading: false, error: 'This candidate address is invalid.', missing: true });
        return;
      }
      if (!session?.access_token) { setState({ loading: false, error: 'Your secure session is unavailable. Sign in again to view this candidate.' }); return; }
      setState({ loading: true });
      try {
        const response = await apiRequest<unknown>(`/candidates/${id}`, { signal: controller.signal }, session.access_token);
        if (controller.signal.aborted) return;
        const parsed = parseCandidateApiResponse(response);
        if (!parsed) throw new Error('Candidate details returned by the server were incomplete or invalid.');
        setState({ loading: false, candidate: parsed });
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          setState({ loading: false, error: 'Your session expired. Sign in again to continue.' });
          await supabase?.auth.signOut({ scope: 'local' });
        } else if (cause instanceof ApiRequestError && cause.status === 403) setState({ loading: false, error: 'Recruiter access is not approved for this workspace.' });
        else if (cause instanceof ApiRequestError && cause.status === 404) setState({ loading: false, error: 'This candidate does not exist or is not available in your workspace.', missing: true });
        else setState({ loading: false, error: cause instanceof Error ? cause.message : 'Could not load candidate details. Check your connection and try again.' });
      }
    }
    void load();
    return () => controller.abort();
  }, [id, session?.access_token]);

  if (state.loading) return <WorkspaceSkeleton variant="detail"/>;
  const navigationState = location.state as { candidateListReturn?: { path?: unknown; search?: unknown; scrollY?: unknown } } | null;
  const listReturn = navigationState?.candidateListReturn;
  const listPath = typeof listReturn?.path === 'string' && /^\/dashboard\/candidates(?:\?.*)?$/.test(listReturn.path) ? listReturn.path : '/dashboard/candidates';
  const hasListReturn = Boolean(listReturn && typeof listReturn.path === 'string' && /^\/dashboard\/candidates(?:\?.*)?$/.test(listReturn.path));
  const backState = { candidateListSearch: typeof listReturn?.search === 'string' ? listReturn.search : '', candidateListRestoreScroll: typeof listReturn?.scrollY === 'number' ? listReturn.scrollY : undefined };
  function backToList(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && hasListReturn) {
      event.preventDefault();
      navigate(-1);
    }
  }
  if (!('candidate' in state)) return <div className="not-found-card"><span className="not-found-mark">{state.missing ? '?' : '!'}</span><h1>{state.missing ? 'Candidate not found' : 'Could not load candidate'}</h1><p>{state.error}</p><Link className="primary-button link-button" to={listPath} state={backState} replace onClick={backToList}>Back to candidates</Link></div>;

  const candidate = state.candidate;
  const notice = (location.state as { notice?: unknown } | null)?.notice;
  const profiles = [
    { platform: 'github' as const, name: 'GitHub', handle: candidate.githubUsername, url: candidate.githubUsername ? `https://github.com/${encodeURIComponent(candidate.githubUsername)}` : '', className: 'github-mark' },
    { platform: 'leetcode' as const, name: 'LeetCode', handle: candidate.leetcodeUsername, url: candidate.leetcodeUsername ? `https://leetcode.com/u/${encodeURIComponent(candidate.leetcodeUsername)}/` : '', className: 'leetcode-mark' },
  ];
  const availableProfiles = profiles.filter((profile) => profile.handle && profile.url);
  return <div className="detail-page candidate-api-detail">
    <Link className="back-link" to={listPath} state={backState} replace onClick={backToList}>← <span>Back to candidates</span></Link>
    {typeof notice === 'string' && <p className="form-feedback candidate-success-message" role="status">{notice}</p>}
    <section className="detail-profile-card"><div className="avatar avatar-xl avatar-user">{candidate.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')}</div><div className="profile-main"><div className="profile-title-row"><div><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE PROFILE</span><h1>{candidate.name}</h1></div><div className="candidate-profile-actions"><Link className="secondary-button link-button" to={`/candidates/${candidate.id}/report`} state={location.state}>Generate Final Report</Link><Link className="primary-button link-button" to={`/evaluations?candidateId=${encodeURIComponent(candidate.id)}`} state={{ ...(location.state as object | null), returnTo: `/candidates/${candidate.id}` }}>Evaluate candidate</Link></div></div><div className="profile-meta"><span>Added <time dateTime={candidate.createdAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(candidate.createdAt))}</time></span>{candidate.email && <a href={`mailto:${candidate.email}`}>✉ {candidate.email}</a>}</div></div></section>
    <CandidateEvaluationHistory candidateId={candidate.id} />
    <section className="detail-section profile-links-section"><div className="section-heading"><div><h2>Developer profiles</h2><p>Profiles associated with this candidate record</p></div><Link className="secondary-button link-button" to={`/candidates/${candidate.id}/evaluate`} state={{ ...(location.state as object | null), returnTo: `/candidates/${candidate.id}` }}>Use a saved role profile</Link></div><div className="profile-links">{availableProfiles.length ? availableProfiles.map((profile) => <a className="profile-link-card" href={profile.url} key={profile.name} target="_blank" rel="noreferrer"><span className={`platform-mark ${profile.className}`}><PlatformLogo platform={profile.platform} size="regular"/></span><span><strong>{profile.name}</strong><small>@{profile.handle}</small></span><span className="external-arrow">↗</span></a>) : <p className="candidate-detail-empty">No developer profile usernames have been added.</p>}</div></section>
    <CandidatePlatformDataPanel candidate={candidate} onCandidateUpdated={(updated) => setState({ loading: false, candidate: updated })} />
  </div>;
}
