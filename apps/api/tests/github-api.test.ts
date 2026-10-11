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
  const adapter = { getProfile: vi.fn(async (profile: string) => ({ username: profile })) };

  beforeAll(async () => {
    const app = express();
    const auth = createAuthenticate(async (token) => token === 'valid-token' ? { userId: 'owner-id' } : null);
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
    expect(await response.json()).toEqual({ username: 'https://github.com/octocat' });
    expect(adapter.getProfile).toHaveBeenCalledWith('https://github.com/octocat');
  });
});
