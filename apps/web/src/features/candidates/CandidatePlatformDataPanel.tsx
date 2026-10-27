import { useEffect, useState, type FormEvent } from 'react';
import {
  candidatePlatformDataResponseSchema,
  githubSyncResponseSchema,
  leetCodeSyncResponseSchema,
  type Candidate,
  type CandidatePlatformDataResponse,
  type CandidatePlatformResponse,
  type GitHubSyncResponse,
  type LeetCodeSyncResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { platformSyncCapabilities } from './candidate-platform-form';
import { LeetCodeProfileSyncError, saveAndSyncLeetCodeProfile } from './leetcode-profile-sync';
import { useAuth } from '../auth/AuthProvider';
import { PlatformLogo } from '../../components/platforms/PlatformLogo';
import { SessionDraftNotice } from '../../lib/forms/SessionDraftNotice';
import { useSessionDraft } from '../../lib/forms/useSessionDraft';
import './candidate-platform-data.css';

type SyncState = { status: 'idle' | 'loading' | 'syncing' } | { status: 'synced'; result: GitHubSyncResponse } | { status: 'error'; message: string; retry: 'load' | 'sync' };
type LeetCodeState = { status: 'idle' | 'syncing' } | { status: 'synced'; result: LeetCodeSyncResponse } | { status: 'error'; message: string };
function isUsernameDraft(value: unknown): value is string { return typeof value === 'string' && value.length <= 256; }

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'The request could not be completed. Check your connection and try again.';
}

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

const leetCodeStatisticLabels: Record<string, string> = {
  problemsSolved: 'Problems solved',
  easySolved: 'Easy solved',
  mediumSolved: 'Medium solved',
  hardSolved: 'Hard solved',
  contestsAttended: 'Contests attended',
  contestRating: 'Contest rating',
  contestGlobalRanking: 'Global ranking',
  contestParticipants: 'Contest participants',
  contestTopPercentage: 'Top percentage',
};

export function LeetCodeSyncSummary({ result }: { result?: LeetCodeSyncResponse }) {
  if (!result) return null;
  return <div className="saved-platform-data leetcode-sync-result" role="status">
    <p>Statistics saved for <strong>@{result.handle}</strong> · synced {when(result.syncedAt)} via {result.provider}. These profile statistics are not evaluation scores.</p>
    <ul>{Object.entries(result.statistics).map(([name, value]) => <li key={name}><span>{leetCodeStatisticLabels[name] ?? name}</span><strong>{value}</strong></li>)}</ul>
  </div>;
}

