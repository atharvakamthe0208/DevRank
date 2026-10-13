import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGitHubController } from '../src/controllers/github-controller.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { createGitHubRouter } from '../src/routes/github.js';

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

describe('GitHub lookup API boundary', () => {
  let server: Server;
  let origin: string;
  const profileResponse = {
    username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 1,
    followers: 10, following: 5, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
  };
  const adapter = { getProfile: vi.fn(async () => profileResponse) };

  beforeAll(async () => {
    const app = express();
    const auth = createAuthenticate(async (token) => {
      if (!['valid-token', 'pending-token', 'rejected-token', 'unconfirmed-token'].includes(token)) return null;
      const approval_status = token === 'pending-token' ? 'pending' : token === 'rejected-token' ? 'rejected' : 'approved';
      return {
        userId: 'owner-id', email: 'owner@example.com', emailConfirmed: token !== 'unconfirmed-token',
        profile: { id: 'owner-id', display_name: 'Owner', role: 'recruiter', approval_status },
      };
    });
    app.use('/api/github', createGitHubRouter(createGitHubController(adapter), auth));
    app.use(errorHandler);
    ({ server, origin } = await startServer(app));
  });

  afterAll(async () => closeServer(server));

  it('requires authentication and validates the profile query before lookup', async () => {
    expect((await fetch(`${origin}/api/github?profile=octocat`)).status).toBe(401);
    const invalid = await fetch(`${origin}/api/github`, { headers: { Authorization: 'Bearer valid-token' } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('passes the authorized profile query to the reusable adapter', async () => {
    const response = await fetch(`${origin}/api/github?profile=${encodeURIComponent('https://github.com/octocat')}`, {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(profileResponse);
    expect(adapter.getProfile).toHaveBeenCalledWith('https://github.com/octocat');
  });

  it.each(['pending-token', 'rejected-token', 'unconfirmed-token'])(
    'blocks GitHub lookups for %s before calling the adapter', async (token) => {
      adapter.getProfile.mockClear();
      const response = await fetch(`${origin}/api/github?profile=octocat`, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(403);
      expect(adapter.getProfile).not.toHaveBeenCalled();
    },
  );

  it('returns a controlled contract error when an injected provider returns malformed data', async () => {
    adapter.getProfile.mockResolvedValueOnce({ username: 'octocat' } as never);
    const response = await fetch(`${origin}/api/github?profile=octocat`, { headers: { Authorization: 'Bearer valid-token' } });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: 'GITHUB_INVALID_RESPONSE' } });
  });
});
