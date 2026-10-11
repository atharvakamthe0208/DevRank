import { useState, type FormEvent } from 'react';
import {
  candidatePlatformResponseSchema,
  githubSyncResponseSchema,
  type Candidate,
  type CandidatePlatformResponse,
  type GitHubSyncResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import { validatePlatformForm, type PlatformFormFields } from './candidate-platform-form';
import './candidate-platform-data.css';

type PlatformName = 'leetcode' | 'hackerrank';
type SubmitState = { status: 'idle' | 'saving' } | { status: 'saved'; result: CandidatePlatformResponse } | { status: 'error'; message: string };
type SyncState = { status: 'idle' | 'syncing' } | { status: 'synced'; result: GitHubSyncResponse } | { status: 'error'; message: string };

const statisticFields: Record<PlatformName, Array<{ name: string; label: string; step: string }>> = {
  leetcode: [
    { name: 'problemsSolved', label: 'Problems solved', step: '1' },
    { name: 'easySolved', label: 'Easy solved', step: '1' },
    { name: 'mediumSolved', label: 'Medium solved', step: '1' },
    { name: 'hardSolved', label: 'Hard solved', step: '1' },
  ],
  hackerrank: [
    { name: 'points', label: 'Points', step: 'any' },
    { name: 'badges', label: 'Badges', step: '1' },
    { name: 'certificates', label: 'Certificates', step: '1' },
  ],
};

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'The request could not be completed. Check your connection and try again.';
}

function initialForm(handle: string | undefined): PlatformFormFields {
  return { handle: handle ?? '', availability: 'not_provided', statistics: {} };
}

function sourceStatus(state: SubmitState): { label: string; className: string } {
  if (state.status === 'saving') return { label: 'Saving…', className: 'is-pending' };
  if (state.status === 'error') return { label: 'Needs attention', className: 'is-error' };
  if (state.status === 'saved') {
    const availability = state.result.availability;
    return {
      label: availability.replace('_', ' '),
      className: availability === 'available' ? 'is-available' : availability === 'unavailable' ? 'is-unavailable' : 'is-idle',
    };
  }
  return { label: 'Status not loaded', className: 'is-idle' };
}

