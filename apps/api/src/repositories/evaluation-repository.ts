import {
  candidateEvaluationsResponseSchema,
  evaluationResponseSchema,
  scoringVersion as currentScoringVersion,
  scoringCategories,
  evaluationRoleSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  persistedEvaluationSchema,
  persistedEvaluationReadSchema,
  legacyEvaluationResponseV1Schema,
  previousEvaluationResponseV2Schema,
  previousEvaluationResponseV3Schema,
  platformEvaluationEvidenceSchema,
  finalRubricId,
  buildFinalEvaluationReport,
  parseProposedPlatformEvidence,
  roleIdSchema,
  roleWeightsSchema,
  roleProfileListResponseSchema,
  githubLanguageSummarySchema,
  summarizeGitHubLanguages,
  type EvaluationRequest,
  type RoleProfileOption,
  type EvaluationRole,
  type EvaluationRolesResponse,
  type EvaluationRunRequest,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { loadRoleWeightConfiguration, scoreCandidate, type ScoringPolicyOptions } from '../modules/scoring/index.js';
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
const previousScoringVersions = ['4.0.0'];
const unavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now');

type EvaluationOperation = 'candidate_lookup' | 'role_profile_lookup' | 'evidence_read' | 'evaluation_insert' | 'evaluation_read' | 'evaluation_processing';
type DatabaseFailureSource = 'supabase_response' | 'thrown_exception';
type EvaluationProcessingStage = 'candidate_lookup' | 'role_lookup' | 'role_configuration' | 'evidence_read' | 'evidence_normalization' | 'report_build' | 'scoring' | 'response_validation' | 'evaluation_insert' | 'persisted_response_validation' | 'evaluation_read';
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

/** Unexpected application/contract failures are not database outages. Log only stable, non-sensitive diagnostics. */
function logEvaluationProcessingFailure(error: unknown, stage: EvaluationProcessingStage) {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : undefined;
  const errorName = record && typeof record.name === 'string' && /^(Error|TypeError|RangeError|ReferenceError|SyntaxError|ZodError)$/.test(record.name)
    ? record.name : 'UnknownError';
  const issues = record && Array.isArray(record.issues) ? record.issues : [];
  const allowedPathParts = new Set([...knownColumns, 'categoryScores', 'roleWeightsUsed', 'overallScore', 'finalReport', 'platformEvidence', 'status', 'scoringVersion', 'evaluationStatus', 'schemaVersion']);
  const validationIssues = issues.slice(0, 8).flatMap((issue) => {
    if (typeof issue !== 'object' || issue === null) return [];
    const item = issue as Record<string, unknown>;
    const code = typeof item.code === 'string' && /^[a-z_]{1,32}$/i.test(item.code) ? item.code : undefined;
    const path = Array.isArray(item.path)
      ? item.path.map((part) => typeof part === 'number' ? String(part) : typeof part === 'string' && allowedPathParts.has(part) ? part : '[field]').join('.')
      : undefined;
    return [{ ...(code ? { code } : {}), ...(path ? { path } : {}) }];
  });
  console.error('Evaluation processing failed', {
    stage,
    errorType: errorName,
    ...(validationIssues.length ? { validationIssues } : {}),
  });
}

function evaluationProcessingFailure(error: unknown, stage: EvaluationProcessingStage): never {
  logEvaluationProcessingFailure(error, stage);
  throw new HttpError(500, 'EVALUATION_PROCESSING_FAILED', 'Unable to prepare the evaluation right now');
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

function matchesActiveRoleWeights(roleId: EvaluationRole['id'], weights: Record<string, number>) {
  const active = loadRoleWeightConfiguration().roles[roleId];
  return active !== undefined && scoringCategories.every(({ id }) => weights[id] === active[id]);
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
      const reportedSummary = githubLanguageSummarySchema.safeParse(normalized.languageSummary);
      const totalEligibleRepositories = typeof normalized.publicRepositoryCount === 'number'
        && Number.isSafeInteger(normalized.publicRepositoryCount) && normalized.publicRepositoryCount >= 0
        ? normalized.publicRepositoryCount : repos.length;
      const computedSummary = summarizeGitHubLanguages(
        repos,
        totalEligibleRepositories,
        normalized.repositoriesTruncated !== true && totalEligibleRepositories <= repos.length,
        reportedSummary.success ? reportedSummary.data.retrievalIssue : undefined,
      );
      const reportedSummaryMatchesSnapshot = reportedSummary.success
        && reportedSummary.data.repositoriesAnalyzed === computedSummary.repositoriesAnalyzed
        && reportedSummary.data.totalEligibleRepositories === computedSummary.totalEligibleRepositories
        && reportedSummary.data.repositoriesMissingLanguage === computedSummary.repositoriesMissingLanguage
        && reportedSummary.data.observedLanguages.join('\u0000') === computedSummary.observedLanguages.join('\u0000');
      const languageSummary = reportedSummaryMatchesSnapshot
        && reportedSummary.data.coverageStatus !== 'complete'
        && computedSummary.coverageStatus === 'complete'
        ? { ...computedSummary, coverageStatus: 'partial' as const, retrievalIssue: reportedSummary.data.retrievalIssue }
        : reportedSummaryMatchesSnapshot && reportedSummary.data.coverageStatus === 'complete'
          && computedSummary.coverageStatus === 'complete' ? reportedSummary.data : computedSummary;
      const effectiveLanguageSummary = available ? languageSummary : {
        ...languageSummary,
        coverageStatus: 'unavailable' as const,
      };
      output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:github`, candidateId, source: 'github', evidenceType: 'repository_snapshot',
        availability: available ? 'available' : 'unavailable', observedAt,
        normalizedValue: {
          publicRepositoryCount: normalized.publicRepositoryCount,
          followers: normalized.followers, following: normalized.following,
          repositoriesTruncated: normalized.repositoriesTruncated === true
            || (typeof normalized.publicRepositoryCount === 'number' && normalized.publicRepositoryCount > repositories.length),
          languageSummary: effectiveLanguageSummary,
          repositories,
        }, verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
        limitations: [
          'Public profile data does not verify candidate identity.',
          'Stars, forks, followers, and repository count are context only and are not scoring inputs.',
          'The report shows at most ten repository details; Technical Skills language coverage is aggregated from the saved language summary across the full retrieved repository set. This snapshot alone does not establish development activity or collaboration.',
          'Snapshot age has no approved freshness threshold.',
        ],
        categoryMappings: [
          ...(typeof normalized.publicRepositoryCount === 'number' && Number.isFinite(normalized.publicRepositoryCount) && normalized.publicRepositoryCount >= 0 ? [
            { categoryId: 'project_portfolio', relation: 'supporting' },
            { rubricId: finalRubricId, categoryId: 'project_portfolio', relation: 'supporting' },
          ] : []),
          ...(Array.isArray(normalized.repositories) || normalized.languageSummary !== undefined ? [
            { categoryId: 'technical_skills', relation: 'supporting' },
            { rubricId: finalRubricId, categoryId: 'technical_skills', relation: 'supporting' },
          ] : []),
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
      const proposedMapping = (categoryId: string) => [
        { categoryId, relation: 'supporting' },
        { rubricId: finalRubricId, categoryId, relation: 'supporting' },
      ];
      const availabilityFor = (value: Record<string, unknown> | undefined) => value?.status === 'available'
        ? 'available' as const : value?.status === 'partial' ? 'partial' as const : 'unavailable' as const;
      const commonLimitations = [
        'GitHub account attribution is not identity verification and contribution volume does not establish code quality or engineering competence.',
        'This source contributes only through the versioned deterministic v4 evidence-index formulas; account attribution is not identity verification and activity volume is not quality.',
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
        'The DSA index is a bounded solved-volume measure, not a competency score; provider statistics do not verify identity or problem-solving process.',
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
            { rubricId: finalRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
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
          { rubricId: finalRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
        ],
      }));
      const contestStatistics = pickPresent(contestKeys);
      if (Object.keys(contestStatistics).length) output.push(platformEvaluationEvidenceSchema.parse({
        evidenceId: `${String(row.id)}:leetcode:${String(provenance)}:contest`, candidateId, source: 'leetcode', evidenceType: 'contest_statistics',
        availability, observedAt, normalizedValue: { statistics: contestStatistics }, verificationStatus: 'unverified', provenance, freshness: 'unassessed',
        limitations, categoryMappings: [
          { categoryId: 'problem_solving_dsa', relation: 'supporting' },
          { rubricId: finalRubricId, categoryId: 'problem_solving_dsa', relation: 'supporting' },
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
  if (current.success && (!current.data.result.scoringVersion
    || current.data.result.scoringVersion === currentScoringVersion
    || previousScoringVersions.includes(current.data.result.scoringVersion))) return current.data;

  const previousV3Result = previousEvaluationResponseV3Schema.safeParse(row.evaluation_result);
  if (previousV3Result.success) {
    const previous = persistedEvaluationReadSchema.safeParse({ ...value, targetRole: row.target_role ?? previousV3Result.data.targetRole, result: previousV3Result.data });
    if (previous.success) return previous.data;
  }

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
    candidate: { id: string; leetcode_username?: string | null },
    roleProfileId: string | null,
    targetRole: EvaluationRole['id'],
    weights: unknown,
    markStage: (stage: EvaluationProcessingStage) => void,
  ) {
    markStage('role_configuration');
    const checkedWeights = roleWeightsSchema.safeParse(weights);
    if (!checkedWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define six valid v4 GitHub and LeetCode category weights totaling 100');
    markStage('evidence_read');
    const { data: rows, error: evidenceError } = await databaseOperation('evidence_read', () => client.from('platform_evidence')
      .select('id,source,availability,raw_evidence,normalized_evidence,observed_at,created_at')
      .eq('candidate_id', candidate.id).eq('owner_id', auth.userId).order('created_at', { ascending: true }));
    if (evidenceError) databaseFailure(evidenceError, 'evidence_read', 'supabase_response');
    if (!rows) throw unavailable();

    // The approved v4 indexes use saved snapshots; only the explicit absent-profile DSA policy may score without one.
    markStage('evidence_normalization');
    const configuredScoring = loadRoleWeightConfiguration();
    const configuration = { ...configuredScoring, roles: { [targetRole]: checkedWeights.data } };
    const platformEvidence = makePlatformEvidence(candidate.id, rows as Array<Record<string, unknown>>);
    markStage('report_build');
    const leetcodeSnapshotPresent = rows.some((row) => row.source === 'leetcode');
    const leetcodeUsernameConfigured = typeof candidate.leetcode_username === 'string' && candidate.leetcode_username.trim().length > 0;
    const report = buildFinalEvaluationReport(parseProposedPlatformEvidence(platformEvidence), {
      leetcodeUsernameConfigured,
      leetcodeSnapshotPresent,
    });
    const scoringEvidence = report.categories.flatMap((category) => {
      if (category.score === undefined) return [];
      const snapshots = platformEvidence.filter((snapshot) => snapshot.categoryMappings.some((mapping) =>
        mapping.rubricId === finalRubricId && mapping.categoryId === category.categoryId));
      if (snapshots.length === 0) return [];
      // The provider snapshot is preferred for DSA when present. Recruiter-entered
      // LeetCode figures remain separately available as fallback evidence only.
      const snapshot = category.categoryId === 'problem_solving_dsa'
        ? snapshots.find(({ evidenceType }) => evidenceType === 'solved_statistics')
          ?? snapshots.find(({ evidenceType }) => evidenceType === 'candidate_reported_statistics')
        : snapshots[snapshots.length - 1];
      if (!snapshot) return [];
      return [{
        evidenceId: `v4-index:${category.categoryId}`,
        evidenceType: category.categoryId === 'problem_solving_dsa' ? 'coding_assessment' as const : category.categoryId === 'project_portfolio' ? 'portfolio' as const : 'other' as const,
        source: `${snapshot.source} · ${snapshot.provenance}`,
        description: `${category.displayName} index from a saved ${snapshot.evidenceType.replaceAll('_', ' ')} snapshot using the v4 formula. This is an evidence-volume/breadth index, not a measure of engineering competence or quality.`,
        normalizedValue: category.score,
        verificationStatus: 'unverified' as const,
        categoryId: category.categoryId,
        availability: 'available' as const,
      }];
    });
    markStage('scoring');
    const dsaReportCategory = report.categories.find(({ categoryId }) => categoryId === 'problem_solving_dsa');
    const technicalReportCategory = report.categories.find(({ categoryId }) => categoryId === 'technical_skills');
    const missingEvidenceExplanations: NonNullable<ScoringPolicyOptions['missingEvidenceExplanations']> = {};
    if (dsaReportCategory?.metrics.dataStatus && typeof dsaReportCategory.metrics.dataStatus === 'string') {
      missingEvidenceExplanations.problem_solving_dsa = dsaReportCategory.metrics.dataStatus;
    }
    if (technicalReportCategory?.status === 'unavailable') {
      missingEvidenceExplanations.technical_skills = 'GitHub repository language data is unavailable for this evaluation. No Technical Skills score is assigned.';
    } else if (technicalReportCategory?.status === 'partial') {
      const analyzed = technicalReportCategory.metrics.repositoriesAnalyzed;
      const total = technicalReportCategory.metrics.totalEligibleRepositories;
      const count = typeof analyzed === 'number' && typeof total === 'number' ? `${analyzed} of ${total} eligible repositories were analyzed` : 'repository coverage is incomplete';
      const issue = technicalReportCategory.metrics.languageRetrievalIssue;
      const reason = issue === 'provider_rate_limited' ? ' GitHub rate-limited the remaining repository requests.'
        : issue === 'provider_timeout' ? ' GitHub timed out while retrieving repositories.'
          : issue === 'provider_unavailable' ? ' GitHub became unavailable while retrieving repositories.'
            : issue === 'invalid_response' ? ' GitHub returned incomplete repository data.'
              : issue === 'provider_error' ? ' Repository retrieval ended with a provider error.' : '';
      missingEvidenceExplanations.technical_skills = `GitHub language evidence is partial: ${count}.${reason} No Technical Skills score is assigned until language coverage is complete.`;
    }
    const policy: ScoringPolicyOptions = {
      zeroScoreCategories: dsaReportCategory?.metrics.scoringBasis === 'Optional LeetCode profile not provided; DSA index assigned zero by active policy'
        ? ['problem_solving_dsa' as const] : [],
      missingEvidenceExplanations,
    };
    const evaluation = scoreCandidate({ candidateId: candidate.id, targetRole, evidence: scoringEvidence }, configuration, currentScoringVersion, policy);
    markStage('response_validation');
    const result = evaluationResponseSchema.parse({
      ...evaluation,
      platformEvidence,
      finalReport: report,
      calculationExplanation: report.overallScore === undefined
        ? `Each available category uses its deterministic v4 source-specific formula. Missing or partial required source data remains unscored; when no LeetCode username and no LeetCode snapshot are present, the optional DSA category receives its policy-defined zero. Overall score is withheld until all six category indexes are available. ${report.notice}`
        : `Each category uses its deterministic v4 source-specific formula. An absent optional LeetCode profile receives a DSA index of zero under the active policy; this does not infer activity. The overall score is the weighted sum using the saved v4 role weights. These indexes describe evidence volume or breadth, not engineering quality or hiring suitability. ${report.notice}`,
      recommendations: report.overallScore === undefined
        ? [`Collect complete evidence for ${report.categories.filter(({ score }) => score === undefined).map(({ displayName }) => displayName).join(', ')} before an overall score can be calculated.`]
        : [],
    });
    markStage('evaluation_insert');
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
    markStage('persisted_response_validation');
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
    const { data, error } = await databaseOperation('candidate_lookup', () => client.from('candidates').select('id,full_name,leetcode_username')
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
        usable: targetRole.success && weights.success && matchesActiveRoleWeights(targetRole.data, weights.data),
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
      let stage: EvaluationProcessingStage = 'candidate_lookup';
      try {
        const candidate = await ownedCandidate(client, auth, input.candidateId);
        stage = 'role_lookup';
        const role = configuredRoles().roles.find(({ id }) => id === input.roleId);
        if (!role) throw new HttpError(400, 'VALIDATION_ERROR', 'Select a supported role');
        stage = 'role_configuration';
        const stored = persistedEvaluationSchema.parse(await persist(client, auth, candidate, null, role.id, role.weights, (next) => { stage = next; }));
        stage = 'response_validation';
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
        evaluationProcessingFailure(error, stage);
      }
    },
    async create(auth, candidateId, input) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      let stage: EvaluationProcessingStage = 'candidate_lookup';
      try {
        const candidate = await ownedCandidate(client, auth, candidateId);
        stage = 'role_lookup';
        const { data: role, error } = await databaseOperation('role_profile_lookup', () => client.from('role_profiles').select('id,name,weights')
          .eq('id', input.roleProfileId).eq('owner_id', auth.userId).maybeSingle());
        if (error) databaseFailure(error, 'role_profile_lookup', 'supabase_response');
        if (!role) throw new HttpError(404, 'ROLE_PROFILE_NOT_FOUND', 'Role profile not found');
        const targetRole = roleIdSchema.safeParse(role.name);
        if (!targetRole.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'Role profile name must match a supported role identifier');
        const profileWeights = roleWeightsSchema.safeParse(role.weights);
        const savedWeightKeys = typeof role.weights === 'object' && role.weights !== null && !Array.isArray(role.weights) ? Object.keys(role.weights) : [];
        const previousCategoryKeys = new Set(['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability']);
        if (!profileWeights.success && savedWeightKeys.length > 0 && savedWeightKeys.every((key) => previousCategoryKeys.has(key))) {
          throw new HttpError(422, 'ROLE_PROFILE_REQUIRES_V4_WEIGHTS', 'This saved role profile uses a historical category set. Reconfigure all six weights for the active v4 rubric before evaluating; its stored configuration has not been modified.');
        }
        if (!profileWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define six valid v4 GitHub and LeetCode category weights totaling 100');
        if (!matchesActiveRoleWeights(targetRole.data, profileWeights.data)) {
          throw new HttpError(422, 'ROLE_PROFILE_REQUIRES_V4_WEIGHTS', 'This role profile uses different weights from the active v4 rubric. Reconfigure it to 20/20/15/10/10/25 before evaluating; its stored configuration has not been modified.');
        }
        stage = 'role_configuration';
        const result = await persist(client, auth, candidate, input.roleProfileId, targetRole.data, role.weights, (next) => { stage = next; });
        stage = 'persisted_response_validation';
        return persistedEvaluationSchema.parse(result);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        evaluationProcessingFailure(error, stage);
      }
    },
    async get(auth, id) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      let stage: EvaluationProcessingStage = 'evaluation_read';
      try {
        const { data, error } = await databaseOperation('evaluation_read', () => client.from('evaluations')
          .select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result')
          .eq('id', id).eq('owner_id', auth.userId).maybeSingle());
        if (error) databaseFailure(error, 'evaluation_read', 'supabase_response');
        if (!data) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
        return readPersistedEvaluation(data as Record<string, unknown>);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        evaluationProcessingFailure(error, stage);
      }
    },
  };
}

export const evaluationRepository = createEvaluationRepository();
