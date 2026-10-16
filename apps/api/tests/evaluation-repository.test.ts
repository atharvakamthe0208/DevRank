import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { HttpError } from '../src/middleware/http-error.js';
import { legacyEvaluationResponseV1Schema } from '@devrank/contracts';

const userId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const roleProfileId = 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084';
const auth = { userId, email: 'r@example.com', emailConfirmed: true, accessToken: 'test', profile: { id: userId, display_name: 'R', role: 'recruiter' as const, approval_status: 'approved' as const } };

const legacyResult = legacyEvaluationResponseV1Schema.parse({
  schemaVersion: '1.0.0', candidateId, targetRole: 'software_developer',
  categoryScores: ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'].map((categoryId) => ({
    categoryId, displayName: categoryId.replaceAll('_', ' '), status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical snapshot had insufficient evidence.',
  })),
  roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
  evidence: [], strengths: [], skillGaps: [], recommendations: [],
  missingEvidence: ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'],
  calculationExplanation: 'No overall score was calculated because evidence was incomplete.', evaluationStatus: 'insufficient_evidence',
  aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
  decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
});

describe('evaluation persistence repository', () => {
  it('persists configured-role results and reads the stored snapshot back', async () => {
    const insert = vi.fn();
    let record: Record<string, unknown> | undefined;
    let legacy = false;
    let omitTargetRole = false;
    let evaluationRows: Array<Record<string, unknown>> = [];
    const platformRows: Array<Record<string, unknown>> = [
      {
        id: 'github-row', source: 'github', availability: 'available', created_at: '2026-10-14T12:00:00.000Z', observed_at: '2026-10-14T12:00:00.000Z',
        raw_evidence: { username: 'example', profileUrl: 'https://github.com/example' },
        normalized_evidence: { username: 'example', profileUrl: 'https://github.com/example', publicRepositoryCount: 3, followers: 2, following: 1, repositories: [{ id: 1, name: 'sample', description: 'Sample project', primaryLanguage: 'TypeScript', stars: 0, forks: 0, updatedAt: '2026-10-14T00:00:00.000Z' }], insights: {
          requestedLogin: 'example', attributedLogin: 'example', attributionStatus: 'matched',
          currentYearContributions: { status: 'partial', year: 2026, timezone: 'UTC', periodStart: '2026-01-01T00:00:00.000Z', periodEnd: '2026-12-31T23:59:59.999Z', observedThrough: '2026-10-14T12:00:00.000Z', observedAt: '2026-10-14T12:00:00.000Z', totalContributions: 40, observedWeeks: 42, activeWeeks: 8, activeWeekCoveragePercent: 19.05, contributionsPerObservedWeek: 0.95, contributionTypes: { commits: 10, pullRequestsOpened: 2, issuesOpened: 1, reviewsSubmitted: 3 }, reasons: ['partial_response'] },
          developmentActivity: { status: 'available', totalCommitContributions: 10, activeCommitDays: 8, activeCommitWeeks: 5, repositoriesWithCommitContributions: 2, duplicateDailyRecords: 0, reasons: [] },
          collaboration: { status: 'available', pullRequestsOpened: 2, issuesOpened: 1, reviewsSubmitted: 3, reasons: [] },
          limitations: ['Unverified GitHub account context.'],
        } },
      },
      {
        id: 'leetcode-provider-row', source: 'leetcode', availability: 'available', created_at: '2026-10-14T13:00:00.000Z', observed_at: '2026-10-14T13:00:00.000Z',
        raw_evidence: { provenance: 'alfa_leetcode_api', handle: 'example', profileUrl: 'https://leetcode.com/u/example/' },
        normalized_evidence: { platform: 'leetcode', provenance: 'alfa_leetcode_api', statistics: { problemsSolved: 12, easySolved: 5, contestsAttended: 2, contestRating: 1400 } },
      },
      {
        id: 'leetcode-candidate-row', source: 'leetcode', availability: 'available', created_at: '2026-10-14T11:00:00.000Z', observed_at: null,
        raw_evidence: { provenance: 'candidate_provided', handle: 'example', statistics: { problemsSolved: 10 } },
        normalized_evidence: { platform: 'leetcode', provenance: 'candidate_provided', statistics: { problemsSolved: 10 } },
      },
    ];
    let insertError: { code: string; message: string; details: string } | null = null;
    const client = {
      from: (table: string) => {
        let values: Record<string, unknown> | undefined;
        const query: Record<string, any> = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn(() => query);
        query.is = vi.fn(() => query);
        query.order = vi.fn(() => table === 'evaluations' ? query : Promise.resolve({ data: table === 'platform_evidence' ? platformRows : [], error: null }));
        query.limit = vi.fn(async () => ({ data: evaluationRows, error: null }));
        query.maybeSingle = vi.fn(async () => table === 'candidates'
          ? { data: { id: candidateId, full_name: 'Taylor Example' }, error: null }
          : table === 'role_profiles'
            ? { data: { id: roleProfileId, name: 'software_developer', weights: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 } }, error: null }
          : { data: legacy ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: null, status: 'insufficient_evidence', created_at: '2026-10-12T00:00:00.000Z', evaluation_result: legacyResult } : record ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: omitTargetRole ? null : record.target_role, status: record.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: record.evaluation_result } : null, error: null });
        query.insert = vi.fn((value: Record<string, unknown>) => { values = value; insert(value); return query; });
        query.single = vi.fn(async () => {
          record = values;
          return { data: insertError ? null : { id: evaluationId, candidate_id: candidateId, role_profile_id: values?.role_profile_id ?? null, target_role: values?.target_role, status: values?.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: values?.evaluation_result }, error: insertError };
        });
        return query;
      },
    } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);

    const created = await repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(created.status).toBe('insufficient_evidence');
    expect(created.evaluation).not.toHaveProperty('overallScore');
    expect(created.evaluation.platformEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'github', provenance: 'github_api', verificationStatus: 'unverified', freshness: 'unassessed', categoryMappings: expect.arrayContaining([{ categoryId: 'relevant_project_experience', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'github', evidenceType: 'current_year_contributions', availability: 'partial', categoryMappings: [{ rubricId: 'github_leetcode_proposal_v1', categoryId: 'current_year_contributions', relation: 'supporting' }] }),
      expect.objectContaining({ source: 'github', evidenceType: 'development_activity', categoryMappings: [{ rubricId: 'github_leetcode_proposal_v1', categoryId: 'development_activity', relation: 'supporting' }] }),
      expect.objectContaining({ source: 'github', evidenceType: 'collaboration_activity', categoryMappings: [{ rubricId: 'github_leetcode_proposal_v1', categoryId: 'collaboration', relation: 'supporting' }] }),
      expect.objectContaining({ source: 'leetcode', provenance: 'alfa_leetcode_api', evidenceType: 'solved_statistics', normalizedValue: { statistics: { problemsSolved: 12, easySolved: 5 } }, categoryMappings: expect.arrayContaining([{ categoryId: 'problem_solving_dsa', relation: 'supporting' }, { rubricId: 'github_leetcode_proposal_v1', categoryId: 'problem_solving_dsa', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'leetcode', provenance: 'alfa_leetcode_api', evidenceType: 'contest_statistics', normalizedValue: { statistics: { contestsAttended: 2, contestRating: 1400 } } }),
      expect.objectContaining({ source: 'leetcode', provenance: 'candidate_provided', evidenceType: 'candidate_reported_statistics' }),
    ]));
    expect(created.evaluation.platformEvidence).toHaveLength(7);
    expect(created.evaluation.categoryScores.map(({ categoryId }) => categoryId)).not.toContain('current_year_contributions');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: userId,
      candidate_id: candidateId,
      role_profile_id: null,
      target_role: 'software_developer',
      status: 'insufficient_evidence',
      scoring_version: '3.0.0',
      evidence_snapshot: [],
      role_weights_snapshot: created.role.weights,
      evaluation_result: created.evaluation,
    }));

    insert.mockClear();
    const ownerDefined = await repository.create(auth, candidateId, { roleProfileId });
    expect(ownerDefined).toMatchObject({ roleProfileId, targetRole: 'software_developer', status: 'insufficient_evidence' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: userId, candidate_id: candidateId, role_profile_id: roleProfileId, target_role: 'software_developer',
    }));

    const retrieved = await repository.get(auth, evaluationId);
    expect(retrieved).toMatchObject({ id: evaluationId, candidateId, roleProfileId: null, targetRole: 'software_developer', result: created.evaluation });
    omitTargetRole = true;
    await expect(repository.get(auth, evaluationId)).resolves.toMatchObject({ targetRole: 'software_developer', result: created.evaluation });
    const { scoringVersion: _version, ...resultWithoutVersion } = created.evaluation;
    record = { ...record!, target_role: 'software_developer', evaluation_result: resultWithoutVersion };
    omitTargetRole = false;
    const withoutScoringVersion = await repository.get(auth, evaluationId);
    expect(withoutScoringVersion).toMatchObject({ result: { schemaVersion: '3.0.0' } });
    expect(withoutScoringVersion).not.toHaveProperty('result.scoringVersion');
    record = { ...record!, evaluation_result: { ...resultWithoutVersion, scoringVersion: '9.9.9' } };
    await expect(repository.get(auth, evaluationId)).rejects.toMatchObject({ statusCode: 409, code: 'SCORING_VERSION_UNSUPPORTED' });
    legacy = true;
    const historical = await repository.get(auth, evaluationId);
    expect(historical).toMatchObject({ targetRole: 'software_developer', status: 'insufficient_evidence', result: { schemaVersion: '1.0.0', evaluationStatus: 'insufficient_evidence' } });
    expect(historical).not.toHaveProperty('result.overallScore');

    const secondId = '9d649201-886d-4c46-b99f-8aa2afc0cd6c';
    evaluationRows = [
      { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: null, status: 'insufficient_evidence', created_at: '2026-10-12T00:00:00.000Z', evaluation_result: legacyResult },
      { id: secondId, candidate_id: candidateId, role_profile_id: null, target_role: null, status: 'completed', created_at: '2026-10-11T00:00:00.000Z', evaluation_result: { schemaVersion: 'unknown' } },
    ];
    await expect(repository.listForCandidate(auth, candidateId)).rejects.toMatchObject({ statusCode: 409, code: 'EVALUATION_RESULT_UNAVAILABLE', message: expect.stringContaining(secondId) });

    insertError = { code: 'PGRST204', message: "Could not find the 'target_role' column of 'evaluations' in the schema cache", details: 'private provider detail' };
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(repository.run(auth, { candidateId, roleId: 'software_developer' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'Unable to process the evaluation right now' });
    expect(diagnostic).toHaveBeenCalledWith('Evaluation database operation failed', expect.objectContaining({
      operation: 'evaluation_insert', failureSource: 'supabase_response', category: 'schema', code: 'PGRST204', field: 'target_role',
    }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private provider detail');
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('Could not find');
    diagnostic.mockRestore();
  });

  it('keeps a previous v2 five-weight profile unchanged and rejects it explicitly under v3', async () => {
    const legacyWeights = {
      technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22,
      practical_assessment_performance: 16.67, learning_adaptability: 11.11,
    };
    const from = vi.fn((table: string) => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'candidates'
        ? { data: { id: candidateId, full_name: 'Taylor Example' }, error: null }
        : { data: { id: roleProfileId, name: 'software_developer', weights: legacyWeights }, error: null });
      return query;
    });
    const client = { from } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);

    await expect(repository.create(auth, candidateId, { roleProfileId })).rejects.toMatchObject({
      statusCode: 422,
      code: 'ROLE_PROFILE_REQUIRES_V3_WEIGHTS',
    });
    expect(legacyWeights).toEqual({
      technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22,
      practical_assessment_performance: 16.67, learning_adaptability: 11.11,
    });
    expect(from).not.toHaveBeenCalledWith('platform_evidence');
  });
});
