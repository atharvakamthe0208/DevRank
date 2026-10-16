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
import { candidateIdParamsSchema, evaluationRequestSchema, scoringCategories, type AiAnalysisContent, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import type { EvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { createEvaluationsRouter } from '../src/routes/evaluations.js';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const roleProfileId = 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const auth = { userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', email: 'r@example.com', emailConfirmed: true, accessToken: 'test', profile: { id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', display_name: 'R', role: 'recruiter' as const, approval_status: 'approved' as const } };

describe('evaluation API routes', () => {
  let server: Server;
  let origin: string;
  const categories = scoringCategories.map(({ id, displayName }) => id);
  const created = { id: evaluationId, candidateId, roleProfileId, targetRole: 'software_developer', status: 'insufficient_evidence', createdAt: '2026-10-12T00:00:00.000Z', result: {
    schemaVersion: '3.0.0', scoringVersion: '3.0.0', candidateId, targetRole: 'software_developer',
    categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' })),
    roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
    evidence: [], strengths: [], skillGaps: [], recommendations: ['Collect normalized evidence.'], missingEvidence: categories,
    calculationExplanation: 'No overall score without evidence.', evaluationStatus: 'insufficient_evidence',
    aiExplanation: { summary: 'No AI explanation.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  } };
  const role = { id: 'software_developer' as const, displayName: 'Software Developer', weights: created.result.roleWeightsUsed };
  const runResult = { id: evaluationId, status: 'insufficient_evidence' as const, candidate: { id: candidateId, name: 'Taylor Example' }, role, evaluatedAt: created.createdAt, evaluation: created.result, evidenceLimitations: ['Insufficient rubric-normalized evidence.'] };
  const evidence = scoringCategories.map(({ id }) => ({ evidenceId: `evidence-${id}`, evidenceType: 'project' as const, source: 'candidate_project', description: `Demonstrated ${id}`, normalizedValue: 80, verificationStatus: 'verified' as const, categoryId: id, availability: 'available' as const }));
  const completeEvaluation: PersistedEvaluation = { ...created, status: 'completed', result: { ...created.result, overallScore: 80, evidence, categoryScores: scoringCategories.map(({ id, displayName }, index) => ({ categoryId: id, displayName, score: 80, status: 'scored' as const, evidenceRefs: [evidence[index]!.evidenceId], explanation: 'Verified score.' })), strengths: [], skillGaps: [], recommendations: [], missingEvidence: [], calculationExplanation: 'Calculated from evidence.', evaluationStatus: 'completed' } };
  const legacyCategories = ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'] as const;
  const legacyEvaluation: PersistedEvaluationRead = {
    id: evaluationId, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'completed', createdAt: created.createdAt,
    result: {
      schemaVersion: '1.0.0', candidateId, targetRole: 'software_developer',
      categoryScores: legacyCategories.map((categoryId) => ({ categoryId, displayName: categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical evidence was insufficient.' })),
      roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
      evidence: [], strengths: [], skillGaps: [], recommendations: [], missingEvidence: [...legacyCategories],
      calculationExplanation: 'Historical snapshot omitted an overall score.', evaluationStatus: 'insufficient_evidence',
      aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    },
  };
  const analysis: AiAnalysisContent = { summary: 'Evidence supports the recorded scores.', summaryEvidenceReferences: ['evidence-technical_skills'], strengths: [{ text: 'Demonstrates relevant skills.', evidenceReferences: ['evidence-technical_skills'] }], weaknesses: [], roleRelevance: 'The evidence aligns with the selected role.', roleRelevanceEvidenceReferences: ['relevant_project_experience'], recommendations: [{ text: 'Gather more evidence from assessments.', evidenceReferences: ['practical_assessment_performance'] }] };
  const repository: EvaluationRepository = {
    listRoles: vi.fn(() => ({ roles: [role] })),
    listRoleProfiles: vi.fn(async () => ({ items: [] })),
    listForCandidate: vi.fn(async () => ({ items: [created] })),
    run: vi.fn(async () => runResult),
    create: vi.fn(async () => created),
    get: vi.fn(async () => created),
  };
  const aiService = { analyze: vi.fn(async () => analysis) };

  beforeAll(async () => {
    const app = express(); app.use(express.json());
    const authMiddleware: express.RequestHandler = (req, _res, next) => {
      if (req.get('x-test-auth') === 'missing') { next(); return; }
      req.auth = req.get('x-test-approval') === 'pending'
        ? { ...auth, profile: { ...auth.profile, approval_status: 'pending' } }
        : auth;
      next();
    };
    const controller = createEvaluationController(repository, aiService);
    const candidates = express.Router(); candidates.use(authMiddleware, requireApprovedRecruiter);
    candidates.post('/:id/evaluations', validateParams(candidateIdParamsSchema), validateBody(evaluationRequestSchema), controller.create);
    candidates.get('/:id/evaluations', validateParams(candidateIdParamsSchema), controller.listForCandidate);
    const evaluations = createEvaluationsRouter(controller, authMiddleware);
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
  it('returns validated v1 results read-only and rejects them for current-model AI analysis', async () => {
    vi.mocked(repository.get).mockResolvedValueOnce(legacyEvaluation);
    const read = await fetch(`${origin}/api/evaluations/${evaluationId}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(legacyEvaluation);

    vi.mocked(repository.get).mockResolvedValueOnce(legacyEvaluation);
    const analysisResponse = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(analysisResponse.status).toBe(409);
    expect(await analysisResponse.json()).toMatchObject({ error: { code: 'SCORING_VERSION_UNSUPPORTED' } });
    expect(aiService.analyze).not.toHaveBeenCalled();
  });
  it('serves configured roles and persists configured-role runs through the workflow API', async () => {
    const rolesResponse = await fetch(`${origin}/api/evaluations/roles`);
    expect(rolesResponse.status).toBe(200);
    expect(await rolesResponse.json()).toEqual({ roles: [role] });
    const response = await fetch(`${origin}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, roleId: role.id }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(runResult);
    expect(repository.run).toHaveBeenCalledWith(auth, { candidateId, roleId: role.id });
  });
  it('lists owner-scoped role profiles and candidate evaluation history', async () => {
    vi.mocked(repository.listRoleProfiles).mockResolvedValueOnce({ items: [] });
    const profiles = await fetch(`${origin}/api/evaluations/role-profiles`);
    expect(profiles.status).toBe(200);
    expect(await profiles.json()).toEqual({ items: [] });
    const history = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`);
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({ items: [created] });
    expect(repository.listForCandidate).toHaveBeenCalledWith(auth, candidateId);
  });
  it('rejects invalid request bodies and IDs', async () => {
    const body = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleProfileId, candidateId }) });
    expect(body.status).toBe(400); expect(await body.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    const id = await fetch(`${origin}/api/evaluations/not-a-uuid`);
    expect(id.status).toBe(400);
  });
  it('lists roles and creates a persisted evaluation for the selected role', async () => {
    const roleResponse = await fetch(`${origin}/api/evaluations/roles`);
    expect(roleResponse.status).toBe(200);
    expect(await roleResponse.json()).toEqual({ roles: [role] });
    const response = await fetch(`${origin}/api/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidateId, roleId: 'software_developer' }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(runResult);
    expect(repository.run).toHaveBeenCalledWith(auth, { candidateId, roleId: 'software_developer' });
  });
  it('returns a persistence failure instead of reporting a false success', async () => {
    vi.mocked(repository.create).mockRejectedValueOnce(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now'));
    const response = await fetch(`${origin}/api/candidates/${candidateId}/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ roleProfileId }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
  });
  it('returns a controlled insufficient-evidence status without invoking AI', async () => {
    const response = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'insufficient_evidence', evaluation: created, analysis: null });
    expect(aiService.analyze).not.toHaveBeenCalled();
  });
  it('returns AI analysis separately and preserves the persisted numerical scores', async () => {
    vi.mocked(repository.get).mockResolvedValueOnce(completeEvaluation);
    const response = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: 'completed', evaluation: completeEvaluation, analysis });
    expect(body.evaluation.result.overallScore).toBe(completeEvaluation.result.overallScore);
    expect(body.evaluation.result.categoryScores).toEqual(completeEvaluation.result.categoryScores);
    expect(body.evaluation.result.roleWeightsUsed).toEqual(completeEvaluation.result.roleWeightsUsed);
    expect(aiService.analyze).toHaveBeenCalledWith(completeEvaluation);
  });
  it('rejects caller-supplied scores and evidence', async () => {
    const response = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overallScore: 100, evidence: [] }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });
  it('requires authentication and approved recruiter access', async () => {
    const unauthenticated = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', headers: { 'x-test-auth': 'missing' } });
    expect(unauthenticated.status).toBe(401);
    const pending = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST', headers: { 'x-test-approval': 'pending' } });
    expect(pending.status).toBe(403);
  });
  it('preserves not-found, database, and provider failures as controlled errors', async () => {
    vi.mocked(repository.get).mockRejectedValueOnce(new HttpError(404, 'NOT_FOUND', 'Evaluation not found'));
    const notFound = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(notFound.status).toBe(404);
    vi.mocked(repository.get).mockRejectedValueOnce(new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now'));
    const databaseFailure = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(databaseFailure.status).toBe(503);
    vi.mocked(repository.get).mockResolvedValueOnce(completeEvaluation);
    aiService.analyze.mockRejectedValueOnce(new HttpError(503, 'AI_UNAVAILABLE', 'AI analysis is temporarily unavailable. Please try again.'));
    const providerFailure = await fetch(`${origin}/api/evaluations/${evaluationId}/ai-analysis`, { method: 'POST' });
    expect(providerFailure.status).toBe(503);
    expect(await providerFailure.json()).toMatchObject({ error: { code: 'AI_UNAVAILABLE' } });
  });
});
