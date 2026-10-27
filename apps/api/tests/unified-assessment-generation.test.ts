import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { scoringCategories, screeningCategories, unifiedAssessmentInputVersion } from '@devrank/contracts';
import { createUnifiedReportController } from '../src/controllers/unified-report-controller.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const evaluationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const resumeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const roleWeights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

describe('unified assessment generation from saved evaluations', () => {
  it('retrieves the owner-scoped role evaluation and linked completed resume score, then persists the weighted report', async () => {
    const platformResult = {
      schemaVersion: '4.0.0', scoringVersion: '4.0.1', candidateId, targetRole: 'software_developer', overallScore: 80,
      categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, score: id === 'problem_solving_dsa' ? 0 : 80, status: 'scored', evidenceRefs: [`v4-index:${id}`], explanation: 'Saved score with platform evidence.' })),
      roleWeightsUsed: roleWeights,
      evidence: scoringCategories.map(({ id }) => ({ evidenceId: `v4-index:${id}`, evidenceType: 'other', source: id === 'problem_solving_dsa' ? 'leetcode · alfa_leetcode_api' : 'github · github_api', description: 'Saved source-backed v4 index.', normalizedValue: id === 'problem_solving_dsa' ? 0 : 80, verificationStatus: 'unverified', categoryId: id, availability: 'available' })),
      strengths: [], skillGaps: [], recommendations: [], missingEvidence: [], calculationExplanation: 'Saved v4 role-weighted scores.', evaluationStatus: 'completed',
      aiExplanation: { summary: 'No AI explanation.', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    };
    const savedEvaluation = { id: evaluationId, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'completed', createdAt: '2026-10-25T12:00:00.000Z', result: platformResult };
    const resumeEvaluation = {
      rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: 100, evidenceCoverage: 100,
      categories: screeningCategories.map(({ id, weight }) => ({ categoryId: id, weight, score: 100, weightedContribution: weight, evaluableWeight: weight, status: 'scored', requirementIds: [] })),
      requirements: [],
    };
    const queries: Record<string, any>[] = [];
    const databaseQueries: Record<string, any>[] = [];
    let inserted: Record<string, unknown> | undefined;
    const getClient = vi.fn(() => ({ from: (table: string) => {
      const query: Record<string, any> = { table };
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
      databaseQueries.push(query);
      query.maybeSingle = vi.fn(async () => table === 'resume_screenings'
        ? ({ data: { id: resumeId, status: 'completed', evaluation: resumeEvaluation, preliminary_evaluation: null, screening_sessions: { job_title: 'Software Developer' } }, error: null })
        : ({ data: { result: inserted?.result }, error: null }));
      query.insert = vi.fn((values: Record<string, unknown>) => { inserted = values; query.values = values; queries.push(query); return query; });
      return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => ({ id: candidateId, name: 'Candidate' })) } as never,
      { listForCandidate: vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [savedEvaluation] }; }) } as never,
      { getLatest: vi.fn() } as never,
      getClient as never,
    );
    const response = { status: vi.fn(() => response), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.assess({ auth: { userId: ownerId, accessToken: 'owner-token' }, params: { id: candidateId }, body: { roleId: 'software_developer', resumeId: null } } as unknown as Request, response, next);

    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect(next).not.toHaveBeenCalled();
    expect(queries[0].values).toMatchObject({ owner_id: ownerId, candidate_id: candidateId, role_id: 'software_developer', platform_evaluation_id: evaluationId, resume_screening_id: resumeId, status: 'completed', overall_score: 76 });
    expect(queries[0].values.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const previousFingerprint = createHash('sha256').update(JSON.stringify({ candidateId, roleId: 'software_developer', platformEvaluation: { id: evaluationId, candidateId, roleId: 'software_developer', result: platformResult }, resume: { id: resumeId, status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 100 }, preliminaryScore: null }, screeningResumeId: resumeId })).digest('hex');
    expect(queries[0].values.source_fingerprint).not.toBe(previousFingerprint);
    const resumeLookup = databaseQueries.find((query) => query.table === 'resume_screenings');
    expect(resumeLookup?.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(resumeLookup?.eq).toHaveBeenCalledWith('candidate_id', candidateId);
    expect(unifiedAssessmentInputVersion).toBe('unified-input-1.1.0');
    expect((response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ candidateId, status: 'completed', overallScore: 76, weights: { resume: 40, github: 45, leetcode: 15 }, components: { resume: { score: 100, status: 'validated' }, github: { score: 80, status: 'validated' }, leetcode: { score: 0, status: 'validated' } } });
  });

  it('keeps a saved provisional screening score visible but does not count it as validated resume evidence', async () => {
    const resumeEvaluation = {
      rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: 78, evidenceCoverage: 100,
      categories: screeningCategories.map(({ id, weight }) => ({ categoryId: id, weight, score: 78, weightedContribution: 78 * weight / 100, evaluableWeight: weight, status: 'scored', requirementIds: [] })), requirements: [],
    };
    const provisionalEvaluation = { ...resumeEvaluation, status: 'provisional', score: 44.44 };
    let inserted: Record<string, unknown> | undefined;
    const getClient = vi.fn(() => ({ from: (table: string) => {
      const query: Record<string, any> = { table };
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'resume_screenings'
        ? ({ data: { id: resumeId, status: 'completed', evaluation: provisionalEvaluation, preliminary_evaluation: null, screening_sessions: { job_title: 'Software Developer' } }, error: null })
        : ({ data: { result: inserted?.result }, error: null }));
      query.insert = vi.fn((values: Record<string, unknown>) => { inserted = values; query.values = values; return query; });
      return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => ({ id: candidateId, name: 'Candidate' })) } as never,
      { listForCandidate: vi.fn(async () => ({ items: [] })) } as never,
      { getLatest: vi.fn() } as never,
      getClient as never,
    );
    const response = { status: vi.fn(() => response), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.assess({ auth: { userId: ownerId, accessToken: 'owner-token' }, params: { id: candidateId }, body: { roleId: 'software_developer', resumeId: null } } as unknown as Request, response, next);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1));
    expect(next).not.toHaveBeenCalled();
    expect((response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      status: 'insufficient_evidence', overallScore: null, components: { resume: { score: 44.44, status: 'preliminary' } }, missingComponents: expect.arrayContaining(['resume']),
    });
  });
});
