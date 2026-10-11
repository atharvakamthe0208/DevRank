import {
  githubProfileResponseSchema,
  githubRepositorySchema,
  type GitHubProfileResponse,
} from '@devrank/contracts';
import { z } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/http-error.js';

const githubUsernamePattern = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const maxRepositoryPages = 2;
const repositoryPageSize = 50;
const requestTimeoutMs = 8_000;

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

export function createGitHubAdapter(fetcher: FetchLike = fetch, token: string | undefined = env.GITHUB_TOKEN) {
  async function getJson(url: URL): Promise<unknown> {
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
      return await response.json() as unknown;
    } catch {
      throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an unreadable response');
    }
  }

  return {
    async getProfile(profile: string): Promise<GitHubProfileResponse> {
      const username = normalizeGitHubUsername(profile);
      const apiRoot = 'https://api.github.com';
      const rawProfile = await getJson(new URL(`${apiRoot}/users/${encodeURIComponent(username)}`));
      const profileResult = githubUserSchema.safeParse(rawProfile);
      if (!profileResult.success) throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned incomplete profile data');
      const user = profileResult.data;

      const repositories = [] as GitHubProfileResponse['repositories'];
      for (let page = 1; page <= maxRepositoryPages; page += 1) {
        const repositoryUrl = new URL(`${apiRoot}/users/${encodeURIComponent(username)}/repos`);
        repositoryUrl.searchParams.set('type', 'owner');
        repositoryUrl.searchParams.set('sort', 'updated');
        repositoryUrl.searchParams.set('per_page', String(repositoryPageSize));
        repositoryUrl.searchParams.set('page', String(page));
        const rawRepositories = await getJson(repositoryUrl);
        if (!Array.isArray(rawRepositories)) throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned invalid repository data');
        const parsed = zodRepositoryList.safeParse(rawRepositories);
        if (!parsed.success) throw new HttpError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned incomplete repository data');
        repositories.push(...parsed.data.filter((repository) => !repository.private).map((repository) => ({
          id: repository.id,
          name: repository.name,
          fullName: repository.full_name,
          url: repository.html_url,
          description: repository.description,
          stars: repository.stargazers_count,
          forks: repository.forks_count,
          primaryLanguage: repository.language,
          updatedAt: repository.updated_at,
        })));
        if (parsed.data.length < repositoryPageSize) break;
      }

      const truncated = user.public_repos > repositories.length;
      return githubProfileResponseSchema.parse({
        username: user.login,
        profileUrl: user.html_url,
        publicRepositoryCount: user.public_repos,
        followers: user.followers,
        following: user.following,
        repositories,
        repositoriesReturned: repositories.length,
        repositoriesTruncated: truncated,
      });
    },
  };
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
