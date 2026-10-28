import {
  githubProfileResponseSchema,
  githubRepositorySchema,
  summarizeGitHubLanguages,
  type GitHubProfileResponse,
  type GitHubLanguageRetrievalIssue,
} from '@devrank/contracts';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/http-error.js';
import { currentUtcCalendarRange, normalizeGitHubInsights } from './github-contribution-normalizer.js';

const githubUsernamePattern = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const repositoryPageSize = 100;
const requestTimeoutMs = 8_000;
const contributionQuery = `query CandidateContributionEvidence($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      totalPullRequestReviewContributions
      commitContributionsByRepository(maxRepositories: 100) {
        repository { nameWithOwner }
        contributions(first: 100) {
          nodes { occurredAt commitCount }
          pageInfo { hasNextPage }
        }
      }
    }
  }
}`;

export function normalizeGitHubUsername(input: string): string {
  const value = input.trim();
  let username = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
        || url.search || url.hash || !/^\/[A-Za-z0-9-]+\/?$/.test(url.pathname)) {
        throw new Error('invalid GitHub profile URL');
      }
      username = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } catch {
      throw new HttpError(400, 'INVALID_GITHUB_PROFILE', 'Provide a GitHub username or public profile URL');
    }
  }
  if (!githubUsernamePattern.test(username)) {
    throw new HttpError(400, 'INVALID_GITHUB_PROFILE', 'Provide a valid GitHub username or public profile URL');
  }
  return username;
}

type FetchLike = typeof fetch;

export function createGitHubAdapter(
  fetcher: FetchLike = fetch,
  token: string | undefined = env.GITHUB_TOKEN,
  contributionToken: string | undefined = env.GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN,
) {
  async function getJson(url: URL): Promise<{ data: unknown; link: string | null }> {
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'DevRank-API',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new HttpError(504, 'GITHUB_TIMEOUT', 'GitHub did not respond in time');
      }
      throw new HttpError(503, 'GITHUB_UNAVAILABLE', 'GitHub could not be reached; try again later');
    }

    if (!response.ok) {
      if (response.status === 404) throw new HttpError(404, 'GITHUB_USER_NOT_FOUND', 'GitHub user was not found');
      const isRateLimit = response.status === 429 || (response.status === 403 && (
        response.headers.get('x-ratelimit-remaining') === '0'
        || response.headers.has('retry-after')
        || await hasRateLimitMessage(response)
      ));
      if (isRateLimit) {
        throw new HttpError(429, 'GITHUB_RATE_LIMITED', 'GitHub API rate limit reached; retry later');
      }
      if (response.status === 401) throw new HttpError(502, 'GITHUB_AUTHENTICATION_FAILED', 'GitHub rejected the configured API credentials');
      if (response.status === 403) throw new HttpError(502, 'GITHUB_FORBIDDEN', 'GitHub denied this API request');
      throw new HttpError(502, 'GITHUB_PROVIDER_ERROR', 'GitHub could not complete the profile request');
    }

    try {
      return { data: await response.json() as unknown, link: response.headers.get('link') };
    } catch {
      throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an unreadable response');
    }
  }

  async function getContributionInsights(username: string) {
    const now = new Date();
    const range = currentUtcCalendarRange(now);
    if (!contributionToken) return normalizeGitHubInsights({ errors: [{ message: 'not configured' }] }, username, now);
    let response: Response;
    try {
      response = await fetcher('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'DevRank-API',
          Authorization: `Bearer ${contributionToken}`,
        },
        body: JSON.stringify({ query: contributionQuery, variables: { login: username, from: range.from, to: range.to } }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'provider timeout' : 'provider unavailable';
      return normalizeGitHubInsights({ errors: [{ message: reason }] }, username, now);
    }
    if (!response.ok) {
      const rateLimited = response.status === 429 || (response.status === 403 && (
        response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')
      ));
      return normalizeGitHubInsights({ errors: [{ message: rateLimited ? 'rate limit' : 'provider error' }] }, username, now);
    }
    try {
      return normalizeGitHubInsights(await response.json() as unknown, username, now);
    } catch {
      return normalizeGitHubInsights({ errors: [{ message: 'malformed response' }] }, username, now);
    }
  }

  return {
    async verifyUsername(input: string): Promise<void> {
      const username = normalizeGitHubUsername(input);
      const profileResponse = await getJson(new URL(`https://api.github.com/users/${encodeURIComponent(username)}`));
      const profile = z.object({ login: z.string() }).passthrough().safeParse(profileResponse.data);
      if (!profile.success || profile.data.login.toLowerCase() !== username.toLowerCase()) {
        throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an unsupported profile response');
      }
    },
    async getProfile(profile: string): Promise<GitHubProfileResponse> {
      const username = normalizeGitHubUsername(profile);
      const apiRoot = 'https://api.github.com';
      const insightsPromise = getContributionInsights(username);
      const profileResponse = await getJson(new URL(`${apiRoot}/users/${encodeURIComponent(username)}`));
      const profileResult = githubUserSchema.safeParse(profileResponse.data);
      if (!profileResult.success) throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned incomplete profile data');
      const user = profileResult.data;

      const repositories = [] as GitHubProfileResponse['repositories'];
      let repositoryUrl = new URL(`${apiRoot}/users/${encodeURIComponent(username)}/repos`);
      repositoryUrl.searchParams.set('type', 'owner');
      repositoryUrl.searchParams.set('sort', 'updated');
      repositoryUrl.searchParams.set('per_page', String(repositoryPageSize));
      repositoryUrl.searchParams.set('page', '1');
      let paginationComplete = false;
      let repositoryRetrievalIssue: GitHubLanguageRetrievalIssue | undefined;
      const visitedPages = new Set<string>();
      while (true) {
        if (visitedPages.has(repositoryUrl.href)) {
          repositoryRetrievalIssue = 'invalid_response';
          break;
        }
        visitedPages.add(repositoryUrl.href);
        let repositoryResponse: { data: unknown; link: string | null };
        try {
          repositoryResponse = await getJson(repositoryUrl);
        } catch (error) {
          repositoryRetrievalIssue = languageRetrievalIssue(error);
          break;
        }
        if (!Array.isArray(repositoryResponse.data)) {
          repositoryRetrievalIssue = 'invalid_response';
          break;
        }
        const parsed = zodRepositoryList.safeParse(repositoryResponse.data);
        if (!parsed.success) {
          repositoryRetrievalIssue = 'invalid_response';
          break;
        }
        repositories.push(...parsed.data.filter((repository) => !repository.private).map((repository) => ({
          id: repository.id,
          name: repository.name,
          fullName: repository.full_name,
          url: repository.html_url,
          description: repository.description,
          stars: repository.stargazers_count,
          forks: repository.forks_count,
          ...(repository.language === undefined ? {} : { primaryLanguage: repository.language }),
          updatedAt: repository.updated_at,
        })));
        const nextPage = nextGitHubPage(repositoryResponse.link, repositoryUrl, username);
        if (nextPage === 'invalid') {
          repositoryRetrievalIssue = 'invalid_response';
          break;
        }
        if (!nextPage) {
          paginationComplete = true;
          break;
        }
        repositoryUrl = nextPage;
      }

      const languageSummary = summarizeGitHubLanguages(repositories, user.public_repos, paginationComplete, repositoryRetrievalIssue);
      const truncated = !paginationComplete || user.public_repos > repositories.length;
      const insights = await insightsPromise;
      return githubProfileResponseSchema.parse({
        username: user.login,
        profileUrl: user.html_url,
        publicRepositoryCount: user.public_repos,
        followers: user.followers,
        following: user.following,
        repositories,
        repositoriesReturned: repositories.length,
        repositoriesTruncated: truncated,
        languageSummary,
        insights,
      });
    },
  };
}

