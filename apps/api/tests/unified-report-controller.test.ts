import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createUnifiedReportController } from '../src/controllers/unified-report-controller.js';
import { evaluationResponseSchema, scoringCategories, finalRubricId } from '@devrank/contracts';

const recruiterId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const candidate = { id: candidateId, name: 'Taylor Example', email: 'taylor@example.com', createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' };
const auth = { userId: recruiterId, email: 'recruiter@example.com', emailConfirmed: true, accessToken: 'private-token', profile: { id: recruiterId, display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const } };

function invoke(controller: ReturnType<typeof createUnifiedReportController>, authValue: typeof auth | undefined = auth) {
  const response = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as NextFunction;
  controller.get({ auth: authValue, params: { id: candidateId } } as unknown as Request, response, next);
  return { response, next };
}

describe('unified candidate report', () => {
  it('uses only saved candidate-scoped results and labels unlinked resume data clearly', async () => {
    const candidateGet = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return candidate; });
    const evaluationList = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [] }; });
    const platformGet = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [] }; });
    const getClient = vi.fn(() => ({ from: () => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is', 'order']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      query.limit = vi.fn(async () => ({ data: [], error: null }));
      return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: candidateGet } as never,
      { listForCandidate: evaluationList } as never,
      { getLatest: platformGet } as never,
      getClient as never,
    );
    const { response, next } = invoke(controller);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    const report = (response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(report.candidate).toEqual(candidate);
    expect(report.platformEvaluation).toMatchObject({ status: 'not_evaluated', overallIndex: null });
    expect(report.sources.github.status).toBe('not_evaluated');
    expect(report.sources.leetcode.status).toBe('not_evaluated');
    expect(report.resume).toMatchObject({ status: 'unlinked', validatedScore: null, preliminaryScore: null });
    expect(report.resume.message).toContain('No resume screening has been explicitly associated');
    expect(candidateGet).toHaveBeenCalledWith(auth, candidateId);
    expect(evaluationList).toHaveBeenCalledWith(auth, candidateId);
    expect(platformGet).toHaveBeenCalledWith(auth, candidateId);
  });

  it('rejects a request without recruiter authentication', async () => {
    const controller = createUnifiedReportController(
      { get: vi.fn() } as never, { listForCandidate: vi.fn() } as never, { getLatest: vi.fn() } as never,
    );
    const { next } = invoke(controller, undefined);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(candidate).toEqual(expect.objectContaining({ name: 'Taylor Example' }));
  });

  it('keeps saved GitHub and LeetCode snapshots separate and withholds an unsupported combined score', async () => {
    const observedAt = '2026-10-14T12:00:00.000Z';
    const platformEvidence = [
      { evidenceId: 'github-snapshot', candidateId, source: 'github', evidenceType: 'repository_snapshot', availability: 'available', observedAt, normalizedValue: { publicRepositoryCount: 4 }, verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed', limitations: ['Public repository data does not verify identity.'], categoryMappings: [{ rubricId: finalRubricId, categoryId: 'project_portfolio', relation: 'supporting' }] },
      { evidenceId: 'leetcode-snapshot', candidateId, source: 'leetcode', evidenceType: 'solved_statistics', availability: 'available', observedAt, normalizedValue: { statistics: { problemsSolved: 8 } }, verificationStatus: 'unverified', provenance: 'alfa_leetcode_api', freshness: 'unassessed', limitations: ['Unofficial provider.'], categoryMappings: [{ rubricId: finalRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' }] },
    ];
    const result = evaluationResponseSchema.parse({
      schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId, targetRole: 'software_developer',
      categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Required source evidence was not available for this category.' })),
      roleWeightsUsed: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      evidence: [], platformEvidence, confidence: 0, strengths: [], skillGaps: [], recommendations: [],
      missingEvidence: scoringCategories.map(({ id }) => id), calculationExplanation: 'No total because source coverage is incomplete.',
      evaluationStatus: 'insufficient_evidence', aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    });
    const savedEvaluation = { id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'insufficient_evidence', createdAt: observedAt, result };
    const getClient = vi.fn(() => ({ from: () => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is', 'order']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => ({ data: null, error: null })); query.limit = vi.fn(async () => ({ data: [], error: null })); return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn(async () => ({ items: [savedEvaluation] })) } as never,
      { getLatest: vi.fn(async () => ({ items: [] })) } as never,
      getClient as never,
    );
    const { response } = invoke(controller);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce());
    const report = (response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(report.sources.github).toMatchObject({ status: 'available', provenance: 'github_api', capturedAt: observedAt });
    expect(report.sources.leetcode).toMatchObject({ status: 'available', provenance: 'alfa_leetcode_api', capturedAt: observedAt });
    expect(report.platformEvaluation).toMatchObject({ status: 'insufficient_evidence', overallIndex: null });
  });

  it('attaches only an owned, completed result after explicit recruiter selection', async () => {
    const resumeId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
    const query: Record<string, any> = {};
    for (const method of ['eq', 'is', 'in', 'select']) query[method] = vi.fn(() => query);
    query.update = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: { id: resumeId }, error: null }));
    const from = vi.fn(() => query);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn(async () => ({ items: [] })) } as never,
      { getLatest: vi.fn(async () => ({ items: [] })) } as never,
      (() => ({ from }) as never),
    );
    const response = { status: vi.fn(() => response), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.linkResume({ auth, params: { id: candidateId }, body: { resumeId } } as unknown as Request, response, next);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ status: 'linked', candidateId, resumeId }));
    expect(query.update).toHaveBeenCalledWith({ candidate_id: candidateId });
    expect(query.eq).toHaveBeenCalledWith('owner_id', recruiterId);
    expect(query.in).toHaveBeenCalledWith('status', ['completed', 'failed']);
    expect(query.is).toHaveBeenCalledWith('candidate_id', null);
    expect(next).not.toHaveBeenCalled();
  });
});
