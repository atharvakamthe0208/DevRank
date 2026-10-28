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
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import { isProfileVerified, normalizeProfileUsername, verifyCandidateProfile, type CandidatePlatform, type ProfileVerification } from './candidate-profile-verification';
import { createSubmissionLock } from './candidate-submission-lock';

const emptyValues: CandidateFormValues = { name: '', email: '', githubUsername: '', leetcodeUsername: '' };
function isCandidateDraft(value: unknown): value is CandidateFormValues {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return ['name', 'email', 'githubUsername', 'leetcodeUsername'].every((key) => typeof fields[key] === 'string')
    && (fields.name as string).length <= 120
    && (fields.email as string).length <= 254
    && (fields.githubUsername as string).length <= 100
    && (fields.leetcodeUsername as string).length <= 100;
}

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
  const { value: values, status: draftStatus, persisted, setValue: setValues, clear: clearDraft } = useSessionDraft(session?.user?.id, 'candidate:new', emptyValues, isCandidateDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [verification, setVerification] = useState<Record<CandidatePlatform, ProfileVerification>>({ github: { status: 'idle' }, leetcode: { status: 'idle' } });
  const verificationRequest = useRef<Record<CandidatePlatform, number>>({ github: 0, leetcode: 0 });
  const activeVerification = useRef<Record<CandidatePlatform, string | undefined>>({ github: undefined, leetcode: undefined });
  const submissionLock = useRef(createSubmissionLock());
  const allowNavigationRef = useRef(false);
  useUnsavedChangesBlocker(!created && !busy && Object.values(values).some((value) => value.trim().length > 0), 'Your candidate details are kept as a draft in this browser tab. Leave this page? You can discard the draft from the form.');

  function update(field: keyof CandidateFormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'githubUsername' || field === 'leetcodeUsername') {
      const platform: CandidatePlatform = field === 'githubUsername' ? 'github' : 'leetcode';
      verificationRequest.current[platform] += 1;
      activeVerification.current[platform] = undefined;
      setVerification((current) => ({ ...current, [platform]: { status: 'idle' } }));
    }
    setErrors((current) => { const next = { ...current }; delete next[field]; return next; });
    setMessage('');
  }

  async function verifyProfile(platform: CandidatePlatform) {
    const fieldName = platform === 'github' ? 'githubUsername' : 'leetcodeUsername';
    const username = normalizeProfileUsername(values[fieldName]);
    if (!username) { setVerification((current) => ({ ...current, [platform]: { status: 'idle' } })); return; }
    if (activeVerification.current[platform] === username) return;
    if (!session?.access_token) { setMessage('Your session expired. Sign in again to verify this profile.'); return; }
    const requestId = ++verificationRequest.current[platform];
    activeVerification.current[platform] = username;
    setVerification((current) => ({ ...current, [platform]: { status: 'checking', username } }));
    try {
      await verifyCandidateProfile(platform, username, session.access_token);
      if (verificationRequest.current[platform] === requestId) {
        setVerification((current) => ({ ...current, [platform]: { status: 'verified', username } }));
        setErrors((current) => { const next = { ...current }; delete next[fieldName]; return next; });
      }
    } catch (cause) {
      if (verificationRequest.current[platform] !== requestId) return;
      const code = cause instanceof ApiRequestError ? cause.code : undefined;
      setVerification((current) => ({ ...current, [platform]: {
        status: (platform === 'github' ? code === 'GITHUB_USER_NOT_FOUND' : code === 'LEETCODE_USER_NOT_FOUND') ? 'not-found'
          : code === 'VALIDATION_ERROR' || code === (platform === 'github' ? 'INVALID_GITHUB_PROFILE' : 'INVALID_LEETCODE_PROFILE') ? 'invalid'
            : 'retryable-error',
        username,
      } }));
    } finally {
      if (verificationRequest.current[platform] === requestId) activeVerification.current[platform] = undefined;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submissionLock.current.acquire()) return;
    const result = validateCandidateForm(values);
    const profileErrors = { ...result.errors };
    if (!isProfileVerified(values.githubUsername, verification.github)) profileErrors.githubUsername = 'Verify this GitHub account before adding the candidate.';
    if (!isProfileVerified(values.leetcodeUsername, verification.leetcode)) profileErrors.leetcodeUsername = 'Verify this LeetCode profile before adding the candidate.';
    setErrors(profileErrors);
    setMessage('');
    if (!result.success || Object.keys(profileErrors).length) { submissionLock.current.release(); return; }
    if (!session?.access_token) { submissionLock.current.release(); setMessage('Your session expired. Sign in again to add a candidate.'); await supabase?.auth.signOut({ scope: 'local' }); return; }
    setBusy(true);
    try {
      const created = await apiRequest<unknown>('/candidates', { method: 'POST', body: JSON.stringify(result.data) }, session.access_token);
      const parsed = parseCandidateApiResponse(created);
      if (!parsed) { setMessage('The server response could not be verified. Check the candidate list before trying again.'); return; }
      clearDraft(emptyValues);
      setCreated(true);
      allowNavigationRef.current = true;
      navigate(listReturn?.path ?? '/dashboard/candidates', { replace: true, state: { notice: 'Candidate added successfully.', candidateListSearch: listReturn?.search ?? '' } });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        setMessage('Your session expired. Sign in again to add a candidate.');
        await supabase?.auth.signOut({ scope: 'local' });
      } else if (cause instanceof ApiRequestError && cause.status === 403) setMessage('Your recruiter access is not approved to add candidates. Contact an administrator.');
      else if (cause instanceof ApiRequestError && cause.code?.startsWith('GITHUB_')) {
        const status = cause.code === 'GITHUB_USER_NOT_FOUND' ? 'not-found' : cause.code === 'INVALID_GITHUB_PROFILE' ? 'invalid' : 'retryable-error';
        setVerification((current) => ({ ...current, github: { status, username: normalizeProfileUsername(values.githubUsername) } }));
        setMessage('GitHub verification needs attention. Review the username status and try again.');
      } else if (cause instanceof ApiRequestError && cause.code?.startsWith('LEETCODE_')) {
        const status = cause.code === 'LEETCODE_USER_NOT_FOUND' ? 'not-found' : cause.code === 'INVALID_LEETCODE_PROFILE' ? 'invalid' : 'retryable-error';
        setVerification((current) => ({ ...current, leetcode: { status, username: normalizeProfileUsername(values.leetcodeUsername) } }));
        setMessage('LeetCode verification needs attention. Review the username status and try again.');
      }
      else if (cause instanceof ApiRequestError && cause.status === 400) {
        const serverErrors = inputErrorDetails(cause.details);
        setErrors(serverErrors);
        setMessage(Object.keys(serverErrors).length ? 'Check the highlighted fields and try again.' : cause.message);
      } else if (cause instanceof ApiRequestError && cause.status === 409) setMessage('A conflicting candidate record already exists. Review the candidate list and try again.');
      else if (cause instanceof ApiRequestError) setMessage(cause.message);
      else setMessage(cause instanceof Error ? cause.message : 'Could not reach the candidate service. Check your connection and try again.');
    } finally { submissionLock.current.release(); setBusy(false); }
  }

  function discardDraft() {
    clearDraft(emptyValues);
    setErrors({});
    setMessage('');
  }

  function field(id: keyof CandidateFormValues, label: ReactNode, type = 'text', required = false, hint?: string) {
    return <label className="candidate-form-field" htmlFor={id}><span>{label}{required && <b aria-hidden="true"> *</b>}</span><input id={id} name={id} type={type} value={values[id]} onChange={(event) => update(id, event.target.value)} required={required} maxLength={id === 'name' ? 120 : id === 'email' ? 254 : 100} autoComplete={id === 'email' ? 'email' : 'off'} aria-invalid={Boolean(errors[id])} aria-describedby={errors[id] ? `${id}-error` : undefined} placeholder={hint}/>{errors[id] && <small id={`${id}-error`} className="auth-field-error" role="alert">{errors[id]}</small>}</label>;
  }

  function platformField(platform: CandidatePlatform, label: ReactNode, hint: string) {
    const id = platform === 'github' ? 'githubUsername' : 'leetcodeUsername';
    const state = verification[platform];
    const username = normalizeProfileUsername(values[id]);
    const stateIsCurrent = 'username' in state && state.username === username;
    const status = !username ? 'Enter a username to verify' : stateIsCurrent && state.status === 'checking'
      ? `Checking ${platform === 'github' ? 'GitHub account' : 'LeetCode profile'}…`
      : stateIsCurrent && state.status === 'verified' ? 'Account verified'
        : stateIsCurrent && state.status === 'not-found' ? `${platform === 'github' ? 'GitHub user' : 'LeetCode user'} not found. Check the username and try again.`
          : stateIsCurrent && state.status === 'invalid' ? 'Enter a valid username to verify.'
          : stateIsCurrent && state.status === 'retryable-error' ? 'Could not verify right now. Try again.'
            : 'Enter a username to verify';
    const statusClass = stateIsCurrent ? state.status : 'idle';
    const invalid = stateIsCurrent && (state.status === 'not-found' || state.status === 'invalid');
    return <div className="candidate-form-field candidate-platform-verification">
      <label htmlFor={id}><span>{label}</span></label>
      <input id={id} name={id} type="text" value={values[id]} onChange={(event) => update(id, event.target.value)} onBlur={() => { if (values[id].trim()) void verifyProfile(platform); }} maxLength={100} autoComplete="off" aria-invalid={invalid} aria-describedby={`${id}-verification-status`} placeholder={hint}/>
      <div className={`candidate-platform-verification-status is-${statusClass}`} id={`${id}-verification-status`} role={invalid || (stateIsCurrent && state.status === 'retryable-error') ? 'alert' : 'status'}>
        <span>{status}</span>
        <button type="button" aria-label={`Verify ${platform === 'github' ? 'GitHub' : 'LeetCode'} username`} onClick={() => void verifyProfile(platform)} disabled={busy || !username || (stateIsCurrent && (state.status === 'checking' || state.status === 'verified'))}>
          {stateIsCurrent && state.status === 'checking' ? 'Checking…' : stateIsCurrent && state.status === 'verified' ? 'Verified' : 'Verify'}
        </button>
      </div>
      {errors[id] && <small className="auth-field-error" role="alert">{errors[id]}</small>}
    </div>;
  }

  const navState = location.state as { candidateListReturn?: unknown } | null;
  const listReturn = safeCandidateListReturn(navState?.candidateListReturn);
  const returnPath = listReturn?.path ?? '/dashboard/candidates';
  const backState = { candidateListSearch: listReturn?.search ?? '', candidateListRestoreScroll: listReturn?.scrollY };
  function backToList(event: MouseEvent<HTMLAnchorElement>) {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && listReturn) { event.preventDefault(); navigate(-1); }
  }
  return <div className="candidate-management-page"><Link className="back-link" to={returnPath} state={backState} replace onClick={backToList}>← <span>Back to candidates</span></Link><section className="candidate-form-card"><div className="candidate-form-heading"><span className="eyebrow"><span className="eyebrow-line"/> CANDIDATE MANAGEMENT</span><h1>Add candidate</h1><p className="page-subtitle">Add a candidate’s contact information and developer profile usernames.</p></div><SessionDraftNotice status={draftStatus} persisted={persisted} onDiscard={discardDraft}/><form className="candidate-form" onSubmit={submit} noValidate>
      {field('name', 'Full name', 'text', true, 'Candidate name')}
      {field('email', 'Email address', 'email', false, 'name@example.com')}
      <div className="candidate-form-divider"><span>Developer profiles</span><small>Optional · enter usernames, not profile URLs</small></div>
      {platformField('github', <span className="platform-field-label"><PlatformLogo platform="github"/>GitHub username</span>, 'e.g. octocat')}
      {platformField('leetcode', <span className="platform-field-label"><PlatformLogo platform="leetcode"/>LeetCode username</span>, 'e.g. leetcode_user')}
      {message && <p className="form-feedback form-feedback-error candidate-form-message" role="alert">{message}</p>}
      <div className="candidate-form-actions"><Link className="secondary-button" to={returnPath} state={backState} replace onClick={backToList}>Cancel</Link><button className="primary-button" type="submit" disabled={busy || !isProfileVerified(values.githubUsername, verification.github) || !isProfileVerified(values.leetcodeUsername, verification.leetcode)}>{busy ? 'Adding candidate…' : 'Add candidate'} <span>→</span></button></div>
    </form></section></div>;
}
