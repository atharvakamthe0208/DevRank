import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { validateBody } from '../src/middleware/validate-body.js';

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

describe('API HTTP conventions', () => {
  let apiServer: Server;
  let apiOrigin: string;
  let validationServer: Server;
  let validationOrigin: string;

  beforeAll(async () => {
    ({ server: apiServer, origin: apiOrigin } = await startServer(app));

    const validationApp = express();
    validationApp.use(express.json());
    validationApp.post('/input', validateBody(z.object({ name: z.string().min(1) })), (_request, response) => {
      response.json({ data: { accepted: true } });
    });
    validationApp.use(errorHandler);
    ({ server: validationServer, origin: validationOrigin } = await startServer(validationApp));
  });

  afterAll(async () => {
    await Promise.all([closeServer(apiServer), closeServer(validationServer)]);
  });

  it('returns the health response at /api/health', async () => {
    const response = await fetch(`${apiOrigin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('denies admin application routes without an authenticated administrator token', async () => {
    const response = await fetch(`${apiOrigin}/api/admin/recruiters`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('uses the shared error shape for unknown routes', async () => {
    const response = await fetch(`${apiOrigin}/api/not-implemented`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'NOT_FOUND', message: 'Route GET /api/not-implemented was not found' },
    });
  });

  it('returns safe field-level details for invalid request bodies', async () => {
    const response = await fetch(`${validationOrigin}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is invalid' },
    });
  });

  it('does not expose parser exception details for malformed JSON', async () => {
    const response = await fetch(`${apiOrigin}/api/health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'INVALID_JSON', message: 'Request body contains invalid JSON' },
    });
  });
});
