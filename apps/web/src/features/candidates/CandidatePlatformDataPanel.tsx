import { useEffect, useState, type FormEvent } from 'react';
import {
  candidatePlatformDataResponseSchema,
  githubSyncResponseSchema,
  leetCodeSyncResponseSchema,
  type Candidate,
  type CandidatePlatformDataResponse,
  type GitHubSyncResponse,
  type LeetCodeSyncResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { normalizePlatformProfile, platformSyncCapabilities, type CandidateCodingPlatform } from './candidate-platform-form';
import { parseCandidateApiResponse } from './candidate-response-validation';
import { ProposedRubricPanel } from './ProposedRubricPanel';
import { useAuth } from '../auth/AuthProvider';
import './candidate-platform-data.css';

type PlatformName = CandidateCodingPlatform;
type ProfileSaveState = { status: 'idle' | 'saving' } | { status: 'saved' } | { status: 'error'; message: string };
type SyncState = { status: 'idle' | 'loading' | 'syncing' } | { status: 'synced'; result: GitHubSyncResponse } | { status: 'error'; message: string; retry: 'load' | 'sync' };
type LeetCodeState = { status: 'idle' | 'syncing' } | { status: 'synced'; result: LeetCodeSyncResponse } | { status: 'error'; message: string };

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'The request could not be completed. Check your connection and try again.';
}

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function CandidatePlatformDataPanel({ candidate, onCandidateUpdated }: { candidate: Candidate; onCandidateUpdated?: (candidate: Candidate) => void }) {
  const { session } = useAuth();
  const [githubProfile, setGithubProfile] = useState(candidate.githubUsername ?? '');
  const [githubState, setGithubState] = useState<SyncState>({ status: 'loading' });
  const [profiles, setProfiles] = useState<Record<PlatformName, string>>({ leetcode: candidate.leetcodeUsername ?? '', hackerrank: candidate.hackerrankUsername ?? '' });
  const [profileSave, setProfileSave] = useState<Record<PlatformName, ProfileSaveState>>({ leetcode: { status: 'idle' }, hackerrank: { status: 'idle' } });
  const [saved, setSaved] = useState<CandidatePlatformDataResponse['items']>([]);
  const [leetcodeState, setLeetCodeState] = useState<LeetCodeState>({ status: 'idle' });

  async function loadSavedData() {
    if (!session?.access_token) { setGithubState({ status: 'error', message: 'Your secure session expired. Sign in again to load saved platform data.', retry: 'load' }); return; }
    setGithubState({ status: 'loading' });
    try {
      const response = candidatePlatformDataResponseSchema.parse(await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data`, {}, session.access_token));
      setSaved(response.items);
      const github = response.items.find((item) => 'source' in item && item.source === 'github');
      if (github && 'profile' in github) {
        setGithubProfile(github.profile.username);
        setGithubState({ status: 'synced', result: githubSyncResponseSchema.parse(github) });
      } else setGithubState({ status: 'idle' });
      const leetcode = response.items.find((item) => 'platform' in item && item.platform === 'leetcode' && item.provenance === 'alfa_leetcode_api');
      if (leetcode && 'syncedAt' in leetcode) {
        const result = leetCodeSyncResponseSchema.parse(leetcode);
        setLeetCodeState({ status: 'synced', result });
        setProfiles((state) => ({ ...state, leetcode: result.handle }));
      } else setLeetCodeState({ status: 'idle' });
    } catch (error) {
      setGithubState({ status: 'error', message: requestErrorMessage(error), retry: 'load' });
    }
  }

  useEffect(() => { void loadSavedData(); }, [candidate.id, session?.access_token]);

  async function syncGitHub(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const profile = githubProfile.trim();
    if (!profile) { setGithubState({ status: 'error', message: 'Enter a GitHub username or public profile URL.', retry: 'sync' }); return; }
    if (!session?.access_token) { setGithubState({ status: 'error', message: 'Your secure session expired. Sign in again to continue.', retry: 'sync' }); return; }
    setGithubState({ status: 'syncing' });
    try {
      const result = githubSyncResponseSchema.parse(await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data/github-sync`, {
        method: 'POST', body: JSON.stringify({ profile }),
      }, session.access_token));
      setGithubState({ status: 'synced', result });
      setSaved((current) => [result, ...current.filter((item) => !('source' in item && item.source === 'github'))]);
      setGithubProfile(result.profile.username);
    } catch (error) { setGithubState({ status: 'error', message: requestErrorMessage(error), retry: 'sync' }); }
  }

  async function syncLeetCode() {
    const profile = profiles.leetcode.trim();
    if (!profile) { setLeetCodeState({ status: 'error', message: 'Enter a LeetCode username or HTTPS profile URL.' }); return; }
    if (!session?.access_token) { setLeetCodeState({ status: 'error', message: 'Your secure session expired. Sign in again to continue.' }); return; }
    setLeetCodeState({ status: 'syncing' });
    try {
      const result = leetCodeSyncResponseSchema.parse(await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data/leetcode-sync`, {
        method: 'POST', body: JSON.stringify({ profile }),
      }, session.access_token));
      setLeetCodeState({ status: 'synced', result });
      setProfiles((state) => ({ ...state, leetcode: result.handle }));
      setSaved((current) => [result, ...current.filter((item) => !('platform' in item && item.platform === 'leetcode' && item.provenance === 'alfa_leetcode_api'))]);
    } catch (error) { setLeetCodeState({ status: 'error', message: requestErrorMessage(error) }); }
  }

  async function saveProfile(platform: PlatformName, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizePlatformProfile(platform, profiles[platform]);
    if (!normalized.success) { setProfileSave((state) => ({ ...state, [platform]: { status: 'error', message: normalized.message } })); return; }
    if (!session?.access_token) { setProfileSave((state) => ({ ...state, [platform]: { status: 'error', message: 'Your secure session expired. Sign in again to continue.' } })); return; }
    setProfileSave((state) => ({ ...state, [platform]: { status: 'saving' } }));
    try {
      const field = platform === 'leetcode' ? 'leetcodeUsername' : 'hackerrankUsername';
      const response = await apiRequest<unknown>(`/candidates/${candidate.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: normalized.handle }) }, session.access_token);
      const updated = parseCandidateApiResponse(response);
      if (!updated) throw new Error('The profile link was saved, but the candidate response could not be validated. Reload this page.');
      setProfiles((state) => ({ ...state, [platform]: normalized.handle }));
      onCandidateUpdated?.(updated);
      setProfileSave((state) => ({ ...state, [platform]: { status: 'saved' } }));
    } catch (error) {
      setProfileSave((state) => ({ ...state, [platform]: { status: 'error', message: requestErrorMessage(error) } }));
    }
  }

  const latest = (platform: PlatformName) => saved.find((item) => 'platform' in item && item.platform === platform) as Extract<CandidatePlatformDataResponse['items'][number], { platform: PlatformName }> | undefined;
  const githubInsights = githubState.status === 'synced' ? githubState.result.profile.insights : undefined;
  return <section className="detail-section platform-data-section" aria-labelledby="platform-data-heading">
    <div className="section-heading"><div><h2 id="platform-data-heading">Platform data</h2><p>GitHub syncs through its public API. Coding profile links are saved to the candidate record; unsupported stats are never fabricated.</p></div></div>
    <article className="platform-data-card github-sync-card">
      <div className="platform-data-heading"><span className="platform-mark github-mark">GH</span><div><h3>GitHub</h3><p>Public profile and repository summary</p></div><span className={`source-status ${githubState.status === 'synced' ? 'is-available' : githubState.status === 'syncing' || githubState.status === 'loading' ? 'is-pending' : githubState.status === 'error' ? 'is-error' : 'is-idle'}`} role="status">{githubState.status === 'synced' ? 'Synced' : githubState.status === 'syncing' ? 'Syncing…' : githubState.status === 'loading' ? 'Loading saved data…' : githubState.status === 'error' ? 'Needs attention' : 'Ready to sync'}</span></div>
      <form className="platform-data-form github-sync-form" onSubmit={syncGitHub}><label>GitHub username or profile URL<input value={githubProfile} onChange={(event) => setGithubProfile(event.target.value)} placeholder="octocat or https://github.com/octocat" autoComplete="off" /></label><button className="primary-button" type="submit" disabled={githubState.status === 'syncing'}>{githubState.status === 'syncing' ? 'Syncing…' : 'Sync GitHub'}</button></form>
      {githubState.status === 'error' && <div className="platform-feedback is-error" role="alert"><p>{githubState.message}</p><button type="button" className="text-button" onClick={() => void (githubState.retry === 'sync' ? syncGitHub() : loadSavedData())}>Try again</button></div>}
      {githubState.status === 'synced' && <div className="github-sync-result" role="status"><p>Saved public snapshot for <strong>@{githubState.result.profile.username}</strong>: {githubState.result.profile.publicRepositoryCount} public repositories, {githubState.result.profile.followers} followers, {githubState.result.profile.following} following.</p><small>Updated {when(githubState.result.syncedAt)}. {githubState.result.profile.repositoriesTruncated ? `Showing ${githubState.result.profile.repositoriesReturned} of the available repositories.` : 'No score is calculated from this data.'}</small>{githubState.result.profile.repositories.length > 0 && <ul>{githubState.result.profile.repositories.slice(0, 3).map((repository) => <li key={repository.id}><a href={repository.url} target="_blank" rel="noreferrer">{repository.name}</a><span>{repository.stars} stars{repository.primaryLanguage ? ` · ${repository.primaryLanguage}` : ''}</span></li>)}</ul>}
      </div>}
    </article>
    <ProposedRubricPanel insights={githubInsights} snapshotState={githubState.status === 'synced' ? 'synced' : githubState.status === 'loading' ? 'loading' : githubState.status === 'error' ? 'error' : 'idle'} />
    {(['leetcode', 'hackerrank'] as const).map((platform) => {
      const label = platform === 'leetcode' ? 'LeetCode' : 'HackerRank';
      const current = profileSave[platform];
      const previous = latest(platform);
      const capability = platformSyncCapabilities[platform];
      return <article className={`platform-data-card platform-data-card-${platform}`} key={platform}>
        <div className="platform-data-heading"><span className={`platform-mark ${platform === 'leetcode' ? 'leetcode-mark' : 'hackerrank-mark'}`}>{platform === 'leetcode' ? 'LC' : 'HR'}</span><div><h3>{label}</h3><p>Profile link and any previously saved candidate-provided summary</p></div><span className={`source-status ${previous?.availability === 'available' ? 'is-available' : previous ? 'is-unavailable' : 'is-idle'}`} role="status">{previous ? previous.availability.replace('_', ' ') : 'No stats saved'}</span></div>
        <form className="platform-data-form" onSubmit={(event) => void saveProfile(platform, event)}>
          <label>{label} username or profile URL<input value={profiles[platform]} onChange={(event) => { setProfiles((state) => ({ ...state, [platform]: event.target.value })); setProfileSave((state) => ({ ...state, [platform]: { status: 'idle' } })); }} placeholder={platform === 'leetcode' ? 'username or https://leetcode.com/u/username' : 'username or https://hackerrank.com/profile/username'} autoComplete="off" /></label>
          <div className="platform-submit-row"><p>{platform === 'leetcode' ? capability.explanation : 'Profile link metadata is saved separately from candidate-reported statistics.'}</p><button className="primary-button" type="submit" disabled={current.status === 'saving'}>{current.status === 'saving' ? 'Saving…' : `Save ${label} profile`}</button></div>
          {platform === 'leetcode'
            ? <button type="button" className="secondary-button" onClick={() => void syncLeetCode()} disabled={leetcodeState.status === 'syncing'}>{leetcodeState.status === 'syncing' ? 'Syncing…' : 'Sync LeetCode'}</button>
            : <><p className="platform-feedback is-unavailable">{capability.explanation}</p><button type="button" className="text-button" disabled title={capability.explanation}>Sync unavailable</button></>}
          {platform === 'leetcode' && leetcodeState.status === 'error' && <div className="platform-feedback is-error" role="alert"><p>{leetcodeState.message}</p><button type="button" className="text-button" onClick={() => void syncLeetCode()}>Try again</button></div>}
          {platform === 'leetcode' && leetcodeState.status === 'synced' && <div className="saved-platform-data" role="status"><p>Synced {when(leetcodeState.result.syncedAt)} via {leetcodeState.result.provider}. Public profile data does not independently verify identity and is not used as an evaluation score.</p></div>}
          {current.status === 'error' && <p className="platform-feedback is-error" role="alert">{current.message}</p>}
          {current.status === 'saved' && <p className="platform-feedback is-success" role="status">{label} profile link saved to this candidate.</p>}
          {previous && <div className="saved-platform-data"><p>Last saved {when('syncedAt' in previous ? previous.syncedAt : previous.submittedAt)} · {previous.provenance.replaceAll('_', ' ')}</p>{previous.statistics && <ul>{Object.entries(previous.statistics).map(([name, value]) => <li key={name}><span>{name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><strong>{value}</strong></li>)}</ul>}</div>}
        </form>
      </article>;
    })}
  </section>;
}