function nextGitHubPage(link: string | null, current: URL, username: string): URL | 'invalid' | undefined {
  if (!link) return undefined;
  const next = link.split(',').map((item) => item.trim()).find((item) => /;\s*rel="?next"?/i.test(item));
  if (!next) return undefined;
  const match = next.match(/^<([^>]+)>/);
  if (!match?.[1]) return 'invalid';
  try {
    const url = new URL(match[1]);
    if (url.origin !== 'https://api.github.com'
      || url.pathname !== `/users/${encodeURIComponent(username)}/repos`
      || url.searchParams.get('per_page') !== String(repositoryPageSize)
      || !url.searchParams.get('page')
      || url.href === current.href) return 'invalid';
    return url;
  } catch {
    return 'invalid';
  }
}

function languageRetrievalIssue(error: unknown): GitHubLanguageRetrievalIssue {
  if (error instanceof HttpError) {
    if (error.code === 'GITHUB_RATE_LIMITED') return 'provider_rate_limited';
    if (error.code === 'GITHUB_TIMEOUT') return 'provider_timeout';
    if (error.code === 'GITHUB_UNAVAILABLE') return 'provider_unavailable';
    if (error.code === 'GITHUB_INVALID_RESPONSE') return 'invalid_response';
  }
  return 'provider_error';
}

async function hasRateLimitMessage(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.clone().json();
    if (typeof body !== 'object' || body === null || !('message' in body) || typeof body.message !== 'string') return false;
    return /secondary rate limit|rate limit exceeded/i.test(body.message);
  } catch {
    return false;
  }
}

const githubUserSchema = z.object({
  login: z.string(),
  html_url: z.string().url(),
  public_repos: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
});
const zodRepositoryList = z.array(githubRepositorySchema);

export const githubAdapter = createGitHubAdapter();
