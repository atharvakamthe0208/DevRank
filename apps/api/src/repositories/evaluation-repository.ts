import {
  candidateEvaluationsResponseSchema,
  evaluationResponseSchema,
  scoringVersion as currentScoringVersion,
  evaluationRoleSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  persistedEvaluationSchema,
  persistedEvaluationReadSchema,
  legacyEvaluationResponseV1Schema,
  previousEvaluationResponseV2Schema,
  platformEvaluationEvidenceSchema,
  proposedRubricId,
  roleIdSchema,
  roleWeightsSchema,
  roleProfileListResponseSchema,
  type EvaluationRequest,
  type RoleProfileOption,
  type EvaluationRole,
  type EvaluationRolesResponse,
  type EvaluationRunRequest,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { processCandidateEvidence } from '../modules/evidence-processing/index.js';
import { loadRoleWeightConfiguration } from '../modules/scoring/index.js';
import type { AuthContext } from '../types/auth.js';

export interface EvaluationRepository {
  listRoles(): EvaluationRolesResponse;
  listRoleProfiles(auth: AuthContext): Promise<unknown>;
  listForCandidate(auth: AuthContext, candidateId: string): Promise<unknown>;
  run(auth: AuthContext, input: EvaluationRunRequest): Promise<EvaluationRunResponse>;
  create(auth: AuthContext, candidateId: string, input: EvaluationRequest): Promise<unknown>;
  get(auth: AuthContext, id: string): Promise<unknown>;
}

const roleNames: Record<EvaluationRole['id'], string> = {
  software_developer: 'Software Developer',
  ai_ml_engineer: 'AI/ML Engineer',
  data_analyst: 'Data Analyst',
};
const unavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now');

type EvaluationOperation = 'candidate_lookup' | 'role_profile_lookup' | 'evidence_read' | 'evaluation_insert' | 'evaluation_read' | 'evaluation_processing';
type DatabaseFailureSource = 'supabase_response' | 'thrown_exception';
const knownColumns = new Set([
  'evaluation_result', 'role_weights_snapshot', 'target_role', 'role_profile_id', 'status',
  'owner_id', 'candidate_id', 'scoring_version', 'evidence_snapshot', 'overall_score',
]);

/** Log only bounded database metadata; never log provider messages or request/evaluation data. */
function logDatabaseFailure(error: unknown, operation: EvaluationOperation, failureSource: DatabaseFailureSource) {
  const records: object[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null && !records.includes(current); depth++) {
    records.push(current);
    current = 'cause' in current ? current.cause : undefined;
  }
  const code = records.map((item) => 'code' in item && typeof item.code === 'string' && /^[A-Z0-9_]{1,32}$/i.test(item.code) ? item.code : undefined).find(Boolean);
  const message = records.map((item) => 'message' in item && typeof item.message === 'string' ? item.message : undefined).find(Boolean) ?? '';
  const field = [...knownColumns].find((column) => new RegExp(`\\b${column}\\b`, 'i').test(message));
  const constraintMatch = message.match(/constraint\s+["']([a-z][a-z0-9_]{0,62})["']/i);
  const safeConstraint = constraintMatch?.[1];
  const category = code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205'
    ? 'schema'
    : code === '23502' || code === '23503' || code === '23505' || code === '23514'
      ? 'constraint'
      : code === '42501' || code === 'PGRST301'
        ? 'permission_or_rls'
        : code?.startsWith('PGRST') ? 'postgrest_other' : 'connection_or_unknown';
  console.error('Evaluation database operation failed', {
    operation,
    failureSource,
    category,
    ...(code ? { code } : {}),
    ...(field ? { field } : {}),
    ...(safeConstraint ? { constraint: safeConstraint } : {}),
  });
}

function databaseFailure(error: unknown, operation: EvaluationOperation, failureSource: DatabaseFailureSource): never {
  logDatabaseFailure(error, operation, failureSource);
  throw unavailable();
}

async function databaseOperation<T>(operation: EvaluationOperation, action: () => PromiseLike<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    return databaseFailure(error, operation, 'thrown_exception');
  }
}

function configuredRoles() {
  const configuration = loadRoleWeightConfiguration();
  return evaluationRolesResponseSchema.parse({
    roles: Object.entries(configuration.roles).map(([id, weights]) => evaluationRoleSchema.parse({
      id, displayName: roleNames[id as EvaluationRole['id']], weights,
    })),
  });
}

function makeEvidence(rows: Array<Record<string, unknown>>) {
  return rows.flatMap((row) => {
    const value = row.normalized_evidence;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (!('evidenceId' in item && 'evidenceType' in item)) return [];
    return [{
      ...item,
      evidenceId: row.id,
      source: row.source,
      availability: row.availability === 'available' ? 'available' : 'missing',
      ...(typeof row.observed_at === 'string' ? { observedAt: row.observed_at } : {}),
    }];
  });
}

function makePlatformEvidence(candidateId: string, rows: Array<Record<string, unknown>>) {
  const latestBySource = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const raw = row.raw_evidence && typeof row.raw_evidence === 'object' && !Array.isArray(row.raw_evidence)
      ? row.raw_evidence as Record<string, unknown> : {};
    const provenance = row.source === 'github' ? 'github_api' : raw.provenance;
    if (!['github_api', 'alfa_leetcode_api', 'candidate_provided'].includes(String(provenance))) continue;
    const key = `${String(row.source)}:${String(provenance)}`;
    latestBySource.set(key, row); // Rows arrive oldest first; retain one current saved snapshot per source/provenance.
  }

  const output = [];
  for (const row of latestBySource.values()) {
    const raw = row.raw_evidence && typeof row.raw_evidence === 'object' && !Array.isArray(row.raw_evidence)
      ? row.raw_evidence as Record<string, unknown> : {};
    const normalized = row.normalized_evidence && typeof row.normalized_evidence === 'object' && !Array.isArray(row.normalized_evidence)
      ? row.normalized_evidence as Record<string, unknown> : {};
    const source = row.source;
    const provenance = source === 'github' ? 'github_api' : raw.provenance;
    const observedAt = typeof row.observed_at === 'string' ? row.observed_at : row.created_at;
    if (typeof observedAt !== 'string') continue;
    const available = row.availability === 'available';
    if (source === 'github' && provenance === 'github_api') {
      const repos = Array.isArray(normalized.repositories) ? normalized.repositories.filter((repo): repo is Record<string, unknown> => Boolean(repo && typeof repo === 'object' && !Array.isArray(repo))) : [];
      const repositories = repos.slice(0, 10).map((repo) => ({
        name: repo.name, description: repo.description, primaryLanguage: repo.primaryLanguage,
        stars: repo.stars, forks: repo.forks, updatedAt: repo.updatedAt,
      }));
      output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:github`, candidateId, source: 'github', evidenceType: 'repository_snapshot',
        availability: available ? 'available' : 'unavailable', observedAt,
        normalizedValue: {
          publicRepositoryCount: normalized.publicRepositoryCount,
          followers: normalized.followers, following: normalized.following,
          repositoriesTruncated: normalized.repositoriesTruncated === true
            || (typeof normalized.publicRepositoryCount === 'number' && normalized.publicRepositoryCount > repositories.length),
          repositories,
        }, verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
        limitations: [
          'Public profile data does not verify candidate identity.',
          'Stars, forks, followers, and repository count are context only and are not scoring inputs.',
          'Only the ten most recently updated repositories are included in evaluation context; this snapshot alone does not establish development activity or collaboration.',
          'Snapshot age has no approved freshness threshold.',
        ],
        categoryMappings: [
          ...(repositories.length ? [{ categoryId: 'relevant_project_experience', relation: 'supporting' }] : []),
          ...(repositories.some((repo) => typeof repo.primaryLanguage === 'string') ? [{ categoryId: 'technical_skills', relation: 'supporting' }] : []),
          ...(repositories.length ? [{ rubricId: proposedRubricId, categoryId: 'project_portfolio', relation: 'supporting' }] : []),
          ...(repositories.some((repo) => typeof repo.primaryLanguage === 'string') ? [{ rubricId: proposedRubricId, categoryId: 'technical_skills', relation: 'supporting' }] : []),
        ],
      }));

      const insights = normalized.insights && typeof normalized.insights === 'object' && !Array.isArray(normalized.insights)
        ? normalized.insights as Record<string, unknown> : {};
      const currentYear = insights.currentYearContributions && typeof insights.currentYearContributions === 'object'
        ? insights.currentYearContributions as Record<string, unknown> : undefined;
      const activity = insights.developmentActivity && typeof insights.developmentActivity === 'object'
        ? insights.developmentActivity as Record<string, unknown> : undefined;
      const collaboration = insights.collaboration && typeof insights.collaboration === 'object'
        ? insights.collaboration as Record<string, unknown> : undefined;
      const proposedMapping = (categoryId: string) => [{ rubricId: proposedRubricId, categoryId, relation: 'supporting' }];
      const availabilityFor = (value: Record<string, unknown> | undefined) => value?.status === 'available'
        ? 'available' as const : value?.status === 'partial' ? 'partial' as const : 'unavailable' as const;
      const commonLimitations = [
        'GitHub account attribution is not identity verification and contribution volume does not establish code quality or engineering competence.',
        'These are context metrics only. Proposed weights are unapproved and these values do not affect the active v3 score.',
        'The public-only token scope is an operator configuration requirement and is not inspected by the API; incomplete provider responses remain marked partial or unavailable.',
      ];
      if (currentYear) {
        const weekly = Array.isArray(currentYear.weeklyContributions) ? currentYear.weeklyContributions : undefined;
        const contributionTypes = currentYear.contributionTypes && typeof currentYear.contributionTypes === 'object'
          ? currentYear.contributionTypes : undefined;
        output.push(platformEvaluationEvidenceSchema.parse({
          evidenceId: `${String(row.id)}:github:current-year`, candidateId, source: 'github', evidenceType: 'current_year_contributions',
          availability: availabilityFor(currentYear), observedAt,
          normalizedValue: {
            year: currentYear.year, timezone: currentYear.timezone, periodStart: currentYear.periodStart,
            periodEnd: currentYear.periodEnd, observedThrough: currentYear.observedThrough,
            totalContributions: currentYear.totalContributions,
            observedWeeks: currentYear.observedWeeks, activeWeeks: currentYear.activeWeeks,
            activeWeekCoveragePercent: currentYear.activeWeekCoveragePercent,
            contributionsPerObservedWeek: currentYear.contributionsPerObservedWeek,
            weeklyContributionDistribution: weekly?.map((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
              const value = item as Record<string, unknown>;
              return { weekStart: value.weekStart, contributionCount: value.contributionCount };
            }).filter(Boolean),
            contributionTypes,
            reasons: currentYear.reasons,
          },
          verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
          limitations: [...commonLimitations, 'Volume is the GitHub calendar total; type breakdowns are shown separately and are never added to that total.', 'Volume is expressed per observed UTC calendar week, and distribution as active observed UTC weeks divided by observed weeks; these rates are descriptive, not rubric scores.'],
          categoryMappings: proposedMapping('current_year_contributions'),
        }));
      }
      if (activity) output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:github:development-activity`, candidateId, source: 'github', evidenceType: 'development_activity',
        availability: availabilityFor(activity), observedAt,
        normalizedValue: {
          totalCommitContributions: activity.totalCommitContributions,
          activeCommitDays: activity.activeCommitDays,
          activeCommitWeeks: activity.activeCommitWeeks,
          repositoriesWithCommitContributions: activity.repositoriesWithCommitContributions,
          duplicateDailyRecords: activity.duplicateDailyRecords, reasons: activity.reasons,
        },
        verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
        limitations: [...commonLimitations, 'Commit counts and temporal patterns do not measure code quality, complexity, or engineering competence.'],
        categoryMappings: proposedMapping('development_activity'),
      }));
      if (collaboration) output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:github:collaboration`, candidateId, source: 'github', evidenceType: 'collaboration_activity',
        availability: availabilityFor(collaboration), observedAt,
        normalizedValue: {
          pullRequestsOpened: collaboration.pullRequestsOpened,
          issuesOpened: collaboration.issuesOpened,
          reviewsSubmitted: collaboration.reviewsSubmitted,
          reasons: collaboration.reasons,
        },
        verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
        limitations: [...commonLimitations, 'Counts do not establish review quality, communication quality, or collaboration outcomes; counts across types are not summed.'],
        categoryMappings: proposedMapping('collaboration'),
      }));
    } else if (source === 'leetcode' && (provenance === 'alfa_leetcode_api' || provenance === 'candidate_provided')) {
      const stats = provenance === 'candidate_provided' ? raw.statistics : normalized.statistics;
      const supportedStats = stats && typeof stats === 'object' && !Array.isArray(stats) ? stats as Record<string, unknown> : {};
      const availability = row.availability === 'not_provided' ? 'not_provided' : available ? 'available' : 'unavailable';
      const limitations = [
        provenance === 'candidate_provided' ? 'These metrics were entered by the recruiter and are not provider-verified.' : 'Provider statistics do not verify candidate identity or problem-solving process.',
        'Raw counts are contextual only; no approved normalization thresholds exist, so these values do not produce category scores.',
        'Language, skill, and historical activity values are not inferred when absent.',
        'Snapshot age has no approved freshness threshold.',
      ];
      if (provenance === 'candidate_provided') {
        if (Object.keys(supportedStats).length) output.push(platformEvaluationEvidenceSchema.parse({
          evidenceId: `${String(row.id)}:leetcode:${String(provenance)}`, candidateId, source: 'leetcode',
          evidenceType: 'candidate_reported_statistics', availability, observedAt,
          normalizedValue: { statistics: supportedStats }, verificationStatus: 'unverified', provenance, freshness: 'unassessed',
          limitations, categoryMappings: [
            { categoryId: 'problem_solving_dsa', relation: 'supporting' },
            { rubricId: proposedRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
          ],
        }));
        continue;
      }

      const solvedKeys = ['problemsSolved', 'easySolved', 'mediumSolved', 'hardSolved'];
      const contestKeys = ['contestsAttended', 'contestRating', 'contestGlobalRanking', 'contestParticipants', 'contestTopPercentage'];
      const pickPresent = (keys: string[]) => Object.fromEntries(keys.filter((key) => supportedStats[key] !== undefined).map((key) => [key, supportedStats[key]]));
      const solvedStatistics = pickPresent(solvedKeys);
      if (Object.keys(solvedStatistics).length) output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:leetcode:${String(provenance)}:solved`, candidateId, source: 'leetcode', evidenceType: 'solved_statistics',
        availability, observedAt, normalizedValue: { statistics: solvedStatistics }, verificationStatus: 'unverified', provenance, freshness: 'unassessed',
        limitations, categoryMappings: [
          { categoryId: 'problem_solving_dsa', relation: 'supporting' },
          { rubricId: proposedRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
        ],
      }));
      const contestStatistics = pickPresent(contestKeys);
      if (Object.keys(contestStatistics).length) output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:leetcode:${String(provenance)}:contest`, candidateId, source: 'leetcode', evidenceType: 'contest_statistics',
        availability, observedAt, normalizedValue: { statistics: contestStatistics }, verificationStatus: 'unverified', provenance, freshness: 'unassessed',
        limitations, categoryMappings: [
          { categoryId: 'problem_solving_dsa', relation: 'supporting' },
          { rubricId: proposedRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
        ],
      }));
    }
  }
  return output;
}

function readPersistedEvaluation(row: Record<string, unknown>) {
  const value = {
    id: row.id, candidateId: row.candidate_id, roleProfileId: row.role_profile_id,
    targetRole: row.target_role, status: row.status, createdAt: row.created_at, result: row.evaluation_result,
  };
  const current = persistedEvaluationSchema.safeParse(value);
  if (current.success && (!current.data.result.scoringVersion || current.data.result.scoringVersion === currentScoringVersion)) return current.data;

  const previousV2Result = previousEvaluationResponseV2Schema.safeParse(row.evaluation_result);
  if (previousV2Result.success) {
    const previous = persistedEvaluationReadSchema.safeParse({
      ...value,
      targetRole: row.target_role ?? previousV2Result.data.targetRole,
      result: previousV2Result.data,
    });
    if (previous.success) return previous.data;
  }

  // Some older rows predate the denormalized target_role column. A validated
  // immutable result snapshot is authoritative for its own role identifier.
  const currentResult = evaluationResponseSchema.safeParse(row.evaluation_result);
  if (currentResult.success && (!currentResult.data.scoringVersion || currentResult.data.scoringVersion === currentScoringVersion)) {
    const compatible = persistedEvaluationSchema.safeParse({
      ...value,
      targetRole: row.target_role ?? currentResult.data.targetRole,
      result: currentResult.data,
    });
    if (compatible.success) return compatible.data;
  }

  // V1 snapshots carry their own role and six-category scoring model. Preserve the
  // snapshot as-is; never translate its scores into the current v3 model.
  const historicalResult = legacyEvaluationResponseV1Schema.safeParse(row.evaluation_result);
  if (historicalResult.success) {
    const legacy = persistedEvaluationReadSchema.safeParse({
      ...value,
      targetRole: row.target_role ?? historicalResult.data.targetRole,
      result: historicalResult.data,
    });
    if (legacy.success) return legacy.data;
  }

  const id = typeof row.id === 'string' ? row.id : 'unknown';
  if (currentResult.success && currentResult.data.scoringVersion !== undefined && currentResult.data.scoringVersion !== currentScoringVersion) {
    throw new HttpError(409, 'SCORING_VERSION_UNSUPPORTED', `Saved evaluation ${id} uses unsupported scoring version ${currentResult.data.scoringVersion}`);
  }
  throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', `Saved evaluation ${id} has a missing, malformed, or unsupported result snapshot`);
}

export function createEvaluationRepository(getClient = getSupabaseClient): EvaluationRepository {
  async function persist(
    client: ReturnType<typeof getSupabaseClient>,
    auth: AuthContext,
    candidate: { id: string },
    roleProfileId: string | null,
    targetRole: EvaluationRole['id'],
    weights: unknown,
  ) {
    const checkedWeights = roleWeightsSchema.safeParse(weights);
    if (!checkedWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define six valid v3 category weights totaling 100');
    const { data: rows, error: evidenceError } = await databaseOperation('evidence_read', () => client.from('platform_evidence')
      .select('id,source,availability,normalized_evidence,observed_at,created_at')
      .eq('candidate_id', candidate.id).eq('owner_id', auth.userId).order('created_at', { ascending: true }));
    if (evidenceError) databaseFailure(evidenceError, 'evidence_read', 'supabase_response');
    if (!rows) throw unavailable();

    // Provider snapshots and raw metrics remain provenance; only explicit contract evidence is scoreable.
    const configuredScoring = loadRoleWeightConfiguration();
    const configuration = { ...configuredScoring, roles: { [targetRole]: checkedWeights.data } };
    const { evaluation } = processCandidateEvidence({
      candidateId: candidate.id, targetRole, evidence: makeEvidence(rows as Array<Record<string, unknown>>),
    }, { roleWeights: configuration });
    const result = evaluationResponseSchema.parse({
      ...evaluation,
      platformEvidence: makePlatformEvidence(candidate.id, rows as Array<Record<string, unknown>>),
    });
    const { data: saved, error: insertError } = await databaseOperation('evaluation_insert', () => client.from('evaluations').insert({
      owner_id: auth.userId,
      candidate_id: candidate.id,
      role_profile_id: roleProfileId,
      target_role: targetRole,
      status: result.evaluationStatus,
      overall_score: result.overallScore ?? null,
      scoring_version: result.scoringVersion,
      evidence_snapshot: result.evidence,
      role_weights_snapshot: result.roleWeightsUsed,
      evaluation_result: result,
    }).select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result').single());
    if (insertError) databaseFailure(insertError, 'evaluation_insert', 'supabase_response');
    if (!saved) throw unavailable();
    return {
      id: saved.id,
      candidateId: saved.candidate_id,
      roleProfileId: saved.role_profile_id,
      targetRole: saved.target_role,
      status: saved.status,
      createdAt: saved.created_at,
      result: saved.evaluation_result,
    };
  }

  async function ownedCandidate(client: ReturnType<typeof getSupabaseClient>, auth: AuthContext, candidateId: string) {
    const { data, error } = await databaseOperation('candidate_lookup', () => client.from('candidates').select('id,full_name')
      .eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle());
    if (error) databaseFailure(error, 'candidate_lookup', 'supabase_response');
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
    return data;
  }

  async function listRoleProfiles(auth: AuthContext) {
    let client;
    try { client = getClient(auth.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Role profiles are not configured'); }
    const { data, error } = await databaseOperation('role_profile_lookup', () => client.from('role_profiles')
      .select('id,name,description,weights').eq('owner_id', auth.userId).order('name', { ascending: true }));
    if (error) databaseFailure(error, 'role_profile_lookup', 'supabase_response');
    if (!data) throw unavailable();
    const items: RoleProfileOption[] = data.map((profile: { id: string; name: string; description: string | null; weights: unknown }) => {
      const targetRole = roleIdSchema.safeParse(profile.name);
      const weights = roleWeightsSchema.safeParse(profile.weights);
      return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        usable: targetRole.success && weights.success,
        ...(targetRole.success ? { targetRole: targetRole.data } : {}),
        ...(weights.success ? { weights: weights.data } : {}),
      };
    });
    return roleProfileListResponseSchema.parse({ items });
  }

  async function listForCandidate(auth: AuthContext, candidateId: string) {
    let client;
    try { client = getClient(auth.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
    const candidate = await ownedCandidate(client, auth, candidateId);
    const { data, error } = await databaseOperation('evaluation_read', () => client.from('evaluations')
      .select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result')
      .eq('candidate_id', candidate.id).eq('owner_id', auth.userId).order('created_at', { ascending: false }).limit(20));
    if (error) databaseFailure(error, 'evaluation_read', 'supabase_response');
    if (!data) throw unavailable();
    const items = data.map((row: Record<string, unknown>) => readPersistedEvaluation(row));
    return candidateEvaluationsResponseSchema.parse({ items });
  }

  return {
    listRoles() { return configuredRoles(); },
    listRoleProfiles,
    listForCandidate,
    async run(auth, input) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const candidate = await ownedCandidate(client, auth, input.candidateId);
        const role = configuredRoles().roles.find(({ id }) => id === input.roleId);
        if (!role) throw new HttpError(400, 'VALIDATION_ERROR', 'Select a supported role');
        const stored = persistedEvaluationSchema.parse(await persist(client, auth, candidate, null, role.id, role.weights));
        return evaluationRunResponseSchema.parse({
          id: stored.id,
          status: stored.status,
          candidate: { id: candidate.id, name: candidate.full_name },
          role,
          evaluatedAt: stored.createdAt,
          evaluation: stored.result,
          evidenceLimitations: stored.result.missingEvidence.length > 0
            ? ['Insufficient rubric-normalized evidence is available for a complete overall score. Platform counts are not converted into category scores.']
            : [],
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        databaseFailure(error, 'evaluation_processing', 'thrown_exception');
      }
    },
    async create(auth, candidateId, input) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const candidate = await ownedCandidate(client, auth, candidateId);
        const { data: role, error } = await databaseOperation('role_profile_lookup', () => client.from('role_profiles').select('id,name,weights')
          .eq('id', input.roleProfileId).eq('owner_id', auth.userId).maybeSingle());
        if (error) databaseFailure(error, 'role_profile_lookup', 'supabase_response');
        if (!role) throw new HttpError(404, 'ROLE_PROFILE_NOT_FOUND', 'Role profile not found');
        const targetRole = roleIdSchema.safeParse(role.name);
        if (!targetRole.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'Role profile name must match a supported role identifier');
        const profileWeights = roleWeightsSchema.safeParse(role.weights);
        if (!profileWeights.success && typeof role.weights === 'object' && role.weights !== null && !Array.isArray(role.weights)
          && Object.keys(role.weights).length === 5) {
          throw new HttpError(422, 'ROLE_PROFILE_REQUIRES_V3_WEIGHTS', 'This saved role profile uses the previous five-category scoring model. Update it to six v3 category weights before evaluating; its stored configuration has not been modified.');
        }
        if (!profileWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define six valid v3 category weights totaling 100');
        return persistedEvaluationSchema.parse(await persist(client, auth, candidate, input.roleProfileId, targetRole.data, role.weights));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        databaseFailure(error, 'evaluation_processing', 'thrown_exception');
      }
    },
    async get(auth, id) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const { data, error } = await databaseOperation('evaluation_read', () => client.from('evaluations')
          .select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result')
          .eq('id', id).eq('owner_id', auth.userId).maybeSingle());
        if (error) databaseFailure(error, 'evaluation_read', 'supabase_response');
        if (!data) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
        return readPersistedEvaluation(data as Record<string, unknown>);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        databaseFailure(error, 'evaluation_processing', 'thrown_exception');
      }
    },
  };
}

export const evaluationRepository = createEvaluationRepository();
