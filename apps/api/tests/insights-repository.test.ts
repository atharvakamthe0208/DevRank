import { describe, expect, it } from 'vitest';
import { buildFinalEvaluationReport, finalRubric, scoringCategories, type AuthContext, type PlatformEvaluationEvidence } from '@devrank/contracts';
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

function providerEvaluation(candidateId: string, providerProfile: 'high' | 'zero' | 'github_only' | 'partial_github') {
  const observedAt = '2026-10-13T00:00:00.000Z';
  const makeEvidence = (source: 'github' | 'leetcode', categoryId: string, evidenceType: PlatformEvaluationEvidence['evidenceType'], normalizedValue: Record<string, unknown>, categoryIds = [categoryId]) => ({
    evidenceId: `${candidateId}:${source}:${categoryId}`, candidateId, source, evidenceType, availability: 'available' as const,
    observedAt, normalizedValue, verificationStatus: 'unverified' as const,
    provenance: source === 'github' ? 'github_api' as const : 'alfa_leetcode_api' as const,
    freshness: 'unassessed' as const, limitations: ['Provider snapshot test fixture.'],
    categoryMappings: categoryIds.map((id) => ({ rubricId: 'github_leetcode_v4' as const, categoryId: id as PlatformEvaluationEvidence['categoryMappings'][number]['categoryId'], relation: 'supporting' as const })),
  });
  const isHigh = providerProfile === 'high';
  const platformEvidence: PlatformEvaluationEvidence[] = [];
  if (providerProfile !== 'zero') {
    const count = isHigh ? 10 : 1;
    const repositories = Array.from({ length: count }, (_, index) => ({ name: `repo-${index}`, language: ['TypeScript', 'Python', 'Go', 'Rust', 'Java'][index % 5] }));
    platformEvidence.push(makeEvidence('github', 'project_portfolio', 'repository_snapshot', { publicRepositoryCount: isHigh ? 10 : 1, repositories, repositoriesTruncated: false }, providerProfile === 'partial_github' ? ['project_portfolio'] : ['project_portfolio', 'technical_skills']));
    if (providerProfile !== 'partial_github' && providerProfile !== 'github_only') {
      platformEvidence.push(makeEvidence('github', 'development_activity', 'development_activity', { totalCommitContributions: isHigh ? 250 : 1, activeCommitDays: isHigh ? 40 : 1, activeCommitWeeks: isHigh ? 12 : 1, repositoriesWithCommitContributions: isHigh ? 5 : 1 }));
      platformEvidence.push(makeEvidence('github', 'collaboration', 'collaboration_activity', { pullRequestsOpened: isHigh ? 50 : 1, issuesOpened: isHigh ? 50 : 1, reviewsSubmitted: isHigh ? 50 : 1 }));
      platformEvidence.push(makeEvidence('github', 'current_year_contributions', 'current_year_contributions', { year: 2026, timezone: 'UTC', totalContributions: isHigh ? 100 : 1, activeWeekCoveragePercent: isHigh ? 100 : 1, observedThrough: observedAt }));
    }
  } else {
    platformEvidence.push(makeEvidence('github', 'project_portfolio', 'repository_snapshot', { publicRepositoryCount: 0, repositories: [], repositoriesTruncated: false }));
    platformEvidence.push(makeEvidence('github', 'development_activity', 'development_activity', { totalCommitContributions: 0, activeCommitDays: 0, activeCommitWeeks: 0, repositoriesWithCommitContributions: 0 }));
    platformEvidence.push(makeEvidence('github', 'collaboration', 'collaboration_activity', { pullRequestsOpened: 0, issuesOpened: 0, reviewsSubmitted: 0 }));
    platformEvidence.push(makeEvidence('github', 'current_year_contributions', 'current_year_contributions', { year: 2026, timezone: 'UTC', totalContributions: 0, activeWeekCoveragePercent: 0, observedThrough: observedAt }));
  }
  if (providerProfile !== 'github_only') platformEvidence.push(makeEvidence('leetcode', 'problem_solving_dsa', 'solved_statistics', { statistics: { easySolved: isHigh ? 300 : 0, mediumSolved: 0, hardSolved: 0, problemsSolved: isHigh ? 300 : 0 } }));
  const report = buildFinalEvaluationReport(platformEvidence, { leetcodeUsernameConfigured: providerProfile !== 'github_only', leetcodeSnapshotPresent: providerProfile !== 'github_only' });
  const base = result(candidateId);
  const evidenceRows = report.categories.flatMap((category) => category.score === undefined ? [] : [{
    evidenceId: `${candidateId}:v4:${category.categoryId}`, evidenceType: 'other' as const, source: 'Validated provider evidence index',
    description: 'Test evidence for the validated provider index.', normalizedValue: category.score, verificationStatus: 'unverified' as const,
    categoryId: category.categoryId, availability: 'available' as const,
  }]);
  const categoryScores = report.categories.map((category) => {
    const evidenceRow = evidenceRows.find(({ categoryId }) => categoryId === category.categoryId);
    return category.score === undefined ? { categoryId: category.categoryId, displayName: category.displayName, status: 'insufficient_evidence' as const, evidenceRefs: [], explanation: 'Provider evidence is unavailable.' }
      : { categoryId: category.categoryId, displayName: category.displayName, status: 'scored' as const, score: category.score, evidenceRefs: [evidenceRow!.evidenceId], explanation: 'Validated provider evidence.' };
  });
  const missingEvidence = categoryScores.filter(({ status }) => status === 'insufficient_evidence').map(({ categoryId }) => categoryId);
  const { overallScore: _overallScore, ...baseWithoutOverall } = base;
  const savedResult = {
    ...baseWithoutOverall, ...(report.overallScore !== undefined ? { overallScore: report.overallScore } : {}),
    categoryScores, evidence: evidenceRows, platformEvidence, finalReport: report, missingEvidence,
    evaluationStatus: report.overallScore === undefined ? 'insufficient_evidence' : 'completed',
  };
  return { status: report.overallScore === undefined ? 'insufficient_evidence' : 'completed', overall_score: report.overallScore ?? null,
    scoring_version: '4.0.1', target_role: role, evaluation_result: savedResult, role_weights_snapshot: base.roleWeightsUsed };
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
      range: (from: number, to: number) => { limit = to - from + 1; return { ...builder, then: (resolve: (value: unknown) => unknown, reject: (reason?: unknown) => unknown) => {
        const source = table === 'evaluations' ? evaluations : candidates;
        const rows = source.filter((row) => [...filters].every(([column, value]) => row[column] === value));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null }).then(resolve, reject);
      } }; },
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
    expect(dashboard).toMatchObject({ candidateCount: 2, evaluatedCandidateIds: [candidateA, candidateB], evaluationCount: 2, statusCounts: { completed: 1, insufficient_evidence: 1 } });
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

  it('ranks provider indexes from saved validated snapshots and distinguishes unavailable from genuine zero LeetCode data', async () => {
    const rows = [
      { ...evaluation({ id: evaluationA, candidate_id: candidateA, created_at: '2026-10-13T00:00:00.000Z' }), ...providerEvaluation(candidateA, 'high') },
      { ...evaluation({ id: evaluationB, candidate_id: candidateB, created_at: '2026-10-13T00:00:00.000Z' }), ...providerEvaluation(candidateB, 'zero') },
      { ...evaluation({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', candidate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', created_at: '2026-10-14T00:00:00.000Z' }), ...providerEvaluation('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'github_only') },
      { ...evaluation({ id: '11111111-2222-4111-8111-111111111111', candidate_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', created_at: '2026-10-15T00:00:00.000Z' }), ...providerEvaluation('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'partial_github') },
    ];
    const repo = repository(rows, [
      { id: candidateA, full_name: 'High Candidate', owner_id: ownerId, archived_at: null },
      { id: candidateB, full_name: 'Zero Candidate', owner_id: ownerId, archived_at: null },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', full_name: 'Incomplete Candidate', owner_id: ownerId, archived_at: null },
      { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', full_name: 'Partial GitHub Candidate', owner_id: ownerId, archived_at: null },
    ]);
    const response = await repo.providerRanking(auth, { roleId: role, page: 1, pageSize: 20 });
    expect(response.items[0]).toMatchObject({ candidateId: candidateA, rank: 1, status: 'ranked' });
    expect(response.items[0]?.combinedScore).toBe(Math.round(((response.items[0]!.githubScore! * 0.75) + (response.items[0]!.leetcodeScore! * 0.25)) * 100) / 100);
    const unavailableLeetCode = response.items.find(({ candidateId }) => candidateId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(unavailableLeetCode).toMatchObject({ status: 'ranked', githubCoverage: { availableCategories: 1, status: 'partial' }, missingProviders: ['leetcode'] });
    expect(unavailableLeetCode?.combinedScore).toBe(Math.round(unavailableLeetCode!.githubScore! * 0.75 * 100) / 100);
    expect(unavailableLeetCode).not.toHaveProperty('leetcodeScore');
    expect(unavailableLeetCode).toHaveProperty('rank');
    const genuineZeroLeetCode = response.items.find(({ candidateId }) => candidateId === candidateB);
    expect(genuineZeroLeetCode).toMatchObject({ githubScore: 0, leetcodeScore: 0, combinedScore: 0, status: 'ranked', missingProviders: [] });
    expect(response.items.map(({ combinedScore }) => combinedScore)).toEqual([...response.items.map(({ combinedScore }) => combinedScore)].sort((a, b) => (b ?? -1) - (a ?? -1)));
    expect(response).toMatchObject({ rankedTotal: 4, incompleteTotal: 0, providerWeights: { github: 75, leetcode: 25 } });
    expect(finalRubric.categories.filter(({ source }) => source === 'github')).toHaveLength(5);
  });

  it('uses stable candidate ordering for tied provider scores and shows candidates with both providers missing', async () => {
    const candidateC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const evaluationC = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const repo = repository([
      { ...evaluation({ id: evaluationB, candidate_id: candidateB }), ...providerEvaluation(candidateB, 'zero') },
      { ...evaluation({ id: evaluationA, candidate_id: candidateA }), ...providerEvaluation(candidateA, 'zero') },
      evaluation({ id: evaluationC, candidate_id: candidateC, status: 'failed', overall_score: null, scoring_version: null, target_role: role, evaluation_result: null }),
    ], [
      { id: candidateA, full_name: 'Candidate A', owner_id: ownerId, archived_at: null },
      { id: candidateB, full_name: 'Candidate B', owner_id: ownerId, archived_at: null },
      { id: candidateC, full_name: 'Candidate C', owner_id: ownerId, archived_at: null },
    ]);
    const response = await repo.providerRanking(auth, { roleId: role, page: 1, pageSize: 20 });
    expect(response.items.slice(0, 2).map(({ candidateId, rank }) => ({ candidateId, rank }))).toEqual([
      { candidateId: candidateA, rank: 1 }, { candidateId: candidateB, rank: 2 },
    ]);
    expect(response.items[2]).toMatchObject({ candidateId: candidateC, status: 'incomplete', githubCoverage: { status: 'unavailable' }, missingProviders: ['github', 'leetcode'] });
    expect(response.items[2]).not.toHaveProperty('rank');
    expect(response.items[2]).not.toHaveProperty('combinedScore');
  });
});
