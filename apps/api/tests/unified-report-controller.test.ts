import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createUnifiedReportController } from '../src/controllers/unified-report-controller.js';
import { evaluationResponseSchema, scoringCategories, finalRubricId, screeningCategories } from '@devrank/contracts';
import { SupabaseConfigurationError } from '../src/config/supabase.js';
import { HttpError } from '../src/middleware/http-error.js';

const recruiterId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const replacementId = '9c649201-886c-4c46-b99f-8aa2afc0cd6c';
const candidate = { id: candidateId, name: 'Taylor Example', email: 'taylor@example.com', createdAt: '2026-10-14T12:00:00.000Z', updatedAt: '2026-10-14T12:00:00.000Z' };
const auth = { userId: recruiterId, email: 'recruiter@example.com', emailConfirmed: true, accessToken: 'private-token', profile: { id: recruiterId, display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const } };

function invoke(controller: ReturnType<typeof createUnifiedReportController>, authValue: typeof auth | undefined = auth) {
  const response = { json: vi.fn() } as unknown as Response;
  const next = vi.fn() as NextFunction;
  controller.get({ auth: authValue, params: { id: candidateId }, query: {} } as unknown as Request, response, next);
  return { response, next };
}

describe('unified candidate report', () => {
  it('saves an insufficient-evidence assessment idempotently against the authenticated candidate scope', async () => {
    const inserted = { data: { result: {
      id: '1fa1c1bb-3c20-4b5c-ab53-437d8c616d28', candidateId, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
      scoringVersion: 'unified-1.0.0', status: 'insufficient_evidence', overallScore: null, weights: { resume: 40, github: 45, leetcode: 15 },
      components: { resume: { score: null, status: 'not_evaluated', sourceId: null, sourceLabel: null }, github: { score: null, status: 'not_evaluated', sourceId: null, sourceLabel: null }, leetcode: { score: null, status: 'not_evaluated', sourceId: null, sourceLabel: null } },
      sourceReferences: { platformEvaluationId: null, resumeScreeningId: null, githubSnapshotIds: [], leetcodeSnapshotIds: [] }, evidenceCompleteness: 0, missingComponents: ['resume', 'github', 'leetcode'],
      strengths: [], improvementAreas: [], limitations: [], explanation: 'No score until validated evidence is available.',
    } }, error: null };
    const queries: Record<string, any>[] = [];
    const getClient = vi.fn(() => ({ from: (table: string) => {
      const query: Record<string, any> = { table };
      for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'resume_screenings' ? ({ data: null, error: null }) : inserted);
      query.insert = vi.fn((values: Record<string, unknown>) => { query.values = values; queries.push(query); return query; });
      return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [] }; }) } as never,
      { getLatest: vi.fn() } as never,
      getClient as never,
    );
    const response = { status: vi.fn(() => response), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.assess({ auth, params: { id: candidateId }, body: { roleId: 'software_developer', resumeId: null } } as unknown as Request, response, next);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    expect(queries[0].values).toMatchObject({ owner_id: recruiterId, candidate_id: candidateId, role_id: 'software_developer', status: 'insufficient_evidence', overall_score: null });
    expect(queries[0].values.source_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ candidateId, overallScore: null, status: 'insufficient_evidence' }));
  });

  it('uses only saved candidate-scoped results and labels unlinked resume data clearly', async () => {
    const candidateGet = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return candidate; });
    const evaluationList = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [] }; });
    const platformGet = vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return { items: [] }; });
    const getClient = vi.fn(() => ({ from: () => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is', 'order']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
      query.limit = vi.fn((count: number) => count === 50 ? Promise.resolve({ data: [], error: null }) : query);
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

  it('returns the saved validated resume score from the owned linked screening row', async () => {
    const requirements = [{ id: 'typescript', categoryId: 'required_technical_skills' as const, description: 'TypeScript', importance: 'required' as const,
      status: 'demonstrated' as const, evidence: [{ excerpt: 'Built production TypeScript services.' }], explanation: 'Direct evidence found.', confidence: 0.95 }];
    const evaluation = { rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: 100,
      evidenceCoverage: 100, categories: screeningCategories.map(({ id, weight }) => ({ categoryId: id, weight, score: 100, weightedContribution: weight, evaluableWeight: weight, status: 'scored', requirementIds: [] })), requirements };
    const resumeId = '5a44e5c8-9c01-4d7c-a9d3-df34dd9a8c84';
    const getClient = vi.fn(() => ({ from: (table: string) => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is', 'order']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'resume_screenings' ? ({ data: {
        id: resumeId, original_filename: 'taylor.pdf', status: 'completed', extracted_data: { candidate: { name: 'Taylor Example' } },
        evaluation, preliminary_evaluation: null, safe_error_message: null, processed_at: '2026-10-24T12:00:00.000Z',
        screening_sessions: { job_title: 'Senior Software Engineer', job_description: 'Build secure APIs and distributed backend services.' },
      }, error: null }) : ({ data: null, error: null }));
      query.limit = vi.fn((count: number) => count === 50 ? Promise.resolve({ data: [], error: null }) : query);
      return query;
    } }) as never);
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn(async () => ({ items: [] })) } as never,
      { getLatest: vi.fn(async () => ({ items: [] })) } as never,
      getClient as never,
    );
    const { response, next } = invoke(controller);
    await vi.waitFor(() => expect((response.json as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    const report = (response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(report.resume).toMatchObject({ id: resumeId, status: 'available', validatedScore: 100, preliminaryScore: null, statusLabel: 'complete' });
    expect(report.resume.evidence).toEqual(['Built production TypeScript services.']);
  });

  it('does not misreport API configuration failure as missing candidate-link schema', async () => {
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn(async () => ({ items: [] })) } as never,
      { getLatest: vi.fn(async () => ({ items: [] })) } as never,
      vi.fn(() => { throw new SupabaseConfigurationError(); }) as never,
    );
    const { next } = invoke(controller);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'SUPABASE_CONFIGURATION_MISSING', statusCode: 503 });
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
      query.maybeSingle = vi.fn(async () => ({ data: null, error: null })); query.limit = vi.fn((count: number) => count === 50 ? Promise.resolve({ data: [], error: null }) : query); return query;
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

  it('replaces a linked resume only through the validated atomic workspace RPC', async () => {
    const replacementId = '9c649201-886c-4c46-b99f-8aa2afc0cd6c';
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const controller = createUnifiedReportController(
      { get: vi.fn(async (_auth, id) => { expect(id).toBe(candidateId); return candidate; }) } as never,
      { listForCandidate: vi.fn() } as never,
      { getLatest: vi.fn() } as never,
      (() => ({ rpc }) as never),
    );
    const response = { json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.replaceResume({ auth, params: { id: candidateId }, body: { resumeId: replacementId } } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledWith({ status: 'replaced', candidateId, resumeId: replacementId }));
    expect(rpc).toHaveBeenCalledWith('replace_candidate_resume_result', { p_candidate_id: candidateId, p_resume_id: replacementId });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not report replacement success when the new result is invalid or unavailable', async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn() } as never,
      { getLatest: vi.fn() } as never,
      (() => ({ rpc }) as never),
    );
    const next = vi.fn() as NextFunction;
    controller.replaceResume({ auth, params: { id: candidateId }, body: { resumeId: '9c649201-886c-4c46-b99f-8aa2afc0cd6c' } } as unknown as Request, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'RESUME_REPLACEMENT_NOT_ALLOWED', statusCode: 409 });
  });

  it('rejects malformed replacement IDs before checking or updating the database', async () => {
    const rpc = vi.fn();
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn() } as never,
      { getLatest: vi.fn() } as never,
      (() => ({ rpc }) as never),
    );
    const next = vi.fn() as NextFunction;
    controller.replaceResume({ auth, params: { id: candidateId }, body: { resumeId: 'not-a-uuid' } } as unknown as Request, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0][0]).toMatchObject({ name: 'ZodError' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('checks candidate ownership before invoking the replacement transaction', async () => {
    const rpc = vi.fn();
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => { throw new HttpError(404, 'NOT_FOUND', 'Candidate not found'); }) } as never,
      { listForCandidate: vi.fn() } as never,
      { getLatest: vi.fn() } as never,
      (() => ({ rpc }) as never),
    );
    const next = vi.fn() as NextFunction;
    controller.replaceResume({ auth, params: { id: candidateId }, body: { resumeId: replacementId } } as unknown as Request, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['missing RPC migration', { code: 'PGRST202', message: 'function cache detail' }, 503, 'RESUME_REPLACEMENT_MIGRATION_REQUIRED'],
    ['database permission error', { code: '42501', message: 'private candidate data' }, 403, 'RESUME_REPLACEMENT_PERMISSION_DENIED'],
    ['unclassified database failure', { code: '08006', message: 'private connection data' }, 503, 'RESUME_REPLACEMENT_FAILED'],
  ])('returns a safe, actionable error for %s', async (_label, dbError, statusCode, code) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rpc = vi.fn(async () => ({ data: null, error: dbError }));
    const controller = createUnifiedReportController(
      { get: vi.fn(async () => candidate) } as never,
      { listForCandidate: vi.fn() } as never,
      { getLatest: vi.fn() } as never,
      (() => ({ rpc }) as never),
    );
    const next = vi.fn() as NextFunction;
    controller.replaceResume({ auth, params: { id: candidateId }, body: { resumeId: replacementId } } as unknown as Request, {} as Response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode, code });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    if (dbError.code === 'PGRST202') expect(next.mock.calls[0][0].message).toContain('Apply the latest DevRank resume replacement migration');
    log.mockRestore();
  });
});
