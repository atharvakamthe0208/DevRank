import { describe, expect, it } from 'vitest';
import { buildFinalEvaluationReport, scoringCategories, type AuthContext, type PlatformEvaluationEvidence } from '@devrank/contracts';
import { scoreCandidate } from '../src/modules/scoring/index.js';
import { createInsightsRepository } from '../src/repositories/insights-repository.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const candidateA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const candidateB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const evaluationA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const evaluationB = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const role = 'software_developer';
const auth: AuthContext = { userId: ownerId, email: 'owner@example.com', emailConfirmed: true, accessToken: 'test-token', profile: { id: ownerId, display_name: 'Owner', role: 'recruiter', approval_status: 'approved' } };

function result(candidateId: string, normalizedValue = 80, targetRole = role) {
  return scoreCandidate({
    candidateId, targetRole,
    evidence: scoringCategories.map(({ id }, index) => ({
      evidenceId: `${candidateId}-${index}`, evidenceType: 'project', source: 'candidate_project',
      description: `Rubric evidence for ${id}`, normalizedValue, verificationStatus: 'verified',
      categoryId: id, availability: 'available',
    })),
  });
}

function evaluation(overrides: Record<string, unknown> = {}) {
  const candidateId = overrides.candidate_id as string ?? candidateA;
  const snapshot = overrides.evaluation_result ?? result(candidateId);
  return {
    id: evaluationA, candidate_id: candidateId, status: 'completed', overall_score: 80,
    scoring_version: '4.0.1', target_role: role, evaluation_result: snapshot,
    role_weights_snapshot: typeof snapshot === 'object' && snapshot !== null && 'roleWeightsUsed' in snapshot ? snapshot.roleWeightsUsed : null,
    created_at: '2026-10-13T00:00:00.000Z', owner_id: ownerId, ...overrides,
  };
}

