import { z } from 'zod';
import type { LeetCodeSyncResponse } from '@devrank/contracts';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/http-error.js';

const usernamePattern = /^[A-Za-z0-9_.-]{1,100}$/;
const requestTimeoutMs = 30_000;

const count = z.number().int().nonnegative().nullable().optional();
const decimal = z.number().finite().nonnegative().nullable().optional();
const solvedResponseSchema = z.object({
  solvedProblem: count,
  easySolved: count,
  mediumSolved: count,
  hardSolved: count,
}).passthrough();
const contestResponseSchema = z.object({
  contestAttend: count,
  contestRating: decimal,
  contestGlobalRanking: count,
  totalParticipants: count,
  contestTopPercentage: decimal,
}).passthrough();
const profileResponseSchema = z.object({
  username: z.string().optional(),
  profile: z.record(z.unknown()).optional(),
  ranking: z.number().finite().optional(),
  reputation: z.number().finite().optional(),
  avatar: z.string().optional(),
}).passthrough();
const providerGraphqlErrorSchema = z.object({
  errors: z.array(z.object({ message: z.string().optional() }).passthrough()).min(1),
  data: z.object({ matchedUser: z.unknown().nullable().optional() }).passthrough().optional(),
}).passthrough();

export type NormalizedLeetCodeProfile = Omit<LeetCodeSyncResponse, 'id' | 'candidateId' | 'availability' | 'syncedAt'>;

export function normalizeLeetCodeProfile(input: string): { username: string; profileUrl: string } {
  const value = input.trim();
  let username = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      const pathMatch = /^\/u\/([^/]+)\/?$/i.exec(url.pathname);
      if (url.protocol !== 'https:' || !['leetcode.com', 'www.leetcode.com'].includes(hostname)
        || url.port || url.search || url.hash || !pathMatch) {
        throw new Error('invalid LeetCode profile URL');
      }
      username = decodeURIComponent(pathMatch[1]);
    } catch {
      throw new HttpError(400, 'INVALID_LEETCODE_PROFILE', 'Provide a LeetCode username or HTTPS profile URL');
    }
  }
  if (!usernamePattern.test(username)) {
    throw new HttpError(400, 'INVALID_LEETCODE_PROFILE', 'Provide a valid LeetCode username or HTTPS profile URL');
  }
  return { username, profileUrl: `https://leetcode.com/u/${encodeURIComponent(username)}/` };
}

function providerBaseUrl(baseUrl: string): URL {
  const base = new URL(baseUrl);
  const localHttp = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !localHttp) || base.username || base.password) {
    throw new HttpError(503, 'LEETCODE_PROVIDER_MISCONFIGURED', 'LeetCode provider URL must use HTTPS, except for a local development instance');
  }
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  base.search = '';
  base.hash = '';
  return base;
}

function providerError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new HttpError(504, 'LEETCODE_TIMEOUT', 'LeetCode statistics provider did not respond in time');
  }
  return new HttpError(503, 'LEETCODE_PROVIDER_UNAVAILABLE', 'LeetCode statistics provider could not be reached. Check that the configured alfa-leetcode-api service is running and reachable, then retry.');
}

function profileProviderError(input: unknown): HttpError | undefined {
  const response = providerGraphqlErrorSchema.safeParse(input);
  if (!response.success) return undefined;

  const messages = response.data.errors.flatMap((error) => error.message ? [error.message] : []);
  const clearlyNotFound = response.data.data?.matchedUser === null
    && messages.some((message) => /(?:user|profile).*(?:not found|does not exist|doesn't exist)|(?:not found|does not exist|doesn't exist).*(?:user|profile)/i.test(message));
  if (clearlyNotFound) {
    return new HttpError(404, 'LEETCODE_USER_NOT_FOUND', 'LeetCode user was not found');
  }

  return new HttpError(502, 'LEETCODE_PROVIDER_ERROR', 'LeetCode statistics provider could not complete the request');
}

