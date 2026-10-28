import { afterEach, describe, expect, it, vi } from 'vitest';
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

function createTestGitHubAdapter(fetcher: typeof fetch, token?: string) {
  // REST-only fixtures must not inherit an optional local GraphQL token from .env.
  return createGitHubAdapter(fetcher, token, '');
}

describe('official GitHub REST adapter', () => {
  afterEach(() => vi.useRealTimers());
  it('verifies account existence using only the official public user endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ login: 'octocat' }));
    await expect(createTestGitHubAdapter(fetcher).verifyUsername('octocat')).resolves.toBeUndefined();
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://api.github.com/users/octocat');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('distinguishes missing users from rate limits and provider outages during verification', async () => {
    await expect(createTestGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({}, 404))).verifyUsername('nobody'))
      .rejects.toMatchObject({ statusCode: 404, code: 'GITHUB_USER_NOT_FOUND' });
    await expect(createTestGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({}, 403, { 'x-ratelimit-remaining': '0' }))).verifyUsername('octocat'))
      .rejects.toMatchObject({ statusCode: 429, code: 'GITHUB_RATE_LIMITED' });
    await expect(createTestGitHubAdapter(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('private detail'))).verifyUsername('octocat'))
      .rejects.toMatchObject({ statusCode: 503, code: 'GITHUB_UNAVAILABLE' });
  });

  it('normalizes usernames and profile URLs and rejects malformed values', () => {
    expect(normalizeGitHubUsername(' octocat ')).toBe('octocat');
    expect(normalizeGitHubUsername('https://github.com/octocat/')).toBe('octocat');
    expect(() => normalizeGitHubUsername('https://github.com/octocat/repo')).toThrow('GitHub username or public profile URL');
    expect(() => normalizeGitHubUsername('https://evil.example/octocat')).toThrow('GitHub username or public profile URL');
    expect(() => normalizeGitHubUsername('-bad')).toThrow('valid GitHub username');
  });

  it('retrieves every linked repository page and aggregates complete language evidence', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...repo, id: index + 1 }));
    const paginatedUser = { ...user, public_repos: 51 };
    const fetcher = vi.fn< typeof fetch >()
      .mockResolvedValueOnce(response(paginatedUser))
      .mockResolvedValueOnce(response(firstPage, 200, { Link: '<https://api.github.com/users/octocat/repos?type=owner&sort=updated&per_page=100&page=2>; rel="next"' }))
      .mockResolvedValueOnce(response([repo]));
    const adapter = createTestGitHubAdapter(fetcher, 'test-token');

    const profile = await adapter.getProfile('https://github.com/octocat');
    expect(profile).toMatchObject({
      username: 'octocat',
      publicRepositoryCount: 51,
      followers: 20,
      following: 10,
      repositoriesReturned: 51,
      repositoriesTruncated: false,
      languageSummary: {
        totalEligibleRepositories: 51, repositoriesAnalyzed: 51, observedLanguages: ['TypeScript'],
        repositoriesMissingLanguage: 0, coverageStatus: 'complete',
      },
    });
    expect(profile.repositories[0]).toMatchObject({
      fullName: 'octocat/hello-world', stars: 12, forks: 3, primaryLanguage: 'TypeScript',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('page')).toBe('1');
    expect(new URL(String(fetcher.mock.calls[2][0])).searchParams.get('page')).toBe('2');
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('per_page')).toBe('100');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
  });

  it('accepts the reported candidate username and queries the official public API endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, login: 'atharvakamthe0208', public_repos: 1 }))
      .mockResolvedValueOnce(response([{ ...repo, full_name: 'atharvakamthe0208/hello-world' }]));
    const profile = await createTestGitHubAdapter(fetcher).getProfile('atharvakamthe0208');
    expect(profile.username).toBe('atharvakamthe0208');
    expect(String(fetcher.mock.calls[0][0])).toBe('https://api.github.com/users/atharvakamthe0208');
    expect(String(fetcher.mock.calls[1][0])).toContain('/users/atharvakamthe0208/repos?');
  });

  it('queries contribution insights using a distinct backend token and preserves matching account context', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const days = Array.from({ length: 290 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      return { date, contributionCount: date === '2026-01-02' ? 3 : 0 };
    });
    const graphql = {
      data: { user: { login: 'octocat', contributionsCollection: {
        contributionCalendar: { totalContributions: 3, weeks: [{ contributionDays: days }] },
        totalCommitContributions: 2, totalPullRequestContributions: 1, totalIssueContributions: 0,
        totalPullRequestReviewContributions: 0,
        commitContributionsByRepository: [{ repository: { nameWithOwner: 'octocat/hello-world' }, contributions: {
          nodes: [{ occurredAt: '2026-01-02T12:00:00Z', commitCount: 2 }], pageInfo: { hasNextPage: false },
        } }],
      } } },
    };
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith('/graphql')) return Promise.resolve(response(graphql));
      if (url.endsWith('/users/octocat')) return Promise.resolve(response(user));
      if (url.includes('/repos?')) return Promise.resolve(response([repo]));
      throw new Error('Unexpected GitHub route');
    });
    const profile = await createGitHubAdapter(fetcher, 'rest-token', 'public-contributions-token').getProfile('octocat');
    expect(profile.insights).toMatchObject({
      requestedLogin: 'octocat', attributionStatus: 'matched', attributedLogin: 'octocat',
      currentYearContributions: { status: 'available', year: 2026, totalContributions: 3, periodEnd: '2026-12-31T23:59:59.999Z' },
      developmentActivity: { totalCommitContributions: 2, activeCommitDays: 1 },
      collaboration: { pullRequestsOpened: 1, issuesOpened: 0, reviewsSubmitted: 0 },
    });
    const graphCall = fetcher.mock.calls.find(([url]) => String(url).endsWith('/graphql'));
    expect(graphCall?.[1]?.headers).toMatchObject({ Authorization: 'Bearer public-contributions-token' });
    expect(JSON.stringify(profile)).not.toContain('public-contributions-token');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const payload = JSON.parse(String(graphCall?.[1]?.body)) as { query: string; variables: { from: string; to: string } };
    expect(payload.query).toContain('contributionCalendar');
    expect(payload.query).toContain('totalPullRequestReviewContributions');
    expect(payload.variables.from).toBe('2026-01-01T00:00:00.000Z');
    expect(payload.variables.to).toMatch(/^2026-/);
  });

  it('keeps profile sync successful when optional contribution insights are rate-limited or unavailable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const fetcher = vi.fn<typeof fetch>((input) => {
      const url = String(input);
      if (url.endsWith('/graphql')) return Promise.resolve(response({}, 403, { 'x-ratelimit-remaining': '0' }));
      if (url.endsWith('/users/octocat')) return Promise.resolve(response(user));
      return Promise.resolve(response([repo]));
    });
    const profile = await createGitHubAdapter(fetcher, undefined, 'public-contributions-token').getProfile('octocat');
    expect(profile.username).toBe('octocat');
    expect(profile.insights?.currentYearContributions.status).toBe('unavailable');
    expect(profile.insights?.currentYearContributions.reasons).toContain('rate_limited');
  });

  it('keeps REST profile data when contribution GraphQL times out, fails, or returns malformed JSON', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const scenarios: Array<{ name: string; graphql: () => Promise<Response>; reason: string }> = [
      { name: 'timeout', graphql: () => Promise.reject(Object.assign(new Error('private detail'), { name: 'TimeoutError' })), reason: 'provider_timeout' },
      { name: 'network failure', graphql: () => Promise.reject(new TypeError('private network detail')), reason: 'provider_unavailable' },
      { name: 'malformed JSON', graphql: () => Promise.resolve(new Response('not-json', { status: 200 })), reason: 'malformed_response' },
    ];
    for (const scenario of scenarios) {
      const fetcher = vi.fn<typeof fetch>((input) => {
        const url = String(input);
        if (url.endsWith('/graphql')) return scenario.graphql();
        if (url.endsWith('/users/octocat')) return Promise.resolve(response(user));
        return Promise.resolve(response([repo]));
      });
      const profile = await createGitHubAdapter(fetcher, undefined, 'public-contributions-token').getProfile('octocat');
      expect(profile.username, scenario.name).toBe('octocat');
      expect(profile.insights?.currentYearContributions.status, scenario.name).toBe('unavailable');
      expect(profile.insights?.currentYearContributions.reasons, scenario.name).toContain(scenario.reason);
      expect(JSON.stringify(profile), scenario.name).not.toContain('private detail');
    }
  });

  it('does not query contribution history with the generic repository token alone', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(user))
      .mockResolvedValueOnce(response([repo]));
    const profile = await createTestGitHubAdapter(fetcher, 'generic-rest-token').getProfile('octocat');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(profile.insights?.currentYearContributions.status).toBe('unavailable');
    expect(profile.insights?.currentYearContributions.reasons).toContain('not_configured');
    expect(profile.insights?.currentYearContributions).not.toHaveProperty('totalContributions');
  });

  it('returns a not-found error for an unknown username', async () => {
    const adapter = createTestGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({}, 404)));
    await expect(adapter.getProfile('nobody')).rejects.toMatchObject({ statusCode: 404, code: 'GITHUB_USER_NOT_FOUND' });
  });

  it('rejects invalid input before making provider calls and maps credential failures safely', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createTestGitHubAdapter(fetcher);
    await expect(adapter.getProfile('https://github.com/octocat/repo')).rejects.toMatchObject({
      statusCode: 400, code: 'INVALID_GITHUB_PROFILE',
    });
    expect(fetcher).not.toHaveBeenCalled();

    const rejectedToken = createTestGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({ message: 'sensitive' }, 401)), 'bad-token');
    await expect(rejectedToken.getProfile('octocat')).rejects.toMatchObject({
      statusCode: 502, code: 'GITHUB_AUTHENTICATION_FAILED',
    });
  });

  it('never returns private repositories when an API token can access them', async () => {
    const privateRepo = { ...repo, id: 8, private: true };
    const adapter = createTestGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 1 }))
      .mockResolvedValueOnce(response([privateRepo])));
    await expect(adapter.getProfile('octocat')).resolves.toMatchObject({ repositories: [], repositoriesReturned: 0 });
  });

  it('maps provider rate limits without returning provider payloads', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({}, 403, { 'x-ratelimit-remaining': '0' }));
    const adapter = createTestGitHubAdapter(fetcher);
    await expect(adapter.getProfile('octocat')).rejects.toMatchObject({ statusCode: 429, code: 'GITHUB_RATE_LIMITED' });

    const secondaryByHeader = createTestGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValue(response({}, 403, { 'x-ratelimit-remaining': '99', 'retry-after': '60' })));
    await expect(secondaryByHeader.getProfile('octocat')).rejects.toMatchObject({ statusCode: 429, code: 'GITHUB_RATE_LIMITED' });

    const secondaryByMessage = createTestGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValue(response({ message: 'You have exceeded a secondary rate limit.' }, 403)));
    await expect(secondaryByMessage.getProfile('octocat')).rejects.toMatchObject({ statusCode: 429, code: 'GITHUB_RATE_LIMITED' });
  });

  it('sanitizes network and timeout failures', async () => {
    const network = createTestGitHubAdapter(vi.fn<typeof fetch>().mockRejectedValue(new TypeError('secret network detail')));
    await expect(network.getProfile('octocat')).rejects.toMatchObject({ statusCode: 503, code: 'GITHUB_UNAVAILABLE' });
    const timeoutError = Object.assign(new Error('internal timeout'), { name: 'TimeoutError' });
    const timeout = createTestGitHubAdapter(vi.fn<typeof fetch>().mockRejectedValue(timeoutError));
    await expect(timeout.getProfile('octocat')).rejects.toMatchObject({ statusCode: 504, code: 'GITHUB_TIMEOUT' });
  });

  it('rejects malformed profile data and preserves an invalid repository page as unavailable language evidence', async () => {
    const partialProfile = createTestGitHubAdapter(vi.fn<typeof fetch>().mockResolvedValue(response({ ...user, following: undefined })));
    await expect(partialProfile.getProfile('octocat')).rejects.toMatchObject({ code: 'GITHUB_INVALID_RESPONSE' });

    const malformedRepos = createTestGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 80 }))
      .mockResolvedValueOnce(response([{ ...repo, stargazers_count: 'many' }])));
    await expect(malformedRepos.getProfile('octocat')).resolves.toMatchObject({
      repositoriesReturned: 0, repositoriesTruncated: true,
      languageSummary: { coverageStatus: 'unavailable', retrievalIssue: 'invalid_response' },
    });

    const partial = createTestGitHubAdapter(vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 80 }))
      .mockResolvedValueOnce(response([repo])));
    await expect(partial.getProfile('octocat')).resolves.toMatchObject({ repositoriesReturned: 1, repositoriesTruncated: true });
  });

  it('marks a later-page provider failure partial and does not lose already retrieved repository evidence', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 2 }))
      .mockResolvedValueOnce(response([repo], 200, { Link: '<https://api.github.com/users/octocat/repos?type=owner&sort=updated&per_page=100&page=2>; rel="next"' }))
      .mockResolvedValueOnce(response({ message: 'rate limited' }, 403, { 'x-ratelimit-remaining': '0' }));
    const profile = await createTestGitHubAdapter(fetcher).getProfile('octocat');
    expect(profile.repositoriesReturned).toBe(1);
    expect(profile.languageSummary).toMatchObject({
      totalEligibleRepositories: 2, repositoriesAnalyzed: 1, observedLanguages: ['TypeScript'],
      coverageStatus: 'partial', retrievalIssue: 'provider_rate_limited',
    });
  });

  it('does not treat a missing primaryLanguage field as a confirmed no-language repository', async () => {
    const { language: _language, ...missingLanguageRepo } = repo;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 1 }))
      .mockResolvedValueOnce(response([missingLanguageRepo]));
    const profile = await createTestGitHubAdapter(fetcher).getProfile('octocat');
    expect(profile.repositories[0]).not.toHaveProperty('primaryLanguage');
    expect(profile.languageSummary).toMatchObject({
      repositoriesAnalyzed: 1, repositoriesMissingLanguage: 1, coverageStatus: 'partial',
    });
  });

  it('distinguishes a confirmed empty repository profile from missing repository evidence', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...user, public_repos: 0 }))
      .mockResolvedValueOnce(response([]));
    const profile = await createTestGitHubAdapter(fetcher).getProfile('octocat');
    expect(profile.languageSummary).toMatchObject({
      totalEligibleRepositories: 0, repositoriesAnalyzed: 0, observedLanguages: [], coverageStatus: 'complete',
    });
  });
});