export function CandidatePlatformDataPanel({ candidate }: { candidate: Candidate }) {
  const { session } = useAuth();
  const [githubProfile, setGithubProfile] = useState(candidate.githubUsername ?? '');
  const [githubState, setGithubState] = useState<SyncState>({ status: 'idle' });
  const [forms, setForms] = useState<Record<PlatformName, PlatformFormFields>>({
    leetcode: initialForm(candidate.leetcodeUsername),
    hackerrank: initialForm(candidate.hackerrankUsername),
  });
  const [submitStates, setSubmitStates] = useState<Record<PlatformName, SubmitState>>({
    leetcode: { status: 'idle' }, hackerrank: { status: 'idle' },
  });
  const [validationErrors, setValidationErrors] = useState<Record<PlatformName, Record<string, string>>>({
    leetcode: {}, hackerrank: {},
  });

  async function syncGitHub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = githubProfile.trim();
    if (!profile) {
      setGithubState({ status: 'error', message: 'Enter a GitHub username or public profile URL.' });
      return;
    }
    if (!session?.access_token) {
      setGithubState({ status: 'error', message: 'Your secure session expired. Sign in again to continue.' });
      return;
    }
    setGithubState({ status: 'syncing' });
    try {
      const response = await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data/github-sync`, {
        method: 'POST', body: JSON.stringify({ profile }),
      }, session.access_token);
      const result = githubSyncResponseSchema.parse(response);
      setGithubState({ status: 'synced', result });
    } catch (error) {
      setGithubState({ status: 'error', message: requestErrorMessage(error) });
    }
  }

  async function submitPlatform(platform: PlatformName, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validatePlatformForm(platform, forms[platform]);
    if (!result.success) {
      setValidationErrors((current) => ({ ...current, [platform]: result.errors }));
      setSubmitStates((current) => ({ ...current, [platform]: { status: 'idle' } }));
      return;
    }
    if (!session?.access_token) {
      setSubmitStates((current) => ({ ...current, [platform]: { status: 'error', message: 'Your secure session expired. Sign in again to continue.' } }));
      return;
    }
    setValidationErrors((current) => ({ ...current, [platform]: {} }));
    setSubmitStates((current) => ({ ...current, [platform]: { status: 'saving' } }));
    try {
      const response = await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data`, {
        method: 'POST', body: JSON.stringify(result.data),
      }, session.access_token);
      const saved = candidatePlatformResponseSchema.parse(response);
      setSubmitStates((current) => ({ ...current, [platform]: { status: 'saved', result: saved } }));
    } catch (error) {
      setSubmitStates((current) => ({ ...current, [platform]: { status: 'error', message: requestErrorMessage(error) } }));
    }
  }

  function updateForm(platform: PlatformName, patch: Partial<PlatformFormFields>) {
    setForms((current) => ({ ...current, [platform]: { ...current[platform], ...patch } }));
    setValidationErrors((current) => ({ ...current, [platform]: {} }));
    setSubmitStates((current) => ({ ...current, [platform]: { status: 'idle' } }));
  }

  return <section className="detail-section platform-data-section" aria-labelledby="platform-data-heading">
    <div className="section-heading"><div><h2 id="platform-data-heading">Platform data</h2><p>Sync public GitHub data or enter candidate-reported statistics. Submissions are saved to this candidate.</p></div></div>

    <article className="platform-data-card github-sync-card">
      <div className="platform-data-heading"><span className="platform-mark github-mark">GH</span><div><h3>GitHub</h3><p>Public profile and repository summary</p></div><span className={`source-status ${githubState.status === 'synced' ? 'is-available' : githubState.status === 'syncing' ? 'is-pending' : githubState.status === 'error' ? 'is-error' : 'is-idle'}`} role="status">{githubState.status === 'synced' ? 'Synced' : githubState.status === 'syncing' ? 'Syncing…' : githubState.status === 'error' ? 'Needs attention' : 'Ready to sync'}</span></div>
      <form className="platform-data-form github-sync-form" onSubmit={syncGitHub}>
        <label>GitHub username or profile URL<input value={githubProfile} onChange={(event) => { setGithubProfile(event.target.value); setGithubState({ status: 'idle' }); }} placeholder="octocat or https://github.com/octocat" autoComplete="off" /></label>
        <button className="primary-button" type="submit" disabled={githubState.status === 'syncing'}>{githubState.status === 'syncing' ? 'Syncing…' : 'Sync GitHub'}</button>
      </form>
      {githubState.status === 'error' && <p className="platform-feedback is-error" role="alert">{githubState.message}</p>}
      {githubState.status === 'synced' && <div className="github-sync-result" role="status"><p>Saved public snapshot for <strong>@{githubState.result.profile.username}</strong>: {githubState.result.profile.publicRepositoryCount} public repositories, {githubState.result.profile.followers} followers, {githubState.result.profile.following} following.</p><small>Updated {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(githubState.result.syncedAt))}. No score is calculated from this data.</small>{githubState.result.profile.repositories.length > 0 && <ul>{githubState.result.profile.repositories.slice(0, 3).map((repository) => <li key={repository.id}><a href={repository.url} target="_blank" rel="noreferrer">{repository.name}</a><span>{repository.stars} stars{repository.primaryLanguage ? ` · ${repository.primaryLanguage}` : ''}</span></li>)}</ul>}</div>}
    </article>

    {(['leetcode', 'hackerrank'] as const).map((platform) => {
      const label = platform === 'leetcode' ? 'LeetCode' : 'HackerRank';
      const mark = platform === 'leetcode' ? 'LC' : 'HR';
      const current = submitStates[platform];
      const status = sourceStatus(current);
      const errorId = `${platform}-form-error`;
      return <article className={`platform-data-card platform-data-card-${platform}`} key={platform}>
        <div className="platform-data-heading"><span className={`platform-mark ${platform === 'leetcode' ? 'leetcode-mark' : 'hackerrank-mark'}`}>{mark}</span><div><h3>{label}</h3><p>Candidate-reported profile and statistics</p></div><span className={`source-status ${status.className}`} role="status">{status.label}</span></div>
        <form className="platform-data-form" onSubmit={(event) => void submitPlatform(platform, event)} aria-describedby={current.status === 'error' ? errorId : undefined}>
          <label>Profile handle<input required value={forms[platform].handle} onChange={(event) => updateForm(platform, { handle: event.target.value })} placeholder={`${platform}_username`} autoComplete="off" /></label>
          <label>Source availability<select value={forms[platform].availability} onChange={(event) => updateForm(platform, { availability: event.target.value as PlatformFormFields['availability'] })}><option value="available">Available</option><option value="unavailable">Unavailable</option><option value="not_provided">Not provided</option></select></label>
          {forms[platform].availability === 'available' && <div className="platform-stat-grid">{statisticFields[platform].map((field) => <label key={field.name}>{field.label}<input type="number" min="0" step={field.step} value={forms[platform].statistics[field.name] ?? ''} onChange={(event) => updateForm(platform, { statistics: { ...forms[platform].statistics, [field.name]: event.target.value } })} aria-invalid={Boolean(validationErrors[platform][`statistics.${field.name}`])} />{validationErrors[platform][`statistics.${field.name}`] && <small className="field-error">{validationErrors[platform][`statistics.${field.name}`]}</small>}</label>)}</div>}
          {validationErrors[platform].handle && <small className="field-error">{validationErrors[platform].handle}</small>}
          {validationErrors[platform].statistics && <small className="field-error">{validationErrors[platform].statistics}</small>}
          <div className="platform-submit-row"><p>Data is stored as candidate-provided and is not independently verified.</p><button className="primary-button" type="submit" disabled={current.status === 'saving'}>{current.status === 'saving' ? 'Saving…' : `Save ${label} data`}</button></div>
          {current.status === 'error' && <p className="platform-feedback is-error" id={errorId} role="alert">{current.message}</p>}
          {current.status === 'saved' && <p className="platform-feedback is-success" role="status">{label} status saved as <strong>{current.result.availability.replace('_', ' ')}</strong> at {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(current.result.submittedAt))}.</p>}
        </form>
      </article>;
    })}
  </section>;
}
