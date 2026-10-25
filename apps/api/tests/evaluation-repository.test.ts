import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { HttpError } from '../src/middleware/http-error.js';
import { buildProposedEvaluationReport, legacyEvaluationResponseV1Schema, parseProposedPlatformEvidence } from '@devrank/contracts';

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
const legacyResultSnapshot = JSON.stringify(legacyResult);

function githubEvidenceRows() {
  return [{
    id: 'github-complete-row', source: 'github', availability: 'available',
    created_at: '2026-10-20T12:00:00.000Z', observed_at: '2026-10-20T12:00:00.000Z',
    raw_evidence: { username: 'example', profileUrl: 'https://github.com/example' },
    normalized_evidence: {
      publicRepositoryCount: 3, repositoriesTruncated: false,
      repositories: [
        { name: 'one', primaryLanguage: 'TypeScript', stars: 0, forks: 0 },
        { name: 'two', primaryLanguage: 'Python', stars: 0, forks: 0 },
        { name: 'three', primaryLanguage: null, stars: 0, forks: 0 },
      ],
      insights: {
        currentYearContributions: { status: 'available', year: 2026, timezone: 'UTC', totalContributions: 0, observedWeeks: 20, activeWeeks: 0, activeWeekCoveragePercent: 0, observedThrough: '2026-10-20T12:00:00.000Z' },
        developmentActivity: { status: 'available', totalCommitContributions: 5, activeCommitDays: 2, activeCommitWeeks: 1, repositoriesWithCommitContributions: 1 },
        collaboration: { status: 'available', pullRequestsOpened: 0, issuesOpened: 0, reviewsSubmitted: 0 },
      },
    },
  }];
}

function repositoryWithSnapshots(leetcodeUsername: string | null, platformRows: Array<Record<string, unknown>>) {
  let inserted: Record<string, unknown> | undefined;
  const from = vi.fn((table: string) => {
    const query: Record<string, any> = {};
    for (const method of ['select', 'eq', 'is']) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: { id: candidateId, full_name: 'Taylor Example', leetcode_username: leetcodeUsername }, error: null }));
    query.order = vi.fn(async () => ({ data: platformRows, error: null }));
    query.insert = vi.fn((value: Record<string, unknown>) => { inserted = value; return query; });
    query.single = vi.fn(async () => ({ data: {
      id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: 'software_developer',
      status: inserted?.status, created_at: '2026-10-20T13:00:00.000Z', evaluation_result: inserted?.evaluation_result,
    }, error: null }));
    return query;
  });
  const client = { from } as unknown as SupabaseClient;
  return { repository: createEvaluationRepository(() => client), from, getInserted: () => inserted };
}