export function createLeetCodeAdapter(
  fetcher: typeof fetch = fetch,
  baseUrl: string = env.LEETCODE_API_BASE_URL,
) {
  return {
    async getProfile(input: string): Promise<NormalizedLeetCodeProfile> {
      const { username, profileUrl } = normalizeLeetCodeProfile(input);
      const base = providerBaseUrl(baseUrl);
      const userPath = encodeURIComponent(username);

      const requestJson = async (suffix: string): Promise<unknown> => {
        const endpoint = new URL(`${userPath}${suffix}`, base);
        let response: Response;
        try {
          response = await fetcher(endpoint, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(requestTimeoutMs),
            redirect: 'error',
          });
        } catch (error) {
          throw providerError(error);
        }
        if (response.status === 404) throw new HttpError(404, 'LEETCODE_USER_NOT_FOUND', 'LeetCode user was not found');
        if (response.status === 429) throw new HttpError(429, 'LEETCODE_RATE_LIMITED', 'LeetCode statistics provider rate limit reached; retry later');
        if (!response.ok) {
          if (response.status >= 500) throw new HttpError(503, 'LEETCODE_PROVIDER_UNAVAILABLE', 'LeetCode statistics provider is temporarily unavailable');
          throw new HttpError(502, 'LEETCODE_PROVIDER_ERROR', 'LeetCode statistics provider could not complete the request');
        }
        try {
          return await response.json() as unknown;
        } catch {
          throw new HttpError(502, 'LEETCODE_INVALID_RESPONSE', 'LeetCode statistics provider returned unreadable data');
        }
      };

      // Profile and solved counts are required; contest details are supplementary. Fetch
      // independently so each endpoint retains its own bounded 30-second timeout.
      const [profileBody, solvedBody, contestBody] = await Promise.all([
        requestJson(''),
        requestJson('/solved'),
        requestJson('/contest').catch(() => undefined),
      ]);

      const profile = profileResponseSchema.safeParse(profileBody);
      const profileError = profileProviderError(profileBody);
      if (profileError) throw profileError;
      if (!profile.success || (profile.data.username && profile.data.username.toLowerCase() !== username.toLowerCase())) {
        throw new HttpError(502, 'LEETCODE_INVALID_RESPONSE', 'LeetCode statistics provider returned an unsupported profile response');
      }
      const profileData = profile.data;
      const profileHasIdentity = Boolean(profileData.username || profileData.profile
        || profileData.ranking !== undefined || profileData.reputation !== undefined || profileData.avatar !== undefined);
      if (!profileHasIdentity) {
        throw new HttpError(502, 'LEETCODE_INVALID_RESPONSE', 'LeetCode statistics provider returned an unsupported profile response');
      }

      const solved = solvedResponseSchema.safeParse(solvedBody);
      if (!solved.success) {
        throw new HttpError(502, 'LEETCODE_INVALID_RESPONSE', 'LeetCode statistics provider returned unsupported solved statistics');
      }
      const solvedStats = {
        ...(solved.data.solvedProblem != null ? { problemsSolved: solved.data.solvedProblem } : {}),
        ...(solved.data.easySolved != null ? { easySolved: solved.data.easySolved } : {}),
        ...(solved.data.mediumSolved != null ? { mediumSolved: solved.data.mediumSolved } : {}),
        ...(solved.data.hardSolved != null ? { hardSolved: solved.data.hardSolved } : {}),
      };
      if (Object.keys(solvedStats).length === 0) {
        throw new HttpError(502, 'LEETCODE_INVALID_RESPONSE', 'LeetCode statistics provider returned no supported statistics');
      }

      const contest = contestBody === undefined ? undefined : contestResponseSchema.safeParse(contestBody);
      const contestStats = contest?.success ? {
        ...(contest.data.contestAttend != null ? { contestsAttended: contest.data.contestAttend } : {}),
        ...(contest.data.contestRating != null ? { contestRating: contest.data.contestRating } : {}),
        ...(contest.data.contestGlobalRanking != null ? { contestGlobalRanking: contest.data.contestGlobalRanking } : {}),
        ...(contest.data.totalParticipants != null ? { contestParticipants: contest.data.totalParticipants } : {}),
        ...(contest.data.contestTopPercentage != null ? { contestTopPercentage: contest.data.contestTopPercentage } : {}),
      } : {};

      return {
        platform: 'leetcode',
        provenance: 'alfa_leetcode_api',
        provider: 'alfa-leetcode-api',
        handle: username,
        profileUrl,
        statistics: { ...solvedStats, ...contestStats },
      };
    },
  };
}

export const leetCodeAdapter = createLeetCodeAdapter();
