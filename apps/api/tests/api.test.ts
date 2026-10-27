import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { HttpError } from '../src/middleware/http-error.js';
import { validateBody } from '../src/middleware/validate-body.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { createApiRouter } from '../src/routes/index.js';

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
  let authServer: Server;
  let authOrigin: string;
  const verifiedTokens: string[] = [];
  const profileUpdates: Array<{ token: string; userId: string; fields: Record<string, unknown> }> = [];
  let profileForAuth = { id: 'user-1', display_name: 'Recruiter', phone_number: null, company_name: null, job_title: null, company_website: null, location_city: null, location_country: null, role: 'recruiter' as const, approval_status: 'pending' as const };

  beforeAll(async () => {
    ({ server: apiServer, origin: apiOrigin } = await startServer(app));

    const validationApp = express();
    validationApp.use(express.json());
    validationApp.post('/input', validateBody(z.object({ name: z.string().min(1) })), (_request, response) => {
      response.json({ data: { accepted: true } });
    });
    validationApp.use(errorHandler);
    ({ server: validationServer, origin: validationOrigin } = await startServer(validationApp));

    const authApp = express();
    authApp.use(express.json());
    authApp.use('/api', createApiRouter(createAuthenticate(async (token) => {
      verifiedTokens.push(token);
      return { userId: 'user-1', email: 'recruiter@example.com', emailConfirmed: true, profile: profileForAuth };
    }), async (token, userId, update) => {
      if (update.companyName === 'Missing schema') throw new HttpError(503, 'PROFILE_SCHEMA_MIGRATION_REQUIRED', 'Apply the recruiter profile details migration.');
      if (update.companyName === 'Database failure') throw new HttpError(503, 'PROFILE_UPDATE_UNAVAILABLE', 'Recruiter profile could not be saved right now');
      profileUpdates.push({ token, userId, fields: update });
      profileForAuth = { id: userId, display_name: update.displayName, phone_number: update.phoneNumber, company_name: update.companyName, job_title: update.jobTitle, company_website: update.companyWebsite, location_city: update.locationCity, location_country: update.locationCountry, role: 'recruiter', approval_status: 'pending' };
      return profileForAuth;
    }));
    authApp.use(errorHandler);
    ({ server: authServer, origin: authOrigin } = await startServer(authApp));
  });

  afterAll(async () => {
    await Promise.all([closeServer(apiServer), closeServer(validationServer), closeServer(authServer)]);
  });

  it('returns the health response at /api/health', async () => {
    const response = await fetch(`${apiOrigin}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('allows a moved local Vite port and answers auth preflight requests', async () => {
    const response = await fetch(`${apiOrigin}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5174');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
  });

  it('answers production auth preflight for the configured frontend origin and request headers', async () => {
    const response = await fetch(`${apiOrigin}/api/auth/me`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dev-rank-ruddy.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://dev-rank-ruddy.vercel.app');
    expect(response.headers.get('access-control-allow-methods')).toContain('GET');
    expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it('does not grant CORS access to arbitrary origins', async () => {
    const response = await fetch(`${apiOrigin}/api/health`, { headers: { Origin: 'https://attacker.example' } });
    expect(response.status).toBe(200);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
  });

  it('denies admin application routes without an authenticated administrator token', async () => {
    const response = await fetch(`${apiOrigin}/api/admin/recruiters`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('verifies the bearer token before returning the caller recruiter profile at /auth/me', async () => {
    const response = await fetch(`${authOrigin}/api/auth/me`, { headers: { Authorization: 'Bearer verified-test-token' } });
    expect(response.status).toBe(200);
    expect(verifiedTokens).toEqual(['verified-test-token']);
    expect(await response.json()).toEqual({
      user: { id: 'user-1', email: 'recruiter@example.com' },
      profile: { id: 'user-1', display_name: 'Recruiter', phone_number: null, company_name: null, job_title: null, company_website: null, location_city: null, location_country: null, role: 'recruiter', approval_status: 'pending' },
      emailConfirmed: true,
    });
  });

  it('updates only the authenticated caller profile and returns the saved data', async () => {
    const response = await fetch(`${authOrigin}/api/auth/me`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer verified-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Updated Recruiter', phoneNumber: '+1 555 123 4567', companyName: 'Northwind', jobTitle: 'Talent Partner', companyWebsite: 'https://northwind.example', locationCity: 'Seattle', locationCountry: 'USA' }),
    });
    expect(response.status).toBe(200);
    expect(profileUpdates).toEqual([{ token: 'verified-test-token', userId: 'user-1', fields: { displayName: 'Updated Recruiter', phoneNumber: '+1 555 123 4567', companyName: 'Northwind', jobTitle: 'Talent Partner', companyWebsite: 'https://northwind.example', locationCity: 'Seattle', locationCountry: 'USA' } }]);
    expect(await response.json()).toEqual({
      user: { id: 'user-1', email: 'recruiter@example.com' },
      profile: { id: 'user-1', display_name: 'Updated Recruiter', phone_number: '+1 555 123 4567', company_name: 'Northwind', job_title: 'Talent Partner', company_website: 'https://northwind.example', location_city: 'Seattle', location_country: 'USA', role: 'recruiter', approval_status: 'pending' },
      emailConfirmed: true,
    });
    const reload = await fetch(`${authOrigin}/api/auth/me`, { headers: { Authorization: 'Bearer verified-test-token' } });
    expect(reload.status).toBe(200);
    expect(await reload.json()).toMatchObject({ profile: { display_name: 'Updated Recruiter', company_name: 'Northwind', role: 'recruiter', approval_status: 'pending' } });
  });

  it('rejects invalid profile updates and requires authentication', async () => {
    const invalid = await fetch(`${authOrigin}/api/auth/me`, {
      method: 'PATCH', headers: { Authorization: 'Bearer verified-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: '  ', phoneNumber: null, companyName: null, jobTitle: null, companyWebsite: null, locationCity: null, locationCountry: null }),
    });
    expect(invalid.status).toBe(400);
    expect(profileUpdates).toHaveLength(1);
    const roleTampering = await fetch(`${authOrigin}/api/auth/me`, {
      method: 'PATCH', headers: { Authorization: 'Bearer verified-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Recruiter', phoneNumber: null, companyName: null, jobTitle: null, companyWebsite: null, locationCity: null, locationCountry: null, role: 'admin', approval_status: 'approved' }),
    });
    expect(roleTampering.status).toBe(400);
    expect(profileUpdates).toHaveLength(1);
    const unauthenticated = await fetch(`${authOrigin}/api/auth/me`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: 'Intruder' }),
    });
    expect(unauthenticated.status).toBe(401);
    expect(profileUpdates).toHaveLength(1);
  });

  it('returns structured database and unapplied-migration errors for profile updates', async () => {
    const request = (companyName: string) => fetch(`${authOrigin}/api/auth/me`, {
      method: 'PATCH', headers: { Authorization: 'Bearer verified-test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Recruiter', phoneNumber: null, companyName, jobTitle: null, companyWebsite: null, locationCity: null, locationCountry: null }),
    });
    const migration = await request('Missing schema');
    expect(migration.status).toBe(503);
    expect(await migration.json()).toMatchObject({ error: { code: 'PROFILE_SCHEMA_MIGRATION_REQUIRED' } });
    const database = await request('Database failure');
    expect(database.status).toBe(503);
    expect(await database.json()).toMatchObject({ error: { code: 'PROFILE_UPDATE_UNAVAILABLE' } });
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