export function CandidatePlatformDataPanel({ candidate, onCandidateUpdated }: { candidate: Candidate; onCandidateUpdated?: (candidate: Candidate) => void }) {
  const { session } = useAuth();
  const { value: githubProfile, status: githubDraftStatus, persisted: githubDraftPersisted, setValue: setGithubProfile, initialize: initializeGithub, clear: clearGithubDraft } = useSessionDraft(session?.user?.id, `candidate:${candidate.id}:github-profile`, candidate.githubUsername ?? '', isUsernameDraft);
  const [githubBaseline, setGithubBaseline] = useState(candidate.githubUsername ?? '');
  const [githubState, setGithubState] = useState<SyncState>({ status: 'loading' });
  const { value: leetcodeProfile, status: leetcodeDraftStatus, persisted: leetcodeDraftPersisted, setValue: setLeetCodeProfile, initialize: initializeLeetCode, clear: clearLeetCodeDraft } = useSessionDraft(session?.user?.id, `candidate:${candidate.id}:leetcode-profile`, candidate.leetcodeUsername ?? '', isUsernameDraft);
  const [leetcodeBaseline, setLeetcodeBaseline] = useState(candidate.leetcodeUsername ?? '');
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
        setGithubBaseline(github.profile.username);
        initializeGithub(github.profile.username);
        setGithubState({ status: 'synced', result: githubSyncResponseSchema.parse(github) });
      } else { setGithubBaseline(candidate.githubUsername ?? ''); initializeGithub(candidate.githubUsername ?? ''); setGithubState({ status: 'idle' }); }
      const leetcode = response.items.find((item) => 'platform' in item && item.platform === 'leetcode' && item.provenance === 'alfa_leetcode_api');
      if (leetcode && 'syncedAt' in leetcode) {
        const result = leetCodeSyncResponseSchema.parse(leetcode);
        setLeetcodeBaseline(result.handle);
        setLeetCodeState({ status: 'synced', result });
        initializeLeetCode(result.handle);
      } else { setLeetcodeBaseline(candidate.leetcodeUsername ?? ''); initializeLeetCode(candidate.leetcodeUsername ?? ''); setLeetCodeState({ status: 'idle' }); }
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
      setGithubBaseline(result.profile.username);
      clearGithubDraft(result.profile.username);
    } catch (error) { setGithubState({ status: 'error', message: requestErrorMessage(error), retry: 'sync' }); }
  }

  async function syncLeetCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (leetcodeState.status === 'syncing') return;
    if (!session?.access_token) { setLeetCodeState({ status: 'error', message: 'Your secure session expired. Sign in again to continue.' }); return; }
    setLeetCodeState({ status: 'syncing' });
    try {
      const outcome = await saveAndSyncLeetCodeProfile(candidate.id, leetcodeProfile, session.access_token,
        (path, init, token) => apiRequest<unknown>(path, init, token));
      setLeetcodeBaseline(outcome.handle);
      clearLeetCodeDraft(outcome.handle);
      onCandidateUpdated?.(outcome.candidate);
      setLeetCodeState({ status: 'synced', result: outcome.result });
      setSaved((current) => [outcome.result, ...current.filter((item) => !('platform' in item && item.platform === 'leetcode' && item.provenance === 'alfa_leetcode_api'))]);
    } catch (error) {
      const workflowError = error instanceof LeetCodeProfileSyncError ? error : undefined;
      if (workflowError?.savedCandidate) {
        setLeetcodeBaseline(workflowError.savedCandidate.leetcodeUsername ?? leetcodeProfile.trim());
        clearLeetCodeDraft(workflowError.savedCandidate.leetcodeUsername ?? leetcodeProfile.trim());
        onCandidateUpdated?.(workflowError.savedCandidate);
      }
      const cause = workflowError?.originalError ?? error;
      const message = workflowError?.stage === 'validation'
        ? workflowError.message
        : workflowError?.stage === 'sync'
          ? `${workflowError.message} ${requestErrorMessage(cause)}`
          : requestErrorMessage(cause);
      setLeetCodeState({ status: 'error', message });
    }
  }

  const latestLeetCode = saved.find((item): item is CandidatePlatformResponse => 'platform' in item && item.platform === 'leetcode' && 'submittedAt' in item);
  const savedLeetCodeSync = saved.find((item): item is LeetCodeSyncResponse => 'platform' in item && item.platform === 'leetcode' && item.provenance === 'alfa_leetcode_api' && 'syncedAt' in item);
  const latestLeetCodeSync = leetcodeState.status === 'synced' ? leetcodeState.result : savedLeetCodeSync;
  return <section className="detail-section platform-data-section" aria-labelledby="platform-data-heading">
    <div className="section-heading"><div><h2 id="platform-data-heading">Platform data</h2><p>GitHub syncs through its public API. Coding profile links are saved to the candidate record; unsupported stats are never fabricated.</p></div></div>
    <article className="platform-data-card github-sync-card">
      <div className="platform-data-heading"><span className="platform-mark github-mark"><PlatformLogo platform="github" size="regular"/></span><div><h3>GitHub</h3><p>Public profile and repository summary</p></div><span className={`source-status ${githubState.status === 'synced' ? 'is-available' : githubState.status === 'syncing' || githubState.status === 'loading' ? 'is-pending' : githubState.status === 'error' ? 'is-error' : 'is-idle'}`} role="status">{githubState.status === 'synced' ? 'Synced' : githubState.status === 'syncing' ? 'Syncing…' : githubState.status === 'loading' ? 'Loading saved data…' : githubState.status === 'error' ? 'Needs attention' : 'Ready to sync'}</span></div>
      <SessionDraftNotice status={githubDraftStatus} persisted={githubDraftPersisted} onDiscard={() => clearGithubDraft(githubBaseline)}/>
      <form className="platform-data-form github-sync-form" onSubmit={syncGitHub}><label>GitHub username or profile URL<input value={githubProfile} onChange={(event) => setGithubProfile(event.target.value)} placeholder="octocat or https://github.com/octocat" autoComplete="off" /></label><button className="primary-button" type="submit" disabled={githubState.status === 'syncing'}>{githubState.status === 'syncing' ? 'Syncing…' : <><PlatformLogo platform="github"/>Sync GitHub</>}</button></form>
      {githubState.status === 'error' && <div className="platform-feedback is-error" role="alert"><p>{githubState.message}</p><button type="button" className="text-button" onClick={() => void (githubState.retry === 'sync' ? syncGitHub() : loadSavedData())}>Try again</button></div>}
      {githubState.status === 'synced' && <div className="github-sync-result" role="status"><p>Saved public snapshot for <strong>@{githubState.result.profile.username}</strong>: {githubState.result.profile.publicRepositoryCount} public repositories, {githubState.result.profile.followers} followers, {githubState.result.profile.following} following.</p><small>Updated {when(githubState.result.syncedAt)}. {githubState.result.profile.repositoriesTruncated ? `Showing ${githubState.result.profile.repositoriesReturned} of the available repositories.` : 'No score is calculated from this data.'}</small>{githubState.result.profile.repositories.length > 0 && <ul>{githubState.result.profile.repositories.slice(0, 3).map((repository) => <li key={repository.id}><a href={repository.url} target="_blank" rel="noreferrer">{repository.name}</a><span>{repository.stars} stars{repository.primaryLanguage ? ` · ${repository.primaryLanguage}` : ''}</span></li>)}</ul>}
      </div>}
    </article>
    <article className="platform-data-card platform-data-card-leetcode">
      <div className="platform-data-heading"><span className="platform-mark leetcode-mark"><PlatformLogo platform="leetcode" size="regular"/></span><div><h3>LeetCode</h3><p>Profile link and saved provider statistics</p></div><span className={`source-status ${leetcodeState.status === 'syncing' ? 'is-pending' : leetcodeState.status === 'error' && !latestLeetCodeSync ? 'is-error' : latestLeetCodeSync ? 'is-available' : latestLeetCode?.availability === 'available' ? 'is-available' : latestLeetCode ? 'is-unavailable' : 'is-idle'}`} role="status">{leetcodeState.status === 'syncing' ? 'Syncing…' : leetcodeState.status === 'error' ? latestLeetCodeSync ? 'Last sync saved' : 'Needs attention' : latestLeetCodeSync ? 'Synced' : latestLeetCode ? latestLeetCode.availability.replace('_', ' ') : 'No stats saved'}</span></div>
      <form className="platform-data-form github-sync-form leetcode-sync-form" onSubmit={(event) => void syncLeetCode(event)}>
        <label>LeetCode username or profile URL<input value={leetcodeProfile} onChange={(event) => { setLeetCodeProfile(event.target.value); if (leetcodeState.status === 'error') setLeetCodeState({ status: 'idle' }); }} placeholder="username or https://leetcode.com/u/username" autoComplete="off" aria-invalid={leetcodeState.status === 'error'} aria-describedby={leetcodeState.status === 'error' ? 'leetcode-profile-feedback' : undefined} /></label>
        <button className="primary-button" type="submit" disabled={leetcodeState.status === 'syncing'}>{leetcodeState.status === 'syncing' ? 'Syncing…' : <><PlatformLogo platform="leetcode"/>Sync LeetCode</>}</button>
      </form>
      <p className="platform-sync-explanation">{platformSyncCapabilities.leetcode.explanation}</p>
      {leetcodeState.status === 'error' && <div id="leetcode-profile-feedback" className="platform-feedback is-error" role="alert"><p>{leetcodeState.message}</p><button type="button" className="text-button" onClick={() => void syncLeetCode()}>Try again</button></div>}
      <LeetCodeSyncSummary result={latestLeetCodeSync}/>
      {latestLeetCode && <div className="saved-platform-data"><p>Last saved {when(latestLeetCode.submittedAt)} · {latestLeetCode.provenance.replaceAll('_', ' ')}</p>{latestLeetCode.statistics && <ul>{Object.entries(latestLeetCode.statistics).map(([name, value]) => <li key={name}><span>{name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><strong>{value}</strong></li>)}</ul>}</div>}
    </article>
  </section>;
}
