import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CandidatePlatformResponse } from '@devrank/contracts';
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
      if (token === 'owner-token') return { userId: ownerId };
      if (token === 'other-owner-token') return { userId: otherOwnerId };
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
