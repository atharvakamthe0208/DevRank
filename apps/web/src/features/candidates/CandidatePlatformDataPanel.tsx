import { useEffect, useState, type FormEvent } from 'react';
import {
  candidatePlatformDataResponseSchema,
  candidatePlatformResponseSchema,
  candidatePlatformSubmissionSchema,
  githubSyncResponseSchema,
  type Candidate,
  type CandidatePlatformDataResponse,
  type CandidatePlatformResponse,
  type GitHubSyncResponse,
} from '@devrank/contracts';
import { ApiRequestError, apiRequest } from '../../lib/api/client';
import { useAuth } from '../auth/AuthProvider';
import './candidate-platform-data.css';

type PlatformName = 'leetcode' | 'hackerrank';
type ImportState = { status: 'idle' | 'saving' } | { status: 'saved'; result: CandidatePlatformResponse } | { status: 'error'; message: string };
type SyncState = { status: 'idle' | 'loading' | 'syncing' } | { status: 'synced'; result: GitHubSyncResponse } | { status: 'error'; message: string; retry: 'load' | 'sync' };

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'The request could not be completed. Check your connection and try again.';
}

function when(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function CandidatePlatformDataPanel({ candidate }: { candidate: Candidate }) {
  const { session } = useAuth();
  const [githubProfile, setGithubProfile] = useState(candidate.githubUsername ?? '');
  const [githubState, setGithubState] = useState<SyncState>({ status: 'loading' });
  const [imports, setImports] = useState<Record<PlatformName, ImportState>>({ leetcode: { status: 'idle' }, hackerrank: { status: 'idle' } });
  const [files, setFiles] = useState<Record<PlatformName, File | null>>({ leetcode: null, hackerrank: null });
  const [authorized, setAuthorized] = useState<Record<PlatformName, boolean>>({ leetcode: false, hackerrank: false });
  const [saved, setSaved] = useState<CandidatePlatformDataResponse['items']>([]);

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

  async function importPlatform(platform: PlatformName, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authorized[platform]) { setImports((state) => ({ ...state, [platform]: { status: 'error', message: 'Confirm candidate authorization before importing.' } })); return; }
    const file = files[platform];
    if (!file) { setImports((state) => ({ ...state, [platform]: { status: 'error', message: 'Choose a JSON file to import.' } })); return; }
    if (!session?.access_token) { setImports((state) => ({ ...state, [platform]: { status: 'error', message: 'Your secure session expired. Sign in again to continue.' } })); return; }
    setImports((state) => ({ ...state, [platform]: { status: 'saving' } }));
    try {
      const parsedFile: unknown = JSON.parse(await file.text());
      const submission = candidatePlatformSubmissionSchema.parse(parsedFile);
      if (submission.platform !== platform) throw new Error(`Choose a ${platform === 'leetcode' ? 'LeetCode' : 'HackerRank'} JSON file.`);
      const response = await apiRequest<unknown>(`/candidates/${candidate.id}/platform-data`, { method: 'POST', body: JSON.stringify(submission) }, session.access_token);
      const savedRecord = candidatePlatformResponseSchema.parse(response);
      setImports((state) => ({ ...state, [platform]: { status: 'saved', result: savedRecord } }));
      setSaved((current) => [savedRecord, ...current.filter((item) => !('platform' in item && item.platform === platform))]);
    } catch (error) {
      const message = error instanceof SyntaxError ? 'The selected file is not valid JSON.' : error instanceof Error && !(error instanceof ApiRequestError) ? error.message : requestErrorMessage(error);
      setImports((state) => ({ ...state, [platform]: { status: 'error', message } }));
    }
  }

  const latest = (platform: PlatformName) => saved.find((item) => 'platform' in item && item.platform === platform) as CandidatePlatformResponse | undefined;
  return <section className="detail-section platform-data-section" aria-labelledby="platform-data-heading">
    <div className="section-heading"><div><h2 id="platform-data-heading">Platform data</h2><p>GitHub uses its public API. LeetCode and HackerRank summaries must be supplied by the candidate as structured data.</p></div></div>
    <article className="platform-data-card github-sync-card">
      <div className="platform-data-heading"><span className="platform-mark github-mark">GH</span><div><h3>GitHub</h3><p>Public profile and repository summary</p></div><span className={`source-status ${githubState.status === 'synced' ? 'is-available' : githubState.status === 'syncing' || githubState.status === 'loading' ? 'is-pending' : githubState.status === 'error' ? 'is-error' : 'is-idle'}`} role="status">{githubState.status === 'synced' ? 'Synced' : githubState.status === 'syncing' ? 'Syncing…' : githubState.status === 'loading' ? 'Loading saved data…' : githubState.status === 'error' ? 'Needs attention' : 'Ready to sync'}</span></div>
      <form className="platform-data-form github-sync-form" onSubmit={syncGitHub}><label>GitHub username or profile URL<input value={githubProfile} onChange={(event) => setGithubProfile(event.target.value)} placeholder="octocat or https://github.com/octocat" autoComplete="off" /></label><button className="primary-button" type="submit" disabled={githubState.status === 'syncing'}>{githubState.status === 'syncing' ? 'Syncing…' : 'Sync GitHub'}</button></form>
      {githubState.status === 'error' && <div className="platform-feedback is-error" role="alert"><p>{githubState.message}</p><button type="button" className="text-button" onClick={() => void (githubState.retry === 'sync' ? syncGitHub() : loadSavedData())}>Try again</button></div>}
      {githubState.status === 'synced' && <div className="github-sync-result" role="status"><p>Saved public snapshot for <strong>@{githubState.result.profile.username}</strong>: {githubState.result.profile.publicRepositoryCount} public repositories, {githubState.result.profile.followers} followers, {githubState.result.profile.following} following.</p><small>Updated {when(githubState.result.syncedAt)}. {githubState.result.profile.repositoriesTruncated ? `Showing ${githubState.result.profile.repositoriesReturned} of the available repositories.` : 'No score is calculated from this data.'}</small>{githubState.result.profile.repositories.length > 0 && <ul>{githubState.result.profile.repositories.slice(0, 3).map((repository) => <li key={repository.id}><a href={repository.url} target="_blank" rel="noreferrer">{repository.name}</a><span>{repository.stars} stars{repository.primaryLanguage ? ` · ${repository.primaryLanguage}` : ''}</span></li>)}</ul>}</div>}
    </article>
    {(['leetcode', 'hackerrank'] as const).map((platform) => {
      const label = platform === 'leetcode' ? 'LeetCode' : 'HackerRank';
      const current = imports[platform];
      const previous = latest(platform);
      return <article className={`platform-data-card platform-data-card-${platform}`} key={platform}>
        <div className="platform-data-heading"><span className={`platform-mark ${platform === 'leetcode' ? 'leetcode-mark' : 'hackerrank-mark'}`}>{platform === 'leetcode' ? 'LC' : 'HR'}</span><div><h3>{label}</h3><p>Candidate-authorized structured summary</p></div><span className={`source-status ${previous?.availability === 'available' ? 'is-available' : previous ? 'is-unavailable' : 'is-idle'}`} role="status">{previous ? previous.availability.replace('_', ' ') : 'No data saved'}</span></div>
        <form className="platform-data-form" onSubmit={(event) => void importPlatform(platform, event)}>
          <label>Candidate summary JSON<input type="file" accept="application/json,.json" onChange={(event) => { setFiles((state) => ({ ...state, [platform]: event.target.files?.[0] ?? null })); setImports((state) => ({ ...state, [platform]: { status: 'idle' } })); }} /></label>
          <label className="candidate-authorization"><input type="checkbox" checked={authorized[platform]} onChange={(event) => setAuthorized((state) => ({ ...state, [platform]: event.target.checked }))} /> The candidate authorized this import and provided or confirmed these values.</label>
          <div className="platform-submit-row"><p>Imported values are stored as candidate-provided and are not independently verified.</p><button className="primary-button" type="submit" disabled={current.status === 'saving'}>{current.status === 'saving' ? 'Importing…' : `Import ${label} data`}</button></div>
          {current.status === 'error' && <p className="platform-feedback is-error" role="alert">{current.message}</p>}
          {current.status === 'saved' && <p className="platform-feedback is-success" role="status">{label} data saved at {when(current.result.submittedAt)}.</p>}
          {previous && <div className="saved-platform-data"><p>Last saved {when(previous.submittedAt)} · {previous.provenance.replace('_', ' ')}</p>{previous.statistics && <ul>{Object.entries(previous.statistics).map(([name, value]) => <li key={name}><span>{name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span><strong>{value}</strong></li>)}</ul>}</div>}
        </form>
      </article>;
    })}
  </section>;
}
