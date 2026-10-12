import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEvaluationController } from '../src/controllers/evaluation-controller.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createAuthenticate } from '../src/middleware/authenticate.js';
import { createEvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { createEvaluationsRouter } from '../src/routes/evaluations.js';

const candidateId = 'cbf18ffc-62e5-4e02-b66e-8792749027bc';
const ownerId = 'abf18ffc-62e5-4e02-b66e-8792749027bc';

async function startServer(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test address');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

describe('evaluation API', () => {
  let server: Server;
  let origin: string;
  const query = {
    select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(),
  };
  query.select.mockImplementation(() => query);
  query.eq.mockImplementation(() => query);
  query.is.mockImplementation(() => query);
  query.maybeSingle.mockResolvedValue({ data: { id: candidateId, full_name: 'Taylor Example' }, error: null });
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const repository = createEvaluationRepository(() => client);

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const auth = createAuthenticate(async (token) => token === 'approved-token' ? {
      userId: ownerId,
      email: 'recruiter@example.com',
      emailConfirmed: true,
      profile: { id: ownerId, display_name: 'Recruiter', role: 'recruiter', approval_status: 'approved' },
    } : null);
    app.use('/api/evaluations', createEvaluationsRouter(createEvaluationController(repository), auth));
    app.use(errorHandler);
    ({ server, origin } = await startServer(app));
  });

  afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  it('loads roles from the validated authoritative scoring configuration', async () => {
    const response = await fetch(`${origin}/api/evaluations/roles`, { headers: { Authorization: 'Bearer approved-token' } });
    expect(response.status).toBe(200);
    const body = await response.json() as { roles: Array<{ id: string; weights: Record<string, number> }> };
    expect(body.roles.map(({ id }) => id)).toEqual(['software_developer', 'ai_ml_engineer', 'data_analyst']);
    expect(Object.keys(body.roles[0].weights)).toHaveLength(6);
  });

  it('runs deterministic scoring and reports all six categories as unscored without rubric evidence', async () => {
    const response = await fetch(`${origin}/api/evaluations`, {
      method: 'POST', headers: { Authorization: 'Bearer approved-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, roleId: 'software_developer' }),
    });
    expect(response.status).toBe(200);
    const result = await response.json() as { evaluation: { categoryScores: Array<{ status: string }>; overallScore?: number; evaluationStatus: string }; role: { id: string } };
    expect(result.role.id).toBe('software_developer');
    expect(result.evaluation.categoryScores).toHaveLength(6);
    expect(result.evaluation.categoryScores.every(({ status }) => status === 'insufficient_evidence')).toBe(true);
    expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
    expect(result.evaluation).not.toHaveProperty('overallScore');
    expect(query.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(query.eq).toHaveBeenCalledWith('id', candidateId);
  });

  it('requires authentication and approved recruiter status', async () => {
    expect((await fetch(`${origin}/api/evaluations/roles`)).status).toBe(401);
    const pendingAuth = createAuthenticate(async () => ({
      userId: ownerId, email: 'recruiter@example.com', emailConfirmed: true,
      profile: { id: ownerId, display_name: 'Recruiter', role: 'recruiter', approval_status: 'pending' },
    }));
    const pendingApp = express();
    pendingApp.use('/api/evaluations', createEvaluationsRouter(createEvaluationController(repository), pendingAuth));
    pendingApp.use(errorHandler);
    const pending = await startServer(pendingApp);
    try {
      const denied = await fetch(`${pending.origin}/api/evaluations/roles`, { headers: { Authorization: 'Bearer pending-token' } });
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ error: { code: 'RECRUITER_APPROVAL_REQUIRED' } });
    } finally {
      await new Promise<void>((resolve, reject) => pending.server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects unsupported roles and malformed request bodies', async () => {
    const response = await fetch(`${origin}/api/evaluations`, {
      method: 'POST', headers: { Authorization: 'Bearer approved-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId, roleId: 'not-a-supported-role' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
});