function fakeClient({ evaluations = [], candidates = [] }: { evaluations?: Array<Record<string, unknown>>; candidates?: Array<Record<string, unknown>> }) {
  const makeBuilder = (table: string) => {
    const filters = new Map<string, unknown>();
    let ordering: Array<{ column: string; ascending: boolean }> = [];
    let limit: number | undefined;
    let options: { count?: string; head?: boolean } | undefined;
    const builder: Record<string, unknown> = {
      select: (_columns: string, selectOptions?: { count?: string; head?: boolean }) => { options = selectOptions; return builder; },
      eq: (column: string, value: unknown) => { filters.set(column, value); return builder; },
      is: (column: string, value: unknown) => { filters.set(column, value); return builder; },
      in: (column: string, value: unknown[]) => { filters.set(column, value); return builder; },
      order: (column: string, options: { ascending: boolean }) => { ordering.push({ column, ascending: options.ascending }); return builder; },
      limit: (value: number) => { limit = value; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => {
        try {
          const source = table === 'evaluations' ? evaluations : candidates;
          const rows = source.filter((row) => [...filters].every(([column, value]) => {
            const rowValue = row[column];
            if (Array.isArray(value)) return value.includes(rowValue);
            if (column === 'archived_at' && value === null) return rowValue == null;
            return rowValue === value;
          }));
          for (const order of [...ordering].reverse()) rows.sort((left, right) => {
            const compare = String(left[order.column] ?? '').localeCompare(String(right[order.column] ?? ''));
            return order.ascending ? compare : -compare;
          });
          const value = options?.head ? { data: null, error: null, count: rows.length }
            : { data: limit === undefined ? rows : rows.slice(0, limit), error: null, count: rows.length };
          return Promise.resolve(value).then(resolve, reject);
        } finally { /* each query owns its filters and ordering */ }
      },
    };
    return builder;
  };
  return { from(name: string) { return makeBuilder(name); } };
}

function repository(evaluations: Array<Record<string, unknown>> = [], candidates: Array<Record<string, unknown>> = []) {
  const client = fakeClient({ evaluations, candidates });
  return createInsightsRepository(() => client as never);
}

describe('insights repository', () => {
  it('builds an owner-scoped dashboard and does not turn incomplete data into a score', async () => {
    const rows = [
      evaluation(),
      evaluation({ id: evaluationB, candidate_id: candidateB, status: 'insufficient_evidence', overall_score: null,
        scoring_version: null, target_role: undefined, evaluation_result: undefined, created_at: '2026-10-12T00:00:00.000Z' }),
    ];
    const repo = repository(rows, [
      { id: candidateA, full_name: 'Candidate A', owner_id: ownerId, archived_at: null },
      { id: candidateB, full_name: 'Candidate B', owner_id: ownerId, archived_at: null },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Other owner', owner_id: otherOwner, archived_at: null },
    ]);
    const dashboard = await repo.dashboard(auth);
    expect(dashboard).toMatchObject({ candidateCount: 2, evaluationCount: 2, statusCounts: { completed: 1, insufficient_evidence: 1 } });
    expect(dashboard.recentEvaluations[0]).toMatchObject({ candidateId: candidateA, candidateName: 'Candidate A', score: 80 });
    expect(dashboard.recentEvaluations[1]).not.toHaveProperty('score');
    expect(dashboard.recentEvaluations.map(({ candidateName }) => candidateName)).not.toContain('Other owner');
  });

  it('includes final rubric report values from saved evidence without changing active dashboard scores', async () => {
    const savedEvidence: PlatformEvaluationEvidence[] = [{
        evidenceId: 'github-row:current-year', candidateId: candidateA, source: 'github', evidenceType: 'current_year_contributions',
        availability: 'partial', observedAt: '2026-10-17T00:00:00.000Z', normalizedValue: { year: 2026, timezone: 'UTC', totalContributions: 44, observedThrough: '2026-10-16T23:59:59.999Z' },
        verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed', limitations: [],
      categoryMappings: [{ rubricId: 'github_leetcode_v4', categoryId: 'current_year_contributions', relation: 'supporting' }],
      }];
    const finalReport = buildFinalEvaluationReport(savedEvidence);
    const saved = { ...scoreCandidate({ candidateId: candidateA, targetRole: role, evidence: [] }), platformEvidence: savedEvidence, finalReport };
    const repo = repository([evaluation({ status: 'insufficient_evidence', overall_score: null, evaluation_result: saved })], [
      { id: candidateA, full_name: 'Candidate A', owner_id: ownerId, archived_at: null },
    ]);
    const dashboard = await repo.dashboard(auth);
    expect(dashboard.recentEvaluations[0]).not.toHaveProperty('score');
    expect(dashboard.recentEvaluations[0]?.finalReport?.status).toBe('partial');
    expect(dashboard.recentEvaluations[0]?.finalReport?.categories.find(({ categoryId }) => categoryId === 'project_portfolio')?.status).toBe('unavailable');
    expect(dashboard.recentEvaluations[0]?.finalReport?.categories.find(({ categoryId }) => categoryId === 'current_year_contributions')).toMatchObject({ status: 'partial', metrics: { totalContributions: 44 } });
    expect(dashboard.recentEvaluations[0]?.finalReport).not.toHaveProperty('overallScore');
  });

  it('does not omit an unknown persisted status from dashboard totals', async () => {
    const repo = repository([evaluation({ status: 'paused' })]);
    await expect(repo.dashboard(auth)).rejects.toMatchObject({ statusCode: 409, code: 'EVALUATION_STATUS_UNSUPPORTED' });
  });

  it('compares only owned snapshots and rejects cross-role or cross-version comparisons', async () => {
    const repo = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA, role_profile_id: null, evaluation_result: result(candidateA) }),
      evaluation({ id: evaluationB, candidate_id: candidateB, role_profile_id: '99999999-9999-4999-8999-999999999999', overall_score: 90, evaluation_result: result(candidateB, 90) }),
    ]);
    const comparison = await repo.compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] });
    expect(comparison).toMatchObject({ roleId: role, scoringVersion: '4.0.1', items: [{ candidateId: candidateA }, { candidateId: candidateB }] });

    const mixedRole = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA }),
      evaluation({ id: evaluationB, candidate_id: candidateB, target_role: 'data_analyst', evaluation_result: result(candidateB, 80, 'data_analyst') }),
    ]);
    await expect(mixedRole.compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ROLE_VERSION_MISMATCH' });

    const mixedVersion = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA }),
      evaluation({ id: evaluationB, candidate_id: candidateB, scoring_version: '1.0.0' }),
    ]);
    await expect(mixedVersion.compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'SCORING_VERSION_MISMATCH' });

    const differentWeights = { ...result(candidateB), roleWeightsUsed: { ...result(candidateB).roleWeightsUsed, project_portfolio: 19, technical_skills: 21 } };
    const mixedWeights = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA }),
      evaluation({ id: evaluationB, candidate_id: candidateB, evaluation_result: differentWeights }),
    ]);
    await expect(mixedWeights.compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ROLE_CONFIGURATION_MISMATCH' });
  });

  it('rejects incomplete and other-owner comparisons without returning their records', async () => {
    const incomplete = evaluation({ status: 'failed', evaluation_result: null });
    const otherComplete = evaluation({ id: evaluationB, candidate_id: candidateB });
    await expect(repository([incomplete, otherComplete]).compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }))
      .rejects.toMatchObject({ statusCode: 422, code: 'EVALUATION_INCOMPLETE' });
    const missing = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA, status: 'failed', evaluation_result: null }),
      evaluation({ id: evaluationB, candidate_id: candidateB, owner_id: otherOwner }),
    ]);
    await expect(missing.compare(auth, { candidateIds: [candidateA, candidateB], evaluationIds: [evaluationA, evaluationB] }))
      .rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('ranks only latest compatible completed evaluations, with stable ties and pagination', async () => {
    const candidateC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const evaluationC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const candidateD = '12345678-1234-4234-8234-123456789012';
    const evaluationD = '87654321-4321-4321-8321-210987654321';
    const rows = [
      evaluation({ id: evaluationA, candidate_id: candidateA, overall_score: 90, evaluation_result: result(candidateA, 90), created_at: '2026-10-13T00:00:00.000Z' }),
      evaluation({ id: evaluationB, candidate_id: candidateB, overall_score: 90, evaluation_result: result(candidateB, 90), created_at: '2026-10-13T00:00:00.000Z' }),
      evaluation({ id: evaluationC, candidate_id: candidateC, status: 'insufficient_evidence', overall_score: null, evaluation_result: null, created_at: '2026-10-14T00:00:00.000Z' }),
      evaluation({ id: evaluationD, candidate_id: candidateD, scoring_version: '1.0.0', evaluation_result: result(candidateD), created_at: '2026-10-14T00:00:00.000Z' }),
    ];
    const repo = repository(rows, [
      { id: candidateA, full_name: 'Candidate A', github_username: 'github-a', leetcode_username: 'leetcode-a', owner_id: ownerId, archived_at: null },
      { id: candidateB, full_name: 'Candidate B', github_username: 'github-b', leetcode_username: null, owner_id: ownerId, archived_at: null },
      { id: candidateC, full_name: 'Candidate C', github_username: null, leetcode_username: null, owner_id: ownerId, archived_at: null },
      { id: candidateD, full_name: 'Candidate D', github_username: null, leetcode_username: null, owner_id: ownerId, archived_at: null },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Other recruiter', github_username: 'private-gh', leetcode_username: null, owner_id: otherOwner, archived_at: null },
    ]);
    const first = await repo.ranking(auth, { roleId: role, page: 1, pageSize: 1 });
    const second = await repo.ranking(auth, { roleId: role, page: 2, pageSize: 1 });
    expect(first.items[0]?.candidateId).toBe(candidateA);
    expect(first.items[0]?.rank).toBe(1);
    expect(second.items[0]?.candidateId).toBe(candidateB);
    expect(second.items[0]?.rank).toBe(2);
    expect(first.total).toBe(2);
    expect(first.excluded.incomplete).toBe(1);
    expect(first.candidateRows.map(({ candidateId }) => candidateId)).toEqual([candidateA, candidateB, candidateC, candidateD]);
    expect(first.candidateRows[0]).toMatchObject({ candidateName: 'Candidate A', githubUsername: 'github-a', leetcodeUsername: 'leetcode-a', rank: 1, finalScore: 90 });
    expect(first.candidateRows.find(({ candidateId }) => candidateId === candidateC)).toMatchObject({ rank: null, finalScore: null, evaluationStatus: 'insufficient_evidence' });
    expect(first.candidateRows.map(({ candidateName }) => candidateName)).not.toContain('Other recruiter');
  });

  it('does not attach an evaluation snapshot to a different candidate ID', async () => {
    const repo = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA, evaluation_result: result(candidateB) }),
    ], [
      { id: candidateA, full_name: 'Candidate A', owner_id: ownerId, archived_at: null },
    ]);
    const response = await repo.ranking(auth, { roleId: role, page: 1, pageSize: 20 });
    expect(response.items).toEqual([]);
    expect(response.candidateRows[0]).toMatchObject({
      candidateId: candidateA, rank: null, finalScore: null, evaluationStatus: 'unavailable',
      missingEvidence: ['The saved evaluation could not be validated for this role.'],
    });
  });

  it('rejects unsupported scoring versions rather than silently returning another version', async () => {
    await expect(repository().ranking(auth, { roleId: role, scoringVersion: '1.0.0', page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'SCORING_VERSION_UNSUPPORTED' });
  });

  it('refuses to rank candidates whose eligible evaluations use different role-weight snapshots', async () => {
    const candidateC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const evaluationC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const customResult = { ...result(candidateC), roleWeightsUsed: { ...result(candidateC).roleWeightsUsed, project_portfolio: 19, technical_skills: 21 } };
    const repo = repository([
      evaluation({ id: evaluationA, candidate_id: candidateA }),
      evaluation({ id: evaluationC, candidate_id: candidateC, evaluation_result: customResult }),
    ], [
      { id: candidateA, full_name: 'Candidate A', owner_id: ownerId, archived_at: null },
      { id: candidateC, full_name: 'Candidate C', owner_id: ownerId, archived_at: null },
    ]);
    await expect(repo.ranking(auth, { roleId: role, page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ROLE_CONFIGURATION_MISMATCH' });
  });
});
