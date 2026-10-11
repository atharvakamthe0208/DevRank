import { describe, expect, it, vi } from 'vitest';
import { createGitHubAdapter, normalizeGitHubUsername } from '../src/services/github-adapter.js';

const user = {
  login: 'octocat',
  html_url: 'https://github.com/octocat',
  public_repos: 1,
  followers: 20,
  following: 10,
};
const repo = {
  id: 1,
  private: false,
  name: 'hello-world',
  full_name: 'octocat/hello-world',
  html_url: 'https://github.com/octocat/hello-world',
  description: 'Example repository',
  stargazers_count: 12,
  forks_count: 3,
  language: 'TypeScript',
  updated_at: '2026-10-10T12:00:00Z',
};

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('official GitHub REST adapter', () => {
  it('normalizes usernames and profile URLs and rejects malformed values', () => {
    expect(normalizeGitHubUsername(' octocat ')).toBe('octocat');
    expect(normalizeGitHubUsername('https://github.com/octocat/')).toBe('octocat');
    expect(() => normalizeGitHubUsername('https://github.com/octocat/repo')).toThrow('GitHub username or public profile URL');
    expect(() => normalizeGitHubUsername('https://evil.example/octocat')).toThrow('GitHub username or public profile URL');
    expect(() => normalizeGitHubUsername('-bad')).toThrow('valid GitHub username');
  });

  it('retrieves a profile and public repository metadata using bounded pagination', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...repo, id: index + 1 }));
    const paginatedUser = { ...user, public_repos: 51 };
    const fetcher = vi.fn< typeof fetch >()
      .mockResolvedValueOnce(response(paginatedUser))
      .mockResolvedValueOnce(response(firstPage))
      .mockResolvedValueOnce(response([repo]));
    const adapter = createGitHubAdapter(fetcher, 'test-token');

    const profile = await adapter.getProfile('https://github.com/octocat');
    expect(profile).toMatchObject({
      username: 'octocat',
      publicRepositoryCount: 51,
      followers: 20,
      following: 10,
      repositoriesReturned: 51,
      repositoriesTruncated: false,
    });
    expect(profile.repositories[0]).toMatchObject({
      fullName: 'octocat/hello-world', stars: 12, forks: 3, primaryLanguage: 'TypeScript',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('page')).toBe('1');
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('page')).toBe('2');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('returns a not-found error for an unknown username', async () => {
    const adapter = createGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({}, 404)));
    await expect(adapter.getProfile('nobody')).rejects.toMatchObject({ statusCode: 404, code: 'GITHUB_USER_NOT_FOUND' });
  });

  it('rejects invalid input before making provider calls and maps credential failures safely', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createGitHubAdapter(fetcher);
    await expect(adapter.getProfile('https://github.com/octocat/repo')).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_GITHUB_PROFILE',
    });
    expect(fetcher).not.toHaveBeenCalled();

    const rejectedToken = createGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'sensitive' }, 401)), 'bad-token');
    await expect(rejectedToken.getProfile('octocat')).rejects.toMatchObject({
      statusCode: 502, code: 'GITHUB_AUTHENTICATION_FAILED',
    });
  });

  it('never returns private repositories when an API token can access them', async () => {
    const privateRepo = { ...repo, id: 8, private: true };
    const adapter = createGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 1 }))
      .mockResolvedValueOnce(response([privateRepo])));
    await expect(adapter.getProfile('octocat')).resolves.toMatchObject({ repositories: [], repositoriesReturned: 0 });
  });

  it('maps provider rate limits without returning provider payloads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 403, { 'x-ratelimit-remaining': '0' }));
    const adapter = createGitHubAdapter(fetcher);
    await expect(adapter.getProfile('octocat')).rejects.toMatchObject({ statusCode: 429, code: 'GITHUB_RATE_LIMITED' });
  });

  it('sanitizes network and timeout failures', async () => {
    const network = createGitHubAdapter(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('secret network detail')));
    await expect(network.getProfile('octocat')).rejects.toMatchObject({ statusCode: 503, code: 'GITHUB_UNAVAILABLE' });
    const timeoutError = Object.assign(new Error('internal timeout'), { name: 'TimeoutError' });
    const timeout = createGitHubAdapter(vi.fn<typeof fetch>().mockRejectedValue(timeoutError));
    await expect(timeout.getProfile('octocat')).rejects.toMatchObject({ statusCode: 504, code: 'GITHUB_TIMEOUT' });
  });

  it('rejects malformed or incomplete provider data and reports partial repositories', async () => {
    const partialProfile = createGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({ ...user, following: undefined })));
    await expect(partialProfile.getProfile('octocat')).rejects.toMatchObject({ code: 'GITHUB_INVALID_RESPONSE' });

    const malformedRepos = createGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 80 }))
      .mockResolvedValueOnce(response([{ ...repo, stargazers_count: 'many' }])));
    await expect(malformedRepos.getProfile('octocat')).rejects.toMatchObject({ code: 'GITHUB_INVALID_RESPONSE' });

    const partial = createGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 80 }))
      .mockResolvedValueOnce(response([repo])));
    await expect(partial.getProfile('octocat')).resolves.toMatchObject({ repositoriesReturned: 1, repositoriesTruncated: true });
  });
});
