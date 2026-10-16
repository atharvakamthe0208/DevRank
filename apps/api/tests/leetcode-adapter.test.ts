import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/middleware/http-error.js';
import { createLeetCodeAdapter, normalizeLeetCodeProfile } from '../src/services/leetcode-adapter.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const profile = { username: 'example', ranking: 12_345, reputation: 8, avatar: 'https://cdn.example/avatar.png' };
const solved = { solvedProblem: 120, easySolved: 50, mediumSolved: 60, hardSolved: 10 };
const contest = { contestAttend: 8, contestRating: 1710.5, contestGlobalRanking: 3000, totalParticipants: 200000, contestTopPercentage: 1.5 };

function routedFetcher(responses: Record<string, Response | (() => Promise<Response>)>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\//, '');
    const response = responses[path];
    if (!response) throw new Error(`Unexpected provider path ${path}`);
    return typeof response === 'function' ? response() : response;
  });
}

describe('LeetCode provider adapter', () => {
  it('normalizes supported username and HTTPS profile URL forms', () => {
    expect(normalizeLeetCodeProfile(' example_1 ')).toEqual({
      username: 'example_1', profileUrl: 'https://leetcode.com/u/example_1/',
    });
    expect(normalizeLeetCodeProfile('https://www.leetcode.com/u/example_1/')).toEqual({
      username: 'example_1', profileUrl: 'https://leetcode.com/u/example_1/',
    });
  });

  it.each(['', 'https://leetcode.com.evil.test/u/user', 'http://leetcode.com/u/user', 'https://leetcode.com/u/user?x=1', 'https://leetcode.com/user', 'with spaces'])
    ('rejects malformed profile input before making a request: %s', async (input) => {
      const fetcher = vi.fn();
      const adapter = createLeetCodeAdapter(fetcher, 'http://localhost:3001');
      await expect(adapter.getProfile(input)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_LEETCODE_PROFILE' });
      expect(fetcher).not.toHaveBeenCalled();
    });

  it('fetches the documented profile, solved, and contest endpoints and normalizes their distinct shapes', async () => {
    const fetcher = routedFetcher({
      example: jsonResponse(profile),
      'example/solved': jsonResponse(solved),
      'example/contest': jsonResponse(contest),
    });
    const adapter = createLeetCodeAdapter(fetcher, 'http://localhost:3001');
    await expect(adapter.getProfile('example')).resolves.toEqual({
      platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example',
      profileUrl: 'https://leetcode.com/u/example/',
      statistics: {
        problemsSolved: 120, easySolved: 50, mediumSolved: 60, hardSolved: 10, contestsAttended: 8,
        contestRating: 1710.5, contestGlobalRanking: 3000, contestParticipants: 200000, contestTopPercentage: 1.5,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const paths = fetcher.mock.calls.map(([input]) => new URL(String(input)).pathname);
    expect(paths).toEqual(expect.arrayContaining(['/example', '/example/solved', '/example/contest']));
    for (const [, options] of fetcher.mock.calls as unknown as Array<[URL, RequestInit]>) {
      expect(options.method).toBe('GET');
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('accepts partial solved statistics and preserves true zeroes without inventing missing values', async () => {
    const adapter = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile),
      'example/solved': jsonResponse({ easySolved: 0 }),
      'example/contest': jsonResponse(contest),
    }), 'http://localhost:3001');
    const result = await adapter.getProfile('example');
    expect(result.statistics).toMatchObject({ easySolved: 0, contestsAttended: 8 });
    expect(result.statistics).not.toHaveProperty('problemsSolved');
    expect(result.statistics).not.toHaveProperty('hardSolved');
  });

  it.each([
    ['HTTP unavailable', jsonResponse({}, 503)],
    ['malformed JSON', new Response('{bad', { status: 200 })],
    ['unsupported shape', jsonResponse({ unexpected: true })],
  ])('keeps valid solved evidence when optional contest data is %s', async (_label, contestResponse) => {
    const adapter = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile), 'example/solved': jsonResponse({ mediumSolved: 12 }), 'example/contest': contestResponse,
    }), 'http://localhost:3001');
    await expect(adapter.getProfile('example')).resolves.toMatchObject({ statistics: { mediumSolved: 12 } });
  });

  it('does not accept a basic profile response as statistics when solved statistics are unavailable', async () => {
    const adapter = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile), 'example/solved': jsonResponse({}), 'example/contest': jsonResponse(contest),
    }), 'http://localhost:3001');
    await expect(adapter.getProfile('example')).rejects.toMatchObject({ statusCode: 502, code: 'LEETCODE_INVALID_RESPONSE' });
  });

  it('rejects malformed required profile or solved responses', async () => {
    const badProfile = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse({ username: 'someone-else', ranking: 1 }), 'example/solved': jsonResponse(solved), 'example/contest': jsonResponse({}),
    }), 'http://localhost:3001');
    await expect(badProfile.getProfile('example')).rejects.toMatchObject({ statusCode: 502, code: 'LEETCODE_INVALID_RESPONSE' });

    const badSolved = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile), 'example/solved': jsonResponse({ easySolved: -1 }), 'example/contest': jsonResponse({}),
    }), 'http://localhost:3001');
    await expect(badSolved.getProfile('example')).rejects.toMatchObject({ statusCode: 502, code: 'LEETCODE_INVALID_RESPONSE' });
  });

  it('maps missing profiles, rate limits, and provider failures without leaking details', async () => {
    const cases: Array<[string, Response, number, string]> = [
      ['example', jsonResponse({ error: 'missing' }, 404), 404, 'LEETCODE_USER_NOT_FOUND'],
      ['example/solved', jsonResponse({}, 429), 429, 'LEETCODE_RATE_LIMITED'],
      ['example', jsonResponse({}, 503), 503, 'LEETCODE_PROVIDER_UNAVAILABLE'],
    ];
    for (const [path, response, statusCode, code] of cases) {
      const fetcher = routedFetcher({
        example: jsonResponse(profile), 'example/solved': jsonResponse(solved), 'example/contest': jsonResponse(contest), [path]: response,
      });
      const adapter = createLeetCodeAdapter(fetcher, 'http://localhost:3001');
      await expect(adapter.getProfile('example')).rejects.toMatchObject({ statusCode, code });
    }
  });

  it('maps required endpoint timeouts and network failures to sanitized errors', async () => {
    const timeout = new Error('sensitive timeout detail'); timeout.name = 'TimeoutError';
    const timeoutAdapter = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile), 'example/solved': async () => { throw timeout; }, 'example/contest': jsonResponse(contest),
    }), 'http://localhost:3001');
    await expect(timeoutAdapter.getProfile('example')).rejects.toMatchObject({ statusCode: 504, code: 'LEETCODE_TIMEOUT' });

    const networkAdapter = createLeetCodeAdapter(routedFetcher({
      example: jsonResponse(profile), 'example/solved': async () => { throw new Error('private network detail'); }, 'example/contest': jsonResponse(contest),
    }), 'http://localhost:3001');
    try {
      await networkAdapter.getProfile('example');
      throw new Error('expected provider failure');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 503, code: 'LEETCODE_PROVIDER_UNAVAILABLE' });
      expect((error as Error).message).not.toContain('private network');
    }
  });

  it('requires HTTPS for hosted provider endpoints', async () => {
    const adapter = createLeetCodeAdapter(async () => jsonResponse({}), 'http://provider.example');
    await expect(adapter.getProfile('example')).rejects.toMatchObject({ code: 'LEETCODE_PROVIDER_MISCONFIGURED' });
  });
});
