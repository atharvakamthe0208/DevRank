import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useUnsavedChangesBlocker } from '../../app/useUnsavedChangesBlocker';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../../lib/supabase/client';
import { validateCandidateForm, type CandidateFormValues } from './candidate-form-validation';
import { parseCandidateApiResponse } from './candidate-response-validation';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { safeCandidateListReturn } from './candidate-list-navigation';

const emptyValues: CandidateFormValues = { name: '', email: '', githubUsername: '', leetcodeUsername: '' };

function inputErrorDetails(details: unknown): Record<string, string> {
  if (!Array.isArray(details)) return {};
  const errors: Record<string, string> = {};
  for (const item of details) {
    if (typeof item === 'object' && item !== null && 'path' in item && 'message' in item && typeof item.path === 'string' && typeof item.message === 'string') errors[item.path] ??= item.message;
  }
  return errors;
}

export function AddCandidatePage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [values, setValues] = useState(emptyValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const allowNavigationRef = useRef(false);
  useUnsavedChangesBlocker(!created && !busy && Object.values(values).some((value) => value.trim().length > 0), 'You have unsaved candidate details. Leave this page and discard them?', allowNavigationRef);

  function update(field: keyof CandidateFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const result = validateCandidateForm(values);
    setErrors(result.errors);
    setMessage('');
    if (!result.success) return;
    if (!session?.access_token) { setMessage('Your session expired. Sign in again to add a candidate.'); await supabase?.auth.signOut({ scope: 'local' }); return; }
    setBusy(true);
    try {
      const created = await apiRequest<unknown>('/candidates', { method: 'POST', body: JSON.stringify(result.data) }, session.access_token);
      const parsed = parseCandidateApiResponse(created);
      if (!parsed) { setMessage('The server response could not be verified. Check the candidate list before trying again.'); return; }
      setCreated(true);
      allowNavigationRef.current = true;
      navigate(listReturn?.path ?? '/dashboard/candidates', { replace: true, state: { notice: 'Candidate added successfully.', candidateListSearch: listReturn?.search ?? '' } });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setMessage('Your session expired. Sign in again to add a candidate.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setMessage('Your recruiter access is not approved to add candidates. Contact an administrator.');
      else if (cause instanceof ApiRequestError && cause.status === 400) {
        const serverErrors = inputErrorDetails(cause.details);
        setErrors(serverErrors);
        setMessage(Object.keys(serverErrors).length ? 'Check the highlighted fields and try again.' : cause.message);
      } else if (cause instanceof ApiRequestError && cause.status === 409) setMessage('A conflicting candidate record already exists. Review the candidate list and try again.');
      else if (cause instanceof ApiRequestError) setMessage(cause.message);
      else setMessage(cause instanceof Error ? cause.message : 'Could not reach the candidate service. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  function field(id: keyof CandidateFormValues, label: ReactNode, type = 'text', required = false, hint?: string) {
    return <label className="candidate-form-field" htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><input id={id} name={id} type={type} value={values[id]} onChange={(event) => update(id, event.target.value)} required={required} maxLength={id === 'name' ? 120 : id === 'email' ? 254 : 100} autoComplete={id === 'email' ? 'email' : 'off'} aria-invalid={Boolean(errors[id])} aria-describedby={errors[id] ? `${id}-error` : undefined} placeholder={hint}/>{errors[id] && <small id={`${id}-error`} className="auth-field-error" role="alert">{errors[id]}</small>}</label>;
  }

  const navState = location.state as { candidateListReturn?: unknown } | null;
  const listReturn = safeCandidateListReturn(navState?.candidateListReturn);
  const returnPath = listReturn?.path ?? '/dashboard/candidates';
  const backState = { candidateListSearch: listReturn?.search ?? '', candidateListRestoreScroll: listReturn?.scrollY };
  function backToList(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && listReturn) { event.preventDefault(); navigate(-1); }
  }
  return <div className="candidate-management-page"><Link className="back-link" to={returnPath} state={backState} replace onClick={backToList}>← <span>Back to candidates</span></Link><section className="candidate-form-card"><div className="candidate-form-heading"><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE MANAGEMENT</span><h1>Add candidate</h1><p className="page-subtitle">Add a candidate’s contact information and developer profile usernames.</p></div><form className="candidate-form" onSubmit={submit} noValidate>
      {field('name', 'Full name', 'text', true, 'Candidate name')}
      {field('email', 'Email address', 'email', false, 'name@example.com')}
      <div className="candidate-form-divider"><span>Developer profiles</span></div>
      {field('githubUsername', <span className="platform-field-label"><PlatformLogo platform="github"/>GitHub username</span>, 'text', false, 'e.g. octocat')}
      {field('leetcodeUsername', <span className="platform-field-label"><PlatformLogo platform="leetcode"/>LeetCode username</span>, 'text', false, 'e.g. leetcode_user')}
      {message && <p className="form-feedback form-feedback-error candidate-form-message" role="alert">{message}</p>}
      <div className="candidate-form-actions"><Link className="secondary-button" to={returnPath} state={backState} replace onClick={backToList}>Cancel</Link><button className="primary-button" type="submit" disabled={busy}>{busy ? 'Adding candidate…' : 'Add candidate'} <span>→</span></button></div>
    </form></section></div>;
}
