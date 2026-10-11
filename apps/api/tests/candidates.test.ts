import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { candidateListResponseSchema, candidateSchema, type Candidate } from '@devrank/contracts';
import { createCandidateController } from '../src/controllers/candidate-controller.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { HttpError } from '../src/middleware/http-error.js';
import { validateBody } from '../src/middleware/validate-body.js';
import { candidateDatabaseDiagnostic, candidateRepository, type CandidateRepository } from '../src/repositories/candidate-repository.js';
import { createCandidatesRouter } from '../src/routes/candidates.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const otherUserId = 'a6a225a1-c4c6-423e-8a90-69c282e05244';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const candidate: Candidate = {
  id: candidateId,
  name: 'Taylor Example',
  email: 'taylor@example.com',
  githubUsername: 'taylor-dev',
  createdAt: '2026-10-10T12:00:00.000+00:00',
  updatedAt: '2026-10-10T12:00:00.000+00:00',
};

describe('candidate database diagnostics', () => {
  it.each([
    [{ code: 'PGRST204', message: 'sensitive column and SQL detail' }, { category: 'schema', code: 'PGRST204' }],
    [{ code: '42703', message: 'sensitive column and SQL detail' }, { category: 'schema', code: '42703' }],
    [{ code: '42501', message: 'sensitive RLS detail' }, { category: 'permission_or_rls', code: '42501' }],
    [{ code: '23514', message: 'sensitive constraint detail' }, { category: 'constraint', code: '23514' }],
    [{ code: 'PGRST116', message: 'sensitive PostgREST detail', status: 406 }, { category: 'postgrest_other', code: 'PGRST116', httpStatus: 406 }],
    [{ code: 'PGRST301', message: 'sensitive JWT detail', status: 401 }, { category: 'invalid_credentials', code: 'PGRST301', httpStatus: 401 }],
    [{ code: '42501', status: 403 }, { category: 'permission_or_rls', code: '42501', httpStatus: 403 }],
    [{ cause: { code: 'ENOTFOUND', hostname: 'secret-hostname.example' } }, { category: 'network_dns_tls', code: 'ENOTFOUND' }],
    [{ cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID' } }, { category: 'network_dns_tls', code: 'ERR_TLS_CERT_ALTNAME_INVALID' }],
    [{ message: 'secret-bearing provider response' }, { category: 'connection_or_unknown' }],
  ])('classifies only safe metadata from a database error', (error, expected) => {
    expect(candidateDatabaseDiagnostic(error)).toEqual(expected);
    expect(JSON.stringify(candidateDatabaseDiagnostic(error))).not.toMatch(/sensitive|secret/i);
  });
});

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

function createTestRepository(): CandidateRepository {
  return {
    create: vi.fn(async (auth, input) => {
      if (auth.userId === otherUserId) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to create the candidate right now');
      return { ...candidate, name: input.name, ...(input.email ? { email: input.email } : {}) };
    }),
    list: vi.fn(async (auth, query) => {
      if (auth.userId === otherUserId) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to list candidates right now');
      return { items: [candidate], page: query.page, pageSize: query.pageSize, total: 1 };
    }),
    get: vi.fn(async (auth, id) => {
      if (auth.userId !== ownerId || id !== candidateId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return candidate;
    }),
    update: vi.fn(async (auth, _id, input) => {
      if (auth.userId !== ownerId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      return { ...candidate, ...('name' in input && input.name ? { name: input.name } : {}) };
    }),
    archive: vi.fn(async (auth) => {
      if (auth.userId !== ownerId) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
    }),
  };
}

describe('candidate API authorization and CRUD', () => {
  let server: Server;
  let origin: string;
  let repository: CandidateRepository;

  beforeAll(async () => {
    repository = createTestRepository();
    const application = express();
    application.use(express.json());
    const auth = createAuthenticate(async (token) => {
      const verifiedRecruiter = (userId: string, approval_status: 'pending' | 'approved' | 'rejected' = 'approved', emailConfirmed = true) => ({
        userId, email: 'recruiter@example.com', emailConfirmed,
        profile: { id: userId, display_name: 'Recruiter', role: 'recruiter' as const, approval_status },
      });
      if (token === 'valid-owner-token') return verifiedRecruiter(ownerId);
      if (token === 'valid-other-token') return verifiedRecruiter(otherUserId);
      if (token === 'pending-token') return verifiedRecruiter(ownerId, 'pending');
      if (token === 'rejected-token') return verifiedRecruiter(ownerId, 'rejected');
      if (token === 'unconfirmed-token') return verifiedRecruiter(ownerId, 'approved', false);
      if (token === 'auth-provider-failure') throw new Error('sensitive provider response');
      return null;
    });
    application.use('/api/candidates', createCandidatesRouter(createCandidateController(repository), auth));
    application.use(errorHandler);
    ({ server, origin } = await startServer(application));
  });

  afterAll(async () => closeServer(server));

  it.each([undefined, 'invalid-token', 'expired-token'])(
    'rejects missing, invalid, or expired credentials (%s)',
    async (token) => {
      const response = await fetch(`${origin}/api/candidates`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    },
  );

  it('handles an authentication provider outage without exposing provider details', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await fetch(`${origin}/api/candidates`, {
        headers: { Authorization: 'Bearer auth-provider-failure' },
      });
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toContain('AUTH_SERVICE_UNAVAILABLE');
      expect(body).not.toContain('sensitive provider response');
      expect(diagnostic).toHaveBeenCalledWith('DevRank authentication verification unavailable', { stage: 'custom_verifier' });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('auth-provider-failure');
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('sensitive provider response');
    } finally {
      diagnostic.mockRestore();
    }
  });

  it.each([
    ['pending-token', 'RECRUITER_APPROVAL_REQUIRED'],
    ['rejected-token', 'APPLICATION_REJECTED'],
    ['unconfirmed-token', 'EMAIL_NOT_CONFIRMED'],
  ])('blocks recruiter endpoints for %s', async (token, code) => {
    const response = await fetch(`${origin}/api/candidates`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it('creates a candidate under the verified user and does not expose ownership fields', async () => {
    const response = await fetch(`${origin}/api/candidates`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor Example', email: 'taylor@example.com', githubUsername: 'taylor-dev' }),
    });
    expect(response.status).toBe(201);
    const body = await response.text();
    const payload: unknown = JSON.parse(body);
    expect(candidateSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      id: candidateId,
      name: 'Taylor Example',
      createdAt: '2026-10-10T12:00:00.000+00:00',
      updatedAt: '2026-10-10T12:00:00.000+00:00',
    });
    expect(body).not.toContain('owner_id');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId, accessToken: 'valid-owner-token' }),
      { name: 'Taylor Example', email: 'taylor@example.com', githubUsername: 'taylor-dev' },
    );
  });

  it('returns a safe database failure when candidate creation cannot be persisted', async () => {
    const response = await fetch(`${origin}/api/candidates`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-other-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Taylor Example' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  });

  it.each([
    { name: 'Candidate', email: 'not-an-email' },
    { name: 'Candidate', githubUsername: 'https://github.com/name' },
    { name: 'Candidate', owner_id: otherUserId },
    { name: '   ' },
  ])('rejects unsupported or invalid create fields: %j', async (body) => {
    const response = await fetch(`${origin}/api/candidates`, {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('lists only the repository scope for the verified owner with bounded pagination', async () => {
    const response = await fetch(`${origin}/api/candidates?page=2&pageSize=10`, {
      headers: { Authorization: 'Bearer valid-owner-token' },
    });
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    expect(candidateListResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({ items: [candidate], page: 2, pageSize: 10, total: 1 });
    expect(repository.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ownerId }),
      { page: 2, pageSize: 10 },
    );
  });

  it('returns an empty page from the list endpoint without inventing candidates', async () => {
    vi.mocked(repository.list).mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 });
    const response = await fetch(`${origin}/api/candidates`, { headers: { Authorization: 'Bearer valid-owner-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('returns the owner candidate details from the authenticated details endpoint', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}`, { headers: { Authorization: 'Bearer valid-owner-token' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(candidate);
    expect(repository.get).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId }), candidateId);
  });

  it('returns not found and requires authentication for candidate details', async () => {
    const missing = await fetch(`${origin}/api/candidates/00000000-0000-4000-8000-000000000001`, { headers: { Authorization: 'Bearer valid-owner-token' } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const unauthenticated = await fetch(`${origin}/api/candidates/${candidateId}`);
    expect(unauthenticated.status).toBe(401);
  });

  it('validates IDs and hides another user candidate as not found', async () => {
    const invalidId = await fetch(`${origin}/api/candidates/not-a-uuid`, {
      headers: { Authorization: 'Bearer valid-owner-token' },
    });
    expect(invalidId.status).toBe(400);

    const otherUser = await fetch(`${origin}/api/candidates/${candidateId}`, {
      headers: { Authorization: 'Bearer valid-other-token' },
    });
    expect(otherUser.status).toBe(404);
    expect(await otherUser.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('updates supported fields and rejects attempts to change protected fields', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer valid-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });
    expect(response.status).toBe(200);
    expect(repository.update).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId }), candidateId, { name: 'Updated Name' });

    const protectedField = await fetch(`${origin}/api/candidates/${candidateId}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer valid-owner-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_id: otherUserId }),
    });
    expect(protectedField.status).toBe(400);
  });

  it('deletes by archiving so candidate history is retained', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer valid-owner-token' },
    });
    expect(response.status).toBe(204);
    expect(repository.archive).toHaveBeenCalledWith(expect.objectContaining({ userId: ownerId }), candidateId);
  });

  it('returns a safe database error to authorized users', async () => {
    const response = await fetch(`${origin}/api/candidates`, {
      headers: { Authorization: 'Bearer valid-other-token' },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  });
});
