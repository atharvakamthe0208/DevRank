import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { evaluationRequestSchema, persistedEvaluationSchema, roleProfileListResponseSchema, type Candidate, type RoleProfileOption } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { WorkspaceSkeleton } from '../../components/WorkspaceSkeleton';
import { useWorkspaceBreadcrumbLabels } from '../../components/layout/WorkspaceBreadcrumbContext';
import { useUnsavedChangesBlocker } from '../../app/useUnsavedChangesBlocker';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import './evaluation.css';

type PageState = 'loading' | 'ready' | 'error';
function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Could not load the evaluation setup. Check your connection and retry.';
}
function labelRole(name: string): string { return name.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '); }
function isRoleSelection(value: unknown): value is string { return typeof value === 'string' && value.length <= 128; }

export function EvaluationCreatePage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [profiles, setProfiles] = useState<RoleProfileOption[]>([]);
  const { value: selected, status: draftStatus, persisted, setValue: setSelected, initialize, clear: clearDraft } = useSessionDraft(session?.user?.id, `evaluation-create:${id}`, '', isRoleSelection);
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [roleEdited, setRoleEdited] = useState(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const allowNavigationRef = useRef(false);
  useWorkspaceBreadcrumbLabels({ candidateName: candidate?.name });
  useUnsavedChangesBlocker(roleEdited && !submitting, 'Your role selection is kept as a draft in this browser tab. Leave this page? You can discard the draft from the form.', allowNavigationRef);
  const returnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
  function backToCandidate(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && returnTo === `/candidates/${id}`) { event.preventDefault(); navigate(-1); }
  }

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!session?.access_token) { setError('Your secure session is unavailable. Sign in again.'); setState('error'); return; }
    setState('loading'); setError('');
    try {
      const [candidateResponse, roleResponse] = await Promise.all([
        apiRequest<unknown>(`/candidates/${id}`, { signal }, session.access_token),
        apiRequest<unknown>('/evaluations/role-profiles', { signal }, session.access_token),
      ]);
      if (signal?.aborted) return;
      const candidateParsed = parseCandidateApiResponse(candidateResponse);
      if (!candidateParsed) throw new Error('Candidate details returned by the API were invalid.');
      const roleProfiles = roleProfileListResponseSchema.parse(roleResponse).items;
      setCandidate(candidateParsed); setProfiles(roleProfiles);
      const defaultRole = roleProfiles.find((profile) => profile.usable)?.id ?? '';
      if (selectedRef.current && !roleProfiles.some((profile) => profile.id === selectedRef.current && profile.usable)) clearDraft(defaultRole);
      else initialize(defaultRole);
      setState('ready');
    } catch (cause) {
      if (signal?.aborted) return;
      setError(messageFor(cause)); setState('error');
    }
  }, [id, session?.access_token, initialize, clearDraft]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function createEvaluation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = evaluationRequestSchema.safeParse({ roleProfileId: selected });
    if (!request.success) { setError('Choose an available, valid saved role profile.'); return; }
    if (!session?.access_token) { setError('Your secure session expired. Sign in again to continue.'); return; }
    setSubmitting(true); setError('');
    try {
      const response = await apiRequest<unknown>(`/candidates/${id}/evaluations`, { method: 'POST', body: JSON.stringify(request.data) }, session.access_token);
      const saved = persistedEvaluationSchema.parse(response);
      clearDraft(selected);
      setRoleEdited(false);
      allowNavigationRef.current = true;
      navigate(`/evaluations/${saved.id}`, { state: { ...(location.state as object | null), returnTo: `/candidates/${id}`, historyBackSteps: 2 } });
    } catch (cause) { setError(messageFor(cause)); setSubmitting(false); }
  }

  if (state === 'loading') return <main className="evaluation-page"><WorkspaceSkeleton variant="evaluations"/></main>;
  if (state === 'error') return <main className="evaluation-page"><div className="evaluation-page-state" role="alert"><h1>Evaluation setup unavailable</h1><p>{error}</p><button className="primary-button" onClick={() => void load()}>Try again</button><Link className="secondary-button" to={`/candidates/${id}`} replace onClick={backToCandidate}>Back to candidate</Link></div></main>;
  if (!candidate) return null;
  const usableProfiles = profiles.filter((profile) => profile.usable);
  const chosen = usableProfiles.find((profile) => profile.id === selected);
  return <main className="evaluation-page">
    <Link className="back-link" to={`/candidates/${candidate.id}`} replace onClick={backToCandidate}>← <span>Back to candidate</span></Link>
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> NEW EVALUATION</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · Candidate profile selected</p></div></header>
    <section className="evaluation-setup-card"><h2>Choose a saved role profile</h2><p>Evaluation uses this profile’s saved v4 category weights. New profiles must use the active GitHub + LeetCode categories.</p>
      <SessionDraftNotice status={draftStatus} persisted={persisted} onDiscard={() => clearDraft(usableProfiles[0]?.id ?? '')}/>
      {profiles.length === 0 ? <div className="evaluation-empty"><h3>No compatible role profiles</h3><p>Create or reconfigure a role profile with all six active v4 category weights before evaluating this candidate. Historical profiles are not changed automatically.</p></div> : <form onSubmit={(event) => void createEvaluation(event)}>
        <label className="evaluation-select-label">Role profile<select value={selected} onChange={(event) => { setSelected(event.target.value); setRoleEdited(true); }}><option value="">Select a valid saved profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.usable}>{profile.usable ? labelRole(profile.name) : `${profile.name} — invalid configuration`}</option>)}</select></label>
        {chosen && chosen.weights && <><div className="role-weight-preview"><h3>Saved category weights</h3><ul>{Object.entries(chosen.weights).map(([key, value]) => <li key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{value}%</strong></li>)}</ul><p>This profile’s role weights are stored as preliminary; confirm your organization has approved them before use.</p></div><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Calculating evaluation…' : 'Calculate evaluation'}</button></>}
        {error && <p className="evaluation-error" role="alert">{error}</p>}
      </form>}
      {profiles.some((profile) => !profile.usable) && <details className="invalid-role-details"><summary>Some saved profiles are unavailable</summary><p>Only profiles with a supported role name and exactly six active v4 category weights totaling 100 can be used. Historical profile weights are preserved and must be explicitly reconfigured; no category values are inferred.</p></details>}
    </section>
  </main>;
}
