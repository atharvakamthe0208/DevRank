import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { evaluationRequestSchema, persistedEvaluationSchema, roleProfileListResponseSchema, type Candidate, type RoleProfileOption } from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { parseCandidateApiResponse } from '../candidates/candidate-response-validation';
import './evaluation.css';

type PageState = 'loading' | 'ready' | 'error';
function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return error instanceof Error ? error.message : 'Could not load the evaluation setup. Check your connection and retry.';
}
function labelRole(name: string): string { return name.split('_').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' '); }

export function EvaluationCreatePage() {
  const { id = '' } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [profiles, setProfiles] = useState<RoleProfileOption[]>([]);
  const [selected, setSelected] = useState('');
  const [state, setState] = useState<PageState>('loading');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      setSelected((current) => roleProfiles.some((profile) => profile.id === current && profile.usable) ? current : roleProfiles.find((profile) => profile.usable)?.id ?? '');
      setState('ready');
    } catch (cause) {
      if (signal?.aborted) return;
      setError(messageFor(cause)); setState('error');
    }
  }, [id, session?.access_token]);

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
      navigate(`/evaluations/${saved.id}`);
    } catch (cause) { setError(messageFor(cause)); setSubmitting(false); }
  }

  if (state === 'loading') return <main className="evaluation-page"><div className="evaluation-page-state" role="status">Loading candidate and saved role profiles…</div></main>;
  if (state === 'error') return <main className="evaluation-page"><div className="evaluation-page-state" role="alert"><h1>Evaluation setup unavailable</h1><p>{error}</p><button className="primary-button" onClick={() => void load()}>Try again</button><Link className="secondary-button" to={`/candidates/${id}`}>Back to candidate</Link></div></main>;
  if (!candidate) return null;
  const usableProfiles = profiles.filter((profile) => profile.usable);
  const chosen = usableProfiles.find((profile) => profile.id === selected);
  return <main className="evaluation-page">
    <Link className="back-link" to={`/candidates/${candidate.id}`}>← <span>Back to candidate</span></Link>
    <header className="evaluation-header"><div><span className="eyebrow"><span className="eyebrow-line"/> NEW EVALUATION</span><h1>{candidate.name}</h1><p>{candidate.email || 'Email not provided'} · Candidate profile selected</p></div></header>
    <section className="evaluation-setup-card"><h2>Choose a saved role profile</h2><p>Evaluation uses this profile’s saved five-category weights. DevRank does not create or approve weights automatically.</p>
      {profiles.length === 0 ? <div className="evaluation-empty"><h3>No role profiles configured</h3><p>Create a role profile and have its five weights reviewed before evaluating this candidate. No default weights are assumed.</p></div> : <form onSubmit={(event) => void createEvaluation(event)}>
        <label className="evaluation-select-label">Role profile<select value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a valid saved profile</option>{profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.usable}>{profile.usable ? labelRole(profile.name) : `${profile.name} — invalid configuration`}</option>)}</select></label>
        {chosen && chosen.weights && <><div className="role-weight-preview"><h3>Saved category weights</h3><ul>{Object.entries(chosen.weights).map(([key, value]) => <li key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{value}%</strong></li>)}</ul><p>This profile’s role weights are stored as preliminary; confirm your organization has approved them before use.</p></div><button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Calculating evaluation…' : 'Calculate evaluation'}</button></>}
        {error && <p className="evaluation-error" role="alert">{error}</p>}
      </form>}
      {profiles.some((profile) => !profile.usable) && <details className="invalid-role-details"><summary>Some saved profiles are unavailable</summary><p>Only profiles with a supported role name and exactly five valid category weights totaling 100 can be used. Update these records in the database after weight approval.</p></details>}
    </section>
  </main>;
}
