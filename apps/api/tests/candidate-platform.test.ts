import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CandidatePlatformResponse, GitHubSyncResponse, LeetCodeSyncResponse } from '@devrank/contracts';
import { createCandidatePlatformController } from '../src/controllers/candidate-platform-controller.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { HttpError } from '../src/middleware/http-error.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { createCandidatesRouter } from '../src/routes/candidates.js';
import type { CandidatePlatformRepository } from '../src/repositories/candidate-platform-repository.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const otherOwnerId = 'a6a225a1-c4c6-423e-8a90-69c282e05244';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';

async function startServer(application: express.Express): Promise<{ server: Server; origin: string }> {
  const server = application.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function createRepository(): CandidatePlatformRepository {
  return {
    getLatest: vi.fn(async (auth, id) => {
      if (auth.userId !== ownerId || id !== candidateId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return { items: [] };
    }),
    submit: vi.fn(async (auth, id, input) => {
      if (auth.userId !== ownerId || id !== candidateId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      if (auth.userId === otherOwnerId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      if (input.platform === 'leetcode' && input.statistics?.problemsSolved === 99) {
        throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to save platform data right now');
      }
      const response: CandidatePlatformResponse = {
        id: 'ea574cd8-8d21-4586-a887-dc2a6fc7ba08',
        candidateId: id,
        platform: input.platform,
        availability: input.availability,
        provenance: 'candidate_provided',
        ...(input.profileUrl ? { profileUrl: input.profileUrl } : {}),
        ...(input.handle ? { handle: input.handle } : {}),
        ...(input.statistics ? { statistics: input.statistics } : {}),
        submittedAt: '2026-10-11T12:00:00.000Z',
      };
      return response;
    }),
    syncGitHub: vi.fn(async (auth, id, profile): Promise<GitHubSyncResponse> => {
      if (auth.userId !== ownerId || id !== candidateId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      if (profile === 'missing-profile') throw new HttpError(404, 'GITHUB_USER_NOT_FOUND', 'GitHub user was not found');
      if (profile === 'database-permission') throw new HttpError(403, 'GITHUB_DATABASE_PERMISSION_DENIED', 'The database denied saving GitHub data.');
      if (profile === 'database-write-failed') throw new HttpError(503, 'GITHUB_DATA_SAVE_FAILED', 'GitHub data was retrieved, but the database could not save it.');
      return {
        id: 'ea574cd8-8d21-4586-a887-dc2a6fc7ba08', candidateId: id, source: 'github',
        availability: 'available', provenance: 'github_api', syncedAt: '2026-10-11T12:00:00.000Z',
        profile: {
          username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 8,
          followers: 10, following: 5, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
        },
      };
    }),
    syncLeetCode: vi.fn(async (auth, id, profile): Promise<LeetCodeSyncResponse> => {
      if (auth.userId !== ownerId || id !== candidateId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      if (profile === 'missing-profile') throw new HttpError(404, 'LEETCODE_USER_NOT_FOUND', 'LeetCode user was not found');
      if (profile === 'provider-failed') throw new HttpError(503, 'LEETCODE_PROVIDER_UNAVAILABLE', 'LeetCode statistics provider is temporarily unavailable');
      if (profile === 'save-failed') throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to save LeetCode profile data right now');
      const handle = profile.startsWith('https://') ? new URL(profile).pathname.split('/').filter(Boolean).at(-1)! : profile;
      return {
        id: 'ea574cd8-8d21-4586-a887-dc2a6fc7ba08', candidateId: id, platform: 'leetcode', availability: 'available',
        provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle,
        profileUrl: `https://leetcode.com/u/${handle}/`, statistics: { problemsSolved: 12, easySolved: 0 },
        syncedAt: '2026-10-15T12:00:00.000Z',
      };
    }),
  };
}

describe('candidate platform data API', () => {
  let server: Server;
  let origin: string;
  let repository: CandidatePlatformRepository;

  beforeAll(async () => {
    repository = createRepository();
    const app = express();
    app.use(express.json());
    const auth = createAuthenticate(async (token) => {
      const approvedRecruiter = (userId: string) => ({
        userId,
        email: 'recruiter@example.com',
        emailConfirmed: true,
        profile: { id: userId, display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const },
      });
      if (token === 'owner-token') return approvedRecruiter(ownerId);
      if (token === 'other-owner-token') return approvedRecruiter(otherOwnerId);
      return null;
    });
    app.use('/api/candidates', createCandidatesRouter(undefined, auth, createCandidatePlatformController(repository)));
    app.use(errorHandler);
    ({ server, origin } = await startServer(app));
  });

  afterAll(async () => closeServer(server));

  async function submit(body: unknown, token?: string) {
    return fetch(`${origin}/api/candidates/${candidateId}/platform-data`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }

  async function syncGitHub(body: unknown, token?: string) {
    return fetch(`${origin}/api/candidates/${candidateId}/platform-data/github-sync`, {
      method: 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function syncLeetCode(body: unknown, token?: string) {
    return fetch(`${origin}/api/candidates/${candidateId}/platform-data/leetcode-sync`, {
      method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('syncs GitHub profile data for an approved recruiter and reports source failures', async () => {
    const success = await syncGitHub({ profile: 'octocat' }, 'owner-token');
    expect(success.status).toBe(201);
    expect(await success.json()).toMatchObject({
      candidateId, source: 'github', availability: 'available', provenance: 'github_api',
      profile: { username: 'octocat', publicRepositoryCount: 8 },
    });
    expect(repository.syncGitHub).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, accessToken: 'owner-token' }), candidateId, 'octocat',
    );

    const missing = await syncGitHub({ profile: 'missing-profile' }, 'owner-token');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'GITHUB_USER_NOT_FOUND' } });

    const permissionDenied = await syncGitHub({ profile: 'database-permission' }, 'owner-token');
    expect(permissionDenied.status).toBe(403);
    expect(await permissionDenied.json()).toMatchObject({ error: { code: 'GITHUB_DATABASE_PERMISSION_DENIED' } });

    const saveFailure = await syncGitHub({ profile: 'database-write-failed' }, 'owner-token');
    expect(saveFailure.status).toBe(503);
    expect(await saveFailure.json()).toMatchObject({ error: { code: 'GITHUB_DATA_SAVE_FAILED' } });
  });

  it('syncs LeetCode only for an authenticated approved recruiter and handles provider/storage errors', async () => {
    const success = await syncLeetCode({ profile: 'https://leetcode.com/u/example/' }, 'owner-token');
    expect(success.status).toBe(201);
    expect(await success.json()).toMatchObject({
      candidateId, platform: 'leetcode', availability: 'available', provenance: 'alfa_leetcode_api',
      provider: 'alfa-leetcode-api', handle: 'example', statistics: { problemsSolved: 12, easySolved: 0 },
    });
    expect(repository.syncLeetCode).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, accessToken: 'owner-token' }), candidateId, 'https://leetcode.com/u/example/',
    );
    expect((await syncLeetCode({ profile: 'missing-profile' }, 'owner-token')).status).toBe(404);
    expect((await syncLeetCode({ profile: 'provider-failed' }, 'owner-token')).status).toBe(503);
    expect((await syncLeetCode({ profile: 'save-failed' }, 'owner-token')).status).toBe(503);
    expect((await syncLeetCode({ profile: 'example' })).status).toBe(401);
    expect((await syncLeetCode({ profile: 'example' }, 'other-owner-token')).status).toBe(404);
    expect((await syncLeetCode({ profile: '' }, 'owner-token')).status).toBe(400);
    expect((await syncLeetCode({ profile: 'example', unexpected: true }, 'owner-token')).status).toBe(400);
  });

  it('returns persisted platform data only for the authorized candidate', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}/platform-data`, { headers: { Authorization: 'Bearer owner-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(repository.getLatest).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId }), candidateId);
    expect((await fetch(`${origin}/api/candidates/${candidateId}/platform-data`)).status).toBe(401);
  });

  it('requires approval and rejects malformed GitHub sync requests', async () => {
    expect((await syncGitHub({ profile: 'octocat' })).status).toBe(401);
    expect((await syncGitHub({ profile: 'octocat' }, 'other-owner-token')).status).toBe(404);
    const invalid = await syncGitHub({ profile: '' }, 'owner-token');
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });

    const invalidCandidateId = await fetch(`${origin}/api/candidates/invalid-id/platform-data/github-sync`, {
      method: 'POST', headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'octocat' }),
    });
    expect(invalidCandidateId.status).toBe(400);
    expect(await invalidCandidateId.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('accepts candidate-provided LeetCode data and preserves an actual zero', async () => {
    const response = await submit({
      platform: 'leetcode',
      handle: 'example',
      profileUrl: 'https://leetcode.com/u/example/',
      availability: 'available',
      statistics: { problemsSolved: 0, easySolved: 0 },
    }, 'owner-token');
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      candidateId,
      platform: 'leetcode',
      availability: 'available',
      provenance: 'candidate_provided',
      statistics: { problemsSolved: 0, easySolved: 0 },
    });
    expect(repository.submit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, accessToken: 'owner-token' }),
      candidateId,
      expect.objectContaining({ platform: 'leetcode', statistics: { problemsSolved: 0, easySolved: 0 } }),
    );
  });

  it('accepts HackerRank data and preserves a genuine zero', async () => {
    const response = await submit({
      platform: 'hackerrank',
      handle: 'example',
      availability: 'available',
      statistics: { points: 0, badges: 2 },
    }, 'owner-token');
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ platform: 'hackerrank', availability: 'available', statistics: { points: 0, badges: 2 } });
    expect(body.statistics).not.toHaveProperty('certificates');
  });

  it('keeps omitted optional statistics absent and distinguishes not provided from zero', async () => {
    const partial = await submit({
      platform: 'leetcode', handle: 'example', availability: 'available', statistics: { easySolved: 5 },
    }, 'owner-token');
    expect(await partial.json()).toMatchObject({ statistics: { easySolved: 5 } });
    const notProvided = await submit({ platform: 'leetcode', handle: 'example', availability: 'not_provided' }, 'owner-token');
    const body = await notProvided.json();
    expect(body).toMatchObject({ availability: 'not_provided' });
    expect(body).not.toHaveProperty('statistics');
  });

  it.each([
    { platform: 'github', handle: 'example', availability: 'available', statistics: { problemsSolved: 1 } },
    { platform: 'leetcode', handle: 'example', availability: 'available', statistics: { problemsSolved: -1 } },
    { platform: 'leetcode', handle: 'example', availability: 'available', statistics: { unknownMetric: 2 } },
    { platform: 'leetcode', handle: 'example', availability: 'available' },
    { platform: 'leetcode', handle: 'example', profileUrl: 'https://evil.example/user', availability: 'not_provided' },
    { platform: 'leetcode', handle: 'example', availability: 'unavailable', statistics: { problemsSolved: 0 } },
    { platform: 'hackerrank', handle: 'example', availability: 'available', statistics: { badges: 2, unexpected: 1 } },
    { platform: 'hackerrank', handle: 'example', availability: 'available', statistics: { points: -1 } },
    { platform: 'hackerrank', availability: 'not_provided', unexpected: true },
  ])('rejects malformed or unsupported submission: %j', async (body) => {
    const response = await submit(body, 'owner-token');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('requires authentication and hides candidates owned by someone else', async () => {
    const body = { platform: 'leetcode', handle: 'example', availability: 'not_provided' };
    expect((await submit(body)).status).toBe(401);
    const unauthorized = await submit(body, 'other-owner-token');
    expect(unauthorized.status).toBe(404);
    expect(await unauthorized.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns not found for malformed or missing candidate IDs and sanitizes persistence failures', async () => {
    const missing = await fetch(`${origin}/api/candidates/invalid-id/platform-data`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'leetcode', handle: 'example', availability: 'not_provided' }),
    });
    expect(missing.status).toBe(400);

    const missingCandidate = await fetch(`${origin}/api/candidates/a6a225a1-c4c6-423e-8a90-69c282e05244/platform-data`, {
      method: 'POST',
      headers: { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'leetcode', handle: 'example', availability: 'not_provided' }),
    });
    expect(missingCandidate.status).toBe(404);

    const databaseFailure = await submit({
      platform: 'leetcode', handle: 'example', availability: 'available', statistics: { problemsSolved: 99 },
    }, 'owner-token');
    expect(databaseFailure.status).toBe(503);
    expect(await databaseFailure.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  });
});
