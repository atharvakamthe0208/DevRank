import { once } from 'node:events';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireApprovedRecruiter } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createInsightsController } from '../src/controllers/insights-controller.js';
import { createInsightsRouter } from '../src/routes/insights.js';
import type { InsightsRepository } from '../src/repositories/insights-repository.js';
import { calculateUnifiedAssessment, screeningCategories, scoringCategories } from '@devrank/contracts';

const ownerId = '11111111-1111-4111-8111-111111111111';
const candidateA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const candidateB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const evaluationA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const evaluationB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const screeningEvaluation = (score: number, status: 'complete' | 'provisional' = 'complete') => ({
  rubricVersion: 'resume-job-match-1.0.0' as const,
  scoreType: 'resume_job_match' as const,
  status,
  score,
  evidenceCoverage: 100,
  categories: screeningCategories.map(({ id, weight }) => ({ categoryId: id, weight, score, weightedContribution: score * weight / 100, evaluableWeight: weight, status: 'scored' as const, requirementIds: [] })),
  requirements: [],
});

describe('dashboard, comparison, and ranking routes', () => {
  it('validates shared request contracts and applies approved-recruiter authentication to all endpoints', async () => {
    const repository: InsightsRepository = {
      dashboard: vi.fn(async () => ({ candidateCount: 0, evaluationCount: 0, statusCounts: { pending: 0, in_progress: 0, completed: 0, insufficient_evidence: 0, failed: 0 }, recentEvaluations: [] })),
      compare: vi.fn(async () => ({ roleId: 'software_developer', scoringVersion: '1.0.0', items: [] })),
      ranking: vi.fn(async () => ({ roleId: 'software_developer', scoringVersion: '1.0.0', items: [], page: 1, pageSize: 20, total: 0, excluded: { incomplete: 0, scoringVersionMismatch: 0, missingScore: 0, invalidSnapshot: 0 } })),
    };
    const unifiedQuery: Record<string, any> = {};
    for (const method of ['select', 'eq', 'order']) unifiedQuery[method] = vi.fn(() => unifiedQuery);
    unifiedQuery.range = vi.fn(async () => ({ data: [], error: null }));
    const getClient = vi.fn(() => ({ from: vi.fn(() => unifiedQuery) }) as never);
    const app = express(); app.use(express.json());
    const authMiddleware: express.RequestHandler = (req, _res, next) => {
      if (req.get('x-test-auth') !== 'missing') req.auth = {
        userId: ownerId, email: 'owner@example.com', emailConfirmed: true, accessToken: 'test-token',
        profile: { id: ownerId, display_name: 'Owner', role: 'recruiter', approval_status: req.get('x-test-approval') === 'pending' ? 'pending' : 'approved' },
      };
      next();
    };
    app.use('/api', createInsightsRouter(createInsightsController(repository, getClient as never), authMiddleware, requireApprovedRecruiter));
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
      const unifiedRanking = await fetch(`${origin}/rankings/unified?roleId=software_developer`);
      expect(unifiedRanking.status).toBe(200);
      expect(await unifiedRanking.json()).toMatchObject({ roleId: 'software_developer', total: 0, ranked: 0, items: [] });
      expect(unifiedQuery.eq).toHaveBeenCalledWith('owner_id', ownerId);
      const unauthenticated = await fetch(`${origin}/dashboard`, { headers: { 'x-test-auth': 'missing' } });
      expect(unauthenticated.status).toBe(401);
      const pending = await fetch(`${origin}/rankings?roleId=software_developer`, { headers: { 'x-test-approval': 'pending' } });
      expect(pending.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('returns saved validated resume scores in Insights and rejects assessment data attached to another candidate ID', async () => {
    const platformResult = {
      scoringVersion: '4.0.1', targetRole: 'software_developer', roleWeightsUsed: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      categoryScores: scoringCategories.map(({ id }) => ({ categoryId: id, score: id === 'problem_solving_dsa' ? 0 : 80, status: 'scored', evidenceRefs: [`ref-${id}`] })),
      evidence: scoringCategories.map(({ id }) => ({ evidenceId: `ref-${id}`, categoryId: id, source: id === 'problem_solving_dsa' ? 'leetcode · alfa_leetcode_api' : 'github · github_api', availability: 'available', normalizedValue: id === 'problem_solving_dsa' ? 0 : 80 })),
      platformEvidence: [], strengths: [], skillGaps: [],
    };
    const assessment = calculateUnifiedAssessment({
      id: evaluationA, candidateId: candidateA, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
      platformEvaluation: { id: evaluationB, candidateId: candidateA, roleId: 'software_developer', result: platformResult },
      resume: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 100 }, preliminaryScore: null },
    });
    const atharvaAssessment = calculateUnifiedAssessment({
      id: '22222222-2222-4222-8222-222222222222', candidateId: candidateB, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
      platformEvaluation: { id: evaluationB, candidateId: candidateB, roleId: 'software_developer', result: platformResult },
      resume: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'completed', jobTitle: 'Software Developer', evaluation: screeningEvaluation(88.89), preliminaryScore: null },
    });
    const candidateC = '99999999-9999-4999-8999-999999999999';
    const rows = [
      { id: 'row-akshay', candidate_id: candidateA, created_at: '2026-10-25T12:00:00.000Z', result: assessment, candidates: { full_name: 'Akshay Nazare', github_username: 'akshay-gh', leetcode_username: 'akshay-lc' } },
      { id: 'row-atharva', candidate_id: candidateB, created_at: '2026-10-25T12:00:00.000Z', result: atharvaAssessment, candidates: { full_name: 'Atharva Kamthe', github_username: 'atharva-gh', leetcode_username: 'atharva-lc' } },
      { id: 'row-cross-candidate', candidate_id: candidateC, created_at: '2026-10-25T12:01:00.000Z', result: assessment, candidates: { full_name: 'Wrong Candidate', github_username: 'wrong-gh', leetcode_username: 'wrong-lc' } },
    ];
    const query: Record<string, any> = {};
    for (const method of ['select', 'eq', 'order']) query[method] = vi.fn(() => query);
    query.range = vi.fn(async () => ({ data: rows, error: null }));
    const resumeQuery: Record<string, any> = {};
    for (const method of ['select', 'eq']) resumeQuery[method] = vi.fn(() => resumeQuery);
    resumeQuery.in = vi.fn(async () => ({ data: [
      { id: 'resume-akshay', candidate_id: candidateA, owner_id: ownerId, original_filename: 'akshay.pdf', status: 'completed', extracted_data: {}, evaluation: screeningEvaluation(100), preliminary_evaluation: null, safe_error_message: null, processed_at: '2026-10-25T12:00:00.000Z', screening_sessions: { job_title: 'Software Developer', job_description: 'Build software.' } },
      { id: 'resume-atharva', candidate_id: candidateB, owner_id: ownerId, original_filename: 'atharva.pdf', status: 'completed', extracted_data: {}, evaluation: screeningEvaluation(88.89), preliminary_evaluation: null, safe_error_message: null, processed_at: '2026-10-25T12:00:00.000Z', screening_sessions: { job_title: 'Software Developer', job_description: 'Build software.' } },
      { id: 'resume-cross-candidate', candidate_id: candidateC, owner_id: ownerId, original_filename: 'not-the-candidate.pdf', status: 'completed', evaluation: screeningEvaluation(12), preliminary_evaluation: null, safe_error_message: null, processed_at: '2026-10-25T12:00:00.000Z', screening_sessions: { job_title: 'Software Developer', job_description: 'Build software.' } },
    ], error: null }));
    const getClient = vi.fn(() => ({ from: vi.fn((table: string) => table === 'unified_assessments' ? query : resumeQuery) }) as never);
    const controller = createInsightsController(undefined, getClient);
    const response = { set: vi.fn(), json: vi.fn() };
    const next = vi.fn();
    controller.unifiedRanking({ auth: {
      userId: ownerId, accessToken: 'scoped-token', email: 'recruiter@example.com', emailConfirmed: true,
      profile: { id: ownerId, display_name: 'Recruiter', role: 'recruiter', approval_status: 'approved' },
    }, query: { roleId: 'software_developer' } } as never, response as never, next as never);
    await vi.waitFor(() => expect(response.json.mock.calls.length + next.mock.calls.length).toBe(1));
    expect(next, String(next.mock.calls[0]?.[0])).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(query.eq).toHaveBeenCalledWith('role_id', 'software_developer');
    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(resumeQuery.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(resumeQuery.in).toHaveBeenCalledWith('candidate_id', [candidateA, candidateB]);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      total: 2, ranked: 2, items: expect.arrayContaining([
        expect.objectContaining({ candidateName: 'Akshay Nazare', githubUsername: 'akshay-gh', leetcodeUsername: 'akshay-lc', resumeScore: 100, assessment: expect.objectContaining({ candidateId: candidateA, overallScore: 76 }) }),
        expect.objectContaining({ candidateName: 'Atharva Kamthe', githubUsername: 'atharva-gh', leetcodeUsername: 'atharva-lc', resumeScore: 88.89, assessment: expect.objectContaining({ candidateId: candidateB, overallScore: 71.56 }) }),
      ]),
    }));
  });

  it('does not expose provisional, failed, role-mismatched, or missing linked resume scores as validated', async () => {
    const candidateC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const candidateD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const platformResult = {
      scoringVersion: '4.0.1', targetRole: 'software_developer', roleWeightsUsed: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      categoryScores: scoringCategories.map(({ id }) => ({ categoryId: id, score: 80, status: 'scored', evidenceRefs: [`ref-${id}`] })),
      evidence: scoringCategories.map(({ id }) => ({ evidenceId: `ref-${id}`, categoryId: id, source: id === 'problem_solving_dsa' ? 'leetcode · alfa_leetcode_api' : 'github · github_api', availability: 'available', normalizedValue: 80 })),
      platformEvidence: [], strengths: [], skillGaps: [],
    };
    const candidateAssessment = (id: string) => calculateUnifiedAssessment({
      id: id === candidateC ? '22222222-2222-4222-8222-222222222222' : '33333333-3333-4333-8333-333333333333', candidateId: id, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
      platformEvaluation: { id: evaluationB, candidateId: id, roleId: 'software_developer', result: platformResult },
      resume: { id: evaluationA, status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'provisional', score: 62 }, preliminaryScore: 62 },
    });
    const rows = [candidateC, candidateD].map((id) => ({ id: `row-${id}`, candidate_id: id, created_at: '2026-10-25T12:00:00.000Z', result: candidateAssessment(id), candidates: { full_name: id === candidateC ? 'Candidate C' : 'Candidate D', github_username: null, leetcode_username: null } }));
    const query: Record<string, any> = {};
    for (const method of ['select', 'eq', 'order']) query[method] = vi.fn(() => query);
    query.range = vi.fn(async () => ({ data: rows, error: null }));
    const resumeQuery: Record<string, any> = {};
    for (const method of ['select', 'eq']) resumeQuery[method] = vi.fn(() => resumeQuery);
    resumeQuery.in = vi.fn(async () => ({ data: [
      { candidate_id: candidateC, owner_id: ownerId, status: 'completed', evaluation: screeningEvaluation(62, 'provisional'), screening_sessions: { job_title: 'Software Developer' } },
      { candidate_id: candidateC, owner_id: ownerId, status: 'failed', evaluation: screeningEvaluation(90), screening_sessions: { job_title: 'Software Developer' } },
      { candidate_id: candidateC, owner_id: ownerId, status: 'completed', evaluation: screeningEvaluation(90), screening_sessions: { job_title: 'Product Designer' } },
    ], error: null }));
    const getClient = vi.fn(() => ({ from: vi.fn((table: string) => table === 'unified_assessments' ? query : resumeQuery) }) as never);
    const response = { set: vi.fn(), json: vi.fn() };
    const next = vi.fn();
    createInsightsController(undefined, getClient).unifiedRanking({ auth: {
      userId: ownerId, accessToken: 'scoped-token', email: 'recruiter@example.com', emailConfirmed: true,
      profile: { id: ownerId, display_name: 'Recruiter', role: 'recruiter', approval_status: 'approved' },
    }, query: { roleId: 'software_developer' } } as never, response as never, next as never);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ items: expect.arrayContaining([
      expect.objectContaining({ resumeScore: null, assessment: expect.objectContaining({ candidateId: candidateC, components: expect.objectContaining({ resume: expect.objectContaining({ score: 62, status: 'preliminary' }) }) }) }),
      expect.objectContaining({ resumeScore: null, assessment: expect.objectContaining({ candidateId: candidateD }) }),
    ]) }));
  });
});
