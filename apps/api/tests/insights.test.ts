import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireApprovedRecruiter } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createInsightsController } from '../src/controllers/insights-controller.js';
import { createInsightsRouter } from '../src/routes/insights.js';
import type { InsightsRepository } from '../src/repositories/insights-repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const candidateA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const candidateB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const evaluationA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const evaluationB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('dashboard, comparison, and ranking routes', () => {
  it('validates shared request contracts and applies approved-recruiter authentication to all endpoints', async () => {
    const repository: InsightsRepository = {
      dashboard: vi.fn(async () => ({ candidateCount: 0, evaluatedCandidateIds: [], evaluationCount: 0, statusCounts: { pending: 0, in_progress: 0, completed: 0, insufficient_evidence: 0, failed: 0 }, recentEvaluations: [] })),
      compare: vi.fn(async () => ({ roleId: 'software_developer', scoringVersion: '1.0.0', items: [] })),
      ranking: vi.fn(async () => ({ roleId: 'software_developer', scoringVersion: '1.0.0', items: [], candidateRows: [], page: 1, pageSize: 20, total: 0, excluded: { incomplete: 0, scoringVersionMismatch: 0, missingScore: 0, invalidSnapshot: 0 } })),
    };
    const app = express(); app.use(express.json());
    const authMiddleware: express.RequestHandler = (req, _res, next) => {
      if (req.get('x-test-auth') !== 'missing') req.auth = {
        userId: ownerId, email: 'owner@example.com', emailConfirmed: true, accessToken: 'test-token',
        profile: { id: ownerId, display_name: 'Owner', role: 'recruiter', approval_status: req.get('x-test-approval') === 'pending' ? 'pending' : 'approved' },
      };
      next();
    };
    app.use('/api', createInsightsRouter(createInsightsController(repository), authMiddleware, requireApprovedRecruiter));
    app.use(errorHandler);
    const server: Server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server address');
    const origin = `http://127.0.0.1:${address.port}/api`;
    try {
      const dashboard = await fetch(`${origin}/dashboard`);
      expect(dashboard.status).toBe(200);
      expect(repository.dashboard).toHaveBeenCalled();
      const badComparison = await fetch(`${origin}/comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateIds: [candidateA], evaluationIds: [evaluationA] }) });
      expect(badComparison.status).toBe(400);
      const comparison = await fetch(`${origin}/comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }) });
      expect(comparison.status).toBe(200);
      expect(repository.compare).toHaveBeenCalledWith(expect.anything(), { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] });
      const ranking = await fetch(`${origin}/rankings?roleId=software_developer&page=1&pageSize=20`);
      expect(ranking.status).toBe(200);
      expect(repository.ranking).toHaveBeenCalledWith(expect.anything(), { roleId: 'software_developer', page: 1, pageSize: 20 });
      const providerRanking = await fetch(`${origin}/rankings/github-leetcode?roleId=software_developer`);
      expect(providerRanking.status).toBe(200);
      expect(repository.providerRanking).toHaveBeenCalledWith(expect.anything(), { roleId: 'software_developer', page: 1, pageSize: 20 });
      const clientScore = await fetch(`${origin}/rankings/github-leetcode?roleId=software_developer&combinedScore=100`);
      expect(clientScore.status).toBe(400);
      expect(repository.providerRanking).toHaveBeenCalledTimes(1);
      const unauthenticated = await fetch(`${origin}/dashboard`, { headers: { 'x-test-auth': 'missing' } });
      expect(unauthenticated.status).toBe(401);
      const pending = await fetch(`${origin}/rankings?roleId=software_developer`, { headers: { 'x-test-approval': 'pending' } });
      expect(pending.status).toBe(403);
      const pendingProvider = await fetch(`${origin}/rankings/github-leetcode?roleId=software_developer`, { headers: { 'x-test-approval': 'pending' } });
      expect(pendingProvider.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
