import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { requireApprovedRecruiter } from '../src/middleware/authenticate.js';
import { HttpError } from '../src/middleware/http-error.js';
import { validateBody } from '../src/middleware/validate-body.js';
import { validateParams } from '../src/middleware/validate-request.js';
import { createEvaluationController } from '../src/controllers/evaluation-controller.js';
import { candidateIdParamsSchema, evaluationIdParamsSchema, evaluationRequestSchema, scoringCategories } from '@devrank/contracts';
import type { EvaluationRepository } from '../src/repositories/evaluation-repository.js';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const roleProfileId = 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const auth = { userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', email: 'r@example.com', emailConfirmed: true, accessToken: 'test', profile: { id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', display_name: 'R', role: 'recruiter' as const, approval_status: 'approved' as const } };

describe('evaluation API routes', () => {
  let server: Server;
  let origin: string;
  const categories = scoringCategories.map(({ id, displayName }) => id);
  const created = { id: evaluationId, candidateId, roleProfileId, status: 'insufficient_evidence', createdAt: '2026-10-12T00:00:00.000Z', result: {
    schemaVersion: '2.0.0', scoringVersion: '2.0.0', candidateId, targetRole: 'software_developer',
    categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' })),
    roleWeightsUsed: { technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22, practical_assessment_performance: 16.67, learning_adaptability: 11.11 },
    evidence: [], strengths: [], skillGaps: [], recommendations: ['Collect normalized evidence.'], missingEvidence: categories,
    calculationExplanation: 'No overall score without evidence.', evaluationStatus: 'insufficient_evidence',
    aiExplanation: { summary: 'No AI explanation.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  } };
  const repository: EvaluationRepository = { listRoleProfiles: vi.fn(async () => ({ items: [] })), listForCandidate: vi.fn(async () => ({ items: [created] })), create: vi.fn(async () => created), get: vi.fn(async () => created) };

  beforeAll(async () => {
    const app = express(); app.use(express.json());
    const authMiddleware: express.RequestHandler = (req, _res, next) => { req.auth = auth; next(); };
    const controller = createEvaluationController(repository);
    const candidates = express.Router(); candidates.use(authMiddleware, requireApprovedRecruiter);
    candidates.post('/:id/evaluations', validateParams(candidateIdParamsSchema), validateBody(evaluationRequestSchema), controller.create);
    candidates.get('/:id/evaluations', validateParams(candidateIdParamsSchema), controller.listForCandidate);
    const evaluations = express.Router(); evaluations.use(authMiddleware, requireApprovedRecruiter);
    evaluations.get('/role-profiles', controller.listRoleProfiles);
    evaluations.get('/:id', validateParams(evaluationIdParamsSchema), controller.get);
    app.use('/api/candidates', candidates); app.use('/api/evaluations', evaluations); app.use(errorHandler);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  it('creates and retrieves a persisted insufficient-evidence evaluation', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleProfileId }) });
    expect(response.status).toBe(201); expect(await response.json()).toEqual(created);
    const read = await fetch(`${origin}/api/evaluations/${evaluationId}`);
    expect(read.status).toBe(200); expect(await read.json()).toEqual(created);
    expect(repository.create).toHaveBeenCalledWith(auth, candidateId, { roleProfileId });
    expect(repository.get).toHaveBeenCalledWith(auth, evaluationId);
  });
  it('lists saved evaluation results for the candidate', async () => {
    const response = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [created] });
    expect(repository.listForCandidate).toHaveBeenCalledWith(auth, candidateId);
  });
  it('loads the recruiter’s configured role profiles without manufacturing defaults', async () => {
    vi.mocked(repository.listRoleProfiles).mockResolvedValueOnce({ items: [{ id: roleProfileId, name: 'software_developer', description: null, usable: true, targetRole: 'software_developer', weights: { technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22, practical_assessment_performance: 16.67, learning_adaptability: 11.11 } }] });
    const response = await fetch(`${origin}/api/evaluations/role-profiles`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ id: roleProfileId, usable: true, targetRole: 'software_developer' }] });
  });
  it('rejects invalid request bodies and IDs', async () => {
    const body = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleProfileId, candidateId }) });
    expect(body.status).toBe(400); expect(await body.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const id = await fetch(`${origin}/api/evaluations/not-a-uuid`);
    expect(id.status).toBe(400);
  });
  it('returns a persistence failure instead of reporting a false success', async () => {
    vi.mocked(repository.create).mockRejectedValueOnce(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now'));
    const response = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleProfileId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  });
});
