import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { calculateUnifiedAssessment, scoringCategories } from '@devrank/contracts';
import { createInsightsController } from '../src/controllers/insights-controller.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const weights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };
const assessment = calculateUnifiedAssessment({
  id: '11111111-1111-4111-8111-111111111112', candidateId, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
  platformEvaluation: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', candidateId, roleId: 'software_developer', result: {
    scoringVersion: '4.0.1', targetRole: 'software_developer', roleWeightsUsed: weights,
    categoryScores: scoringCategories.map(({ id }) => ({ categoryId: id, score: 80, status: 'scored', evidenceRefs: [`evidence-${id}`] })),
    evidence: scoringCategories.map(({ id }) => ({ evidenceId: `evidence-${id}`, categoryId: id, source: id === 'problem_solving_dsa' ? 'leetcode' : 'github', availability: 'available', normalizedValue: 80 })),
    platformEvidence: [], strengths: [], skillGaps: [],
  } },
  resume: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 70 }, preliminaryScore: null },
});

describe('unified assessment ranking API controller', () => {
  it('loads only the authenticated owner and selected role, then returns validated saved results', async () => {
    const query: Record<string, any> = {};
    for (const method of ['select', 'eq', 'order']) query[method] = vi.fn(() => query);
    query.range = vi.fn(async () => ({ data: [{ candidate_id: candidateId, result: assessment, candidates: { full_name: 'Taylor Example', github_username: 'taylor-gh', leetcode_username: 'taylor-lc' } }], error: null }));
    const from = vi.fn(() => query);
    const getClient = vi.fn(() => ({ from }) as never);
    const controller = createInsightsController({} as never, getClient as never);
    const response = { set: vi.fn(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.unifiedRanking({ auth: { userId: ownerId, accessToken: 'token', email: 'owner@example.com', emailConfirmed: true, profile: null }, query: { roleId: 'software_developer' } } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    expect(response.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(from).toHaveBeenCalledWith('unified_assessments');
    expect(query.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(query.eq).toHaveBeenCalledWith('role_id', 'software_developer');
    expect(query.order).toHaveBeenNthCalledWith(2, 'id', { ascending: false });
    expect(query.select).toHaveBeenCalledWith('id,candidate_id,created_at,result,candidates!inner(full_name,github_username,leetcode_username)');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ roleId: 'software_developer', ranked: 1, total: 1, items: [expect.objectContaining({ candidateName: 'Taylor Example', githubUsername: 'taylor-gh', leetcodeUsername: 'taylor-lc', rank: 1, assessment })] }));
  });
});