describe('evaluation persistence repository', () => {
  it('reports unexpected processing failures as sanitized application errors, not database outages', async () => {
    const sensitiveDetail = 'candidate-private-value-do-not-log';
    const brokenRow = new Proxy({}, {
      get(_target, key) {
        if (key === 'source') throw new TypeError(sensitiveDetail);
        return undefined;
      },
    });
    const client = {
      from: (table: string) => {
        const query: Record<string, any> = {};
        for (const method of ['select', 'eq', 'is']) query[method] = vi.fn(() => query);
        query.maybeSingle = vi.fn(async () => ({ data: { id: candidateId, full_name: 'Taylor Example' }, error: null }));
        query.order = vi.fn(async () => ({ data: table === 'platform_evidence' ? [brokenRow] : [], error: null }));
        query.insert = vi.fn(() => query);
        query.single = vi.fn(async () => ({ data: null, error: null }));
        return query;
      },
    } as unknown as SupabaseClient;
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const repository = createEvaluationRepository(() => client);

    await expect(repository.run(auth, { candidateId, roleId: 'software_developer' })).rejects.toMatchObject({
      statusCode: 500, code: 'EVALUATION_PROCESSING_FAILED', message: 'Unable to prepare the evaluation right now',
    });
    expect(diagnostic).toHaveBeenCalledWith('Evaluation processing failed', {
      stage: 'evidence_normalization', errorType: 'TypeError',
    });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(sensitiveDetail);
    diagnostic.mockRestore();
  });

  it('persists configured-role results and reads the stored snapshot back', async () => {
    const insert = vi.fn();
    const updates = vi.fn();
    let record: Record<string, unknown> | undefined;
    let legacy = false;
    let omitTargetRole = false;
    let evaluationRows: Array<Record<string, unknown>> = [];
    const platformSelects: string[] = [];
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
        raw_evidence: { provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example', profileUrl: 'https://leetcode.com/u/example/' },
        normalized_evidence: { platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example', profileUrl: 'https://leetcode.com/u/example/', statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: 92, hardSolved: 16, contestsAttended: 2, contestRating: 1400 } },
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
        query.select = vi.fn((columns?: string) => { if (table === 'platform_evidence' && columns) platformSelects.push(columns); return query; });
        query.eq = vi.fn(() => query);
        query.is = vi.fn(() => query);
        query.order = vi.fn(() => table === 'evaluations' ? query : Promise.resolve({ data: table === 'platform_evidence' ? platformRows : [], error: null }));
        query.limit = vi.fn(async () => ({ data: evaluationRows, error: null }));
        query.maybeSingle = vi.fn(async () => table === 'candidates'
          ? { data: { id: candidateId, full_name: 'Taylor Example' }, error: null }
          : table === 'role_profiles'
            ? { data: { id: roleProfileId, name: 'software_developer', weights: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 } }, error: null }
          : { data: legacy ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: null, status: 'insufficient_evidence', created_at: '2026-10-12T00:00:00.000Z', evaluation_result: legacyResult } : record ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: omitTargetRole ? null : record.target_role, status: record.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: record.evaluation_result } : null, error: null });
        query.insert = vi.fn((value: Record<string, unknown>) => { values = value; insert(value); return query; });
        query.update = vi.fn((value: unknown) => { updates(value); return query; });
        query.single = vi.fn(async () => {
          record = values;
          return { data: insertError ? null : { id: evaluationId, candidate_id: candidateId, role_profile_id: values?.role_profile_id ?? null, target_role: values?.target_role, status: values?.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: values?.evaluation_result }, error: insertError };
        });
        return query;
      },
    } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);

    const created = await repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(updates).not.toHaveBeenCalled();
    expect(platformSelects).toContain('id,source,availability,raw_evidence,normalized_evidence,observed_at,created_at');
    expect(JSON.stringify(legacyResult)).toBe(legacyResultSnapshot);
    expect(created.status).toBe('insufficient_evidence');
    expect(created.evaluation).not.toHaveProperty('overallScore');
    expect(created.evaluation.platformEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'github', provenance: 'github_api', verificationStatus: 'unverified', freshness: 'unassessed', categoryMappings: expect.arrayContaining([{ categoryId: 'project_portfolio', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'github', evidenceType: 'current_year_contributions', availability: 'partial', categoryMappings: expect.arrayContaining([{ rubricId: 'github_leetcode_v4', categoryId: 'current_year_contributions', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'github', evidenceType: 'development_activity', categoryMappings: expect.arrayContaining([{ rubricId: 'github_leetcode_v4', categoryId: 'development_activity', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'github', evidenceType: 'collaboration_activity', categoryMappings: expect.arrayContaining([{ rubricId: 'github_leetcode_v4', categoryId: 'collaboration', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'leetcode', provenance: 'alfa_leetcode_api', evidenceType: 'solved_statistics', normalizedValue: { statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: 92, hardSolved: 16 } }, categoryMappings: expect.arrayContaining([{ categoryId: 'problem_solving_dsa', relation: 'supporting' }, { rubricId: 'github_leetcode_v4', categoryId: 'problem_solving_dsa', relation: 'supporting' }]) }),
      expect.objectContaining({ source: 'leetcode', provenance: 'alfa_leetcode_api', evidenceType: 'contest_statistics', normalizedValue: { statistics: { contestsAttended: 2, contestRating: 1400 } } }),
      expect.objectContaining({ source: 'leetcode', provenance: 'candidate_provided', evidenceType: 'candidate_reported_statistics' }),
    ]));
    expect(created.evaluation.platformEvidence).toHaveLength(7);
    expect(created.evaluation.categoryScores.map(({ categoryId }) => categoryId)).toContain('current_year_contributions');
    expect(created.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({ status: 'scored', score: 100 });
    const proposal = buildProposedEvaluationReport(parseProposedPlatformEvidence(created.evaluation.platformEvidence));
    expect(created.evaluation.finalReport).toEqual(proposal);
    expect(proposal.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({
      status: 'scored', score: 100, metrics: {
        easySolved: 100, mediumSolved: 92, hardSolved: 16, difficultyWeightedSolved: 332,
        scoringBasis: 'Difficulty-weighted count (easy=1, medium=2, hard=3)',
      },
    });
    expect(proposal.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')?.formula).toContain('caps at 100 once count reaches 300');
    expect(proposal.notice).toContain('threshold needs future calibration');
    expect(platformRows[1]?.normalized_evidence).toMatchObject({ statistics: { easySolved: 100, mediumSolved: 92, hardSolved: 16 } });
    expect(created.evaluation.schemaVersion).toBe('4.0.0');
    expect(created.evaluation.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ categoryId: 'problem_solving_dsa', normalizedValue: 100, source: 'leetcode · alfa_leetcode_api' })]));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: userId,
      candidate_id: candidateId,
      role_profile_id: null,
      target_role: 'software_developer',
      status: 'insufficient_evidence',
      scoring_version: '4.0.1',
      evidence_snapshot: created.evaluation.evidence,
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
    expect(withoutScoringVersion).toMatchObject({ result: { schemaVersion: '4.0.0' } });
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

  it('keeps a previous v2 five-weight profile unchanged and rejects it explicitly under v4', async () => {
    const legacyWeights = {
      technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22,
      practical_assessment_performance: 16.67, learning_adaptability: 11.11,
    };
    let profileWeights: unknown = legacyWeights;
    const from = vi.fn((table: string) => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'candidates'
        ? { data: { id: candidateId, full_name: 'Taylor Example' }, error: null }
        : { data: { id: roleProfileId, name: 'software_developer', weights: profileWeights }, error: null });
      return query;
    });
    const client = { from } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);

    await expect(repository.create(auth, candidateId, { roleProfileId })).rejects.toMatchObject({
      statusCode: 422,
      code: 'ROLE_PROFILE_REQUIRES_V4_WEIGHTS',
    });
    profileWeights = { project_portfolio: 25, technical_skills: 15, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };
    await expect(repository.create(auth, candidateId, { roleProfileId })).rejects.toMatchObject({
      statusCode: 422,
      code: 'ROLE_PROFILE_REQUIRES_V4_WEIGHTS',
      message: expect.stringContaining('20/20/15/10/10/25'),
    });
    expect(legacyWeights).toEqual({
      technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22,
      practical_assessment_performance: 16.67, learning_adaptability: 11.11,
    });
    expect(from).not.toHaveBeenCalledWith('platform_evidence');
  });

  it('scores absent optional LeetCode as zero with GitHub evidence, but leaves a configured unsynced profile unscored', async () => {
    const withoutLeetCode = repositoryWithSnapshots(null, githubEvidenceRows());
    const completed = await withoutLeetCode.repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(completed.status).toBe('completed');
    expect(completed.evaluation.scoringVersion).toBe('4.0.1');
    expect(completed.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')).toMatchObject({ status: 'scored', score: 40 });
    expect(completed.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'current_year_contributions')).toMatchObject({ status: 'scored', score: 0 });
    expect(completed.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({
      status: 'scored', score: 0, scoreBasis: 'optional_missing_zero', evidenceRefs: [],
    });
    expect(completed.evaluation.evidence.some(({ categoryId }) => categoryId === 'problem_solving_dsa')).toBe(false);
    expect(completed.evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({
      status: 'scored', score: 0, metrics: { scoringBasis: expect.stringContaining('Optional LeetCode profile not provided') },
    });
    expect(withoutLeetCode.getInserted()).toMatchObject({ status: 'completed', overall_score: completed.evaluation.overallScore });
    const expectedOverall = Number(completed.evaluation.categoryScores.reduce((sum, category) => sum + (category.score ?? 0) * completed.role.weights[category.categoryId] / 100, 0).toFixed(2));
    expect(completed.evaluation.overallScore).toBe(expectedOverall);

    const configuredNoSnapshot = repositoryWithSnapshots('candidate-handle', githubEvidenceRows());
    const incomplete = await configuredNoSnapshot.repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(incomplete.status).toBe('insufficient_evidence');
    expect(incomplete.evaluation).not.toHaveProperty('overallScore');
    expect(incomplete.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({
      status: 'insufficient_evidence', explanation: expect.stringContaining('no saved statistics snapshot'),
    });
    expect(incomplete.evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({ status: 'unavailable' });
  });

  it('does not turn an unavailable saved LeetCode response into the missing-profile zero', async () => {
    const leetcodeUnavailable = {
      id: 'leetcode-unavailable-row', source: 'leetcode', availability: 'unavailable',
      created_at: '2026-10-20T12:30:00.000Z', observed_at: '2026-10-20T12:30:00.000Z',
      raw_evidence: { provenance: 'alfa_leetcode_api', handle: 'candidate-handle' },
      normalized_evidence: { platform: 'leetcode', provenance: 'alfa_leetcode_api', statistics: {} },
    };
    const repository = repositoryWithSnapshots('candidate-handle', [...githubEvidenceRows(), leetcodeUnavailable]);
    const result = await repository.repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(result.status).toBe('insufficient_evidence');
    expect(result.evaluation).not.toHaveProperty('overallScore');
    expect(result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).toMatchObject({
      status: 'insufficient_evidence', explanation: expect.stringContaining('saved LeetCode snapshot has no usable solved statistics'),
    });
    expect(result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')).not.toHaveProperty('scoreBasis');
  });

  it('scores a complete GitHub repository snapshot with no observed languages as a technical-skills zero', async () => {
    const rows = githubEvidenceRows();
    const normalized = rows[0]!.normalized_evidence as { repositories: Array<Record<string, unknown>> };
    normalized.repositories = normalized.repositories.map((repository) => ({ ...repository, primaryLanguage: null }));
    const repository = repositoryWithSnapshots(null, rows);
    const result = await repository.repository.run(auth, { candidateId, roleId: 'software_developer' });
    const technicalSkills = result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')!;
    expect(technicalSkills).toMatchObject({ status: 'scored', score: 0, evidenceRefs: ['v4-index:technical_skills'] });
    expect(result.evaluation.overallScore).toBeDefined();
    expect(result.evaluation.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: 'technical_skills', normalizedValue: 0, availability: 'available' }),
    ]));
  });

  it('scores full language evidence from all saved repositories even when report details are condensed to ten', async () => {
    const rows = githubEvidenceRows();
    const normalized = rows[0]!.normalized_evidence as Record<string, any>;
    normalized.publicRepositoryCount = 15;
    normalized.repositoriesTruncated = false;
    normalized.repositories = Array.from({ length: 15 }, (_, index) => ({
      name: `repo-${index + 1}`, primaryLanguage: index % 2 ? 'Python' : 'TypeScript',
    }));
    normalized.languageSummary = {
      totalEligibleRepositories: 15, repositoriesAnalyzed: 15,
      observedLanguages: ['Python', 'TypeScript'], repositoriesMissingLanguage: 0, coverageStatus: 'complete',
    };
    const result = await repositoryWithSnapshots(null, rows).repository.run(auth, { candidateId, roleId: 'software_developer' });
    const technical = result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')!;
    const technicalReport = result.evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === 'technical_skills')!;
    const repoEvidence = result.evaluation.platformEvidence?.find(({ evidenceType }) => evidenceType === 'repository_snapshot')!;
    expect(technical).toMatchObject({ status: 'scored', score: 40 });
    expect(technicalReport.metrics).toMatchObject({
      repositoriesAnalyzed: 15, totalEligibleRepositories: 15, languagesObserved: 'Python, TypeScript', languageCoverageStatus: 'complete',
    });
    expect(repoEvidence.normalizedValue.repositories).toHaveLength(10);
    expect(repoEvidence.normalizedValue.languageSummary).toMatchObject({ repositoriesAnalyzed: 15, coverageStatus: 'complete' });
  });

  it('retains partial language counts and explains why Technical Skills remains unscored', async () => {
    const rows = githubEvidenceRows();
    const normalized = rows[0]!.normalized_evidence as Record<string, any>;
    normalized.publicRepositoryCount = 18;
    normalized.repositoriesTruncated = true;
    normalized.repositories = Array.from({ length: 15 }, (_, index) => ({
      name: `repo-${index + 1}`, primaryLanguage: index % 2 ? 'Python' : 'TypeScript',
    }));
    const result = await repositoryWithSnapshots(null, rows).repository.run(auth, { candidateId, roleId: 'software_developer' });
    const technical = result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')!;
    const technicalReport = result.evaluation.finalReport?.categories.find(({ categoryId }) => categoryId === 'technical_skills')!;
    expect(technical).toMatchObject({ status: 'insufficient_evidence' });
    expect(technical.score).toBeUndefined();
    expect(technical.explanation).toContain('15 of 18 eligible repositories were analyzed');
    expect(technicalReport.metrics).toMatchObject({
      repositoriesAnalyzed: 15, totalEligibleRepositories: 18, languageCoverageStatus: 'partial',
    });
    expect(result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'project_portfolio')?.status).toBe('scored');
  });

  it('retains the stored 4.0.0 result unchanged when reading historical evaluations', async () => {
    const oldResult = {
      schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId, targetRole: 'software_developer',
      categoryScores: ['project_portfolio', 'technical_skills', 'development_activity', 'collaboration', 'current_year_contributions', 'problem_solving_dsa'].map((categoryId) => ({
        categoryId, displayName: categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Stored v4.0.0 result.',
      })),
      roleWeightsUsed: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      evidence: [], strengths: [], skillGaps: [], recommendations: [],
      missingEvidence: ['project_portfolio', 'technical_skills', 'development_activity', 'collaboration', 'current_year_contributions', 'problem_solving_dsa'],
      calculationExplanation: 'Stored v4.0.0 result.', evaluationStatus: 'insufficient_evidence',
      aiExplanation: { summary: 'No AI.', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    };
    const from = vi.fn((table: string) => {
      const query: Record<string, any> = {};
      for (const method of ['select', 'eq', 'is']) query[method] = vi.fn(() => query);
      query.maybeSingle = vi.fn(async () => table === 'candidates'
        ? { data: { id: candidateId, full_name: 'Taylor Example', leetcode_username: null }, error: null }
        : { data: { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: 'software_developer', status: 'insufficient_evidence', created_at: '2026-10-19T00:00:00.000Z', evaluation_result: oldResult }, error: null });
      return query;
    });
    const client = { from } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);
    const saved = await repository.get(auth, evaluationId);
    expect(saved).toMatchObject({ status: 'insufficient_evidence', result: { scoringVersion: '4.0.0', calculationExplanation: 'Stored v4.0.0 result.' } });
    expect(saved.result).toEqual(oldResult);
  });
});
