import {
  candidateComparisonResponseSchema,
  dashboardResponseSchema,
  evaluationResponseSchema,
  evaluationStatusSchema,
  rankingResponseSchema,
  roleWeightsSchema,
  scoringCategories,
  scoringVersion,
  providerRankingResponseSchema,
  providerRankingMode,
  providerRankingWeights,
  combineProviderScores,
  providerScoresFromEvaluation,
  type CandidateComparison,
  type DashboardResponse,
  type ProviderRankingQuery,
  type ProviderRankingResponse,
  type RankingQuery,
  type RankingResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import type { AuthContext } from '../types/auth.js';

type EvaluationRow = {
  id: string; candidate_id: string; status: string; overall_score: number | string | null;
  scoring_version: string | null; created_at: string; target_role?: string | null;
  evaluation_result?: unknown; role_weights_snapshot?: unknown;
};
type CandidateRow = { id: string; full_name: string; github_username: string | null; leetcode_username: string | null };

export interface InsightsRepository {
  dashboard(auth: AuthContext): Promise<DashboardResponse>;
  compare(auth: AuthContext, input: CandidateComparison): Promise<unknown>;
  ranking(auth: AuthContext, query: RankingQuery): Promise<RankingResponse>;
  providerRanking(auth: AuthContext, query: ProviderRankingQuery): Promise<ProviderRankingResponse>;
}

const databaseUnavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to load recruiter insights right now');
const evaluationSchemaUnavailable = () => new HttpError(503, 'EVALUATION_SCHEMA_UNAVAILABLE', 'Evaluation result storage is unavailable; the approved evaluation persistence schema must be deployed first');
const statuses = ['pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed'] as const;

function validResult(row: EvaluationRow) {
  const parsed = evaluationResponseSchema.safeParse(row.evaluation_result);
  const weights = roleWeightsSchema.safeParse(row.role_weights_snapshot);
  if (!parsed.success || parsed.data.candidateId !== row.candidate_id || !row.target_role || !row.scoring_version
    || !weights.success || parsed.data.targetRole !== row.target_role || parsed.data.scoringVersion !== row.scoring_version
    || weightKey(parsed.data.roleWeightsUsed) !== weightKey(weights.data)) return undefined;
  if (row.status === 'completed' && (parsed.data.evaluationStatus !== 'completed' || parsed.data.overallScore === undefined
    || row.overall_score === null || !Number.isFinite(Number(row.overall_score))
    || Math.abs(Number(row.overall_score) - parsed.data.overallScore) >= 0.005)) return undefined;
  if (row.status === 'insufficient_evidence' && (parsed.data.evaluationStatus !== 'insufficient_evidence' || row.overall_score !== null)) return undefined;
  return parsed.data;
}

function weightKey(weights: Record<string, number>) {
  return scoringCategories.map(({ id }) => weights[id]).join(':');
}

function validatedPlatformScore(result: ReturnType<typeof evaluationResponseSchema.parse> | undefined, source: 'github' | 'leetcode'): number | null {
  const categories = result?.finalReport?.categories.filter((item) => item.source === source) ?? [];
  if (!categories.length || categories.some((item) => item.status !== 'scored' || item.score === undefined)) return null;
  const totalWeight = categories.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  return Math.round((categories.reduce((sum, item) => sum + (item.score ?? 0) * item.weight, 0) / totalWeight + Number.EPSILON) * 100) / 100;
}

function savedUsername(result: ReturnType<typeof evaluationResponseSchema.parse> | undefined, source: 'github' | 'leetcode') {
  const snapshots = result?.platformEvidence?.filter((item) => item.source === source)
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt)) ?? [];
  for (const snapshot of snapshots) {
    const value = snapshot.normalizedValue;
    const profile = typeof value.profile === 'object' && value.profile !== null ? value.profile as Record<string, unknown> : {};
    const username = source === 'github' ? value.username ?? profile.username : value.handle ?? value.username;
    if (typeof username === 'string' && username.trim()) return username.trim();
  }
  return null;
}

export function createInsightsRepository(getClient = getSupabaseClient): InsightsRepository {
  function clientFor(auth: AuthContext) {
    try { return getClient(auth.accessToken); }
    catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Recruiter data storage is not configured'); }
  }

  return {
    async dashboard(auth) {
      const client = clientFor(auth);
      try {
        const [candidateCountResult, evaluationTotalResult, recentResult, ...countResults] = await Promise.all([
          client.from('candidates').select('id', { count: 'exact', head: true }).eq('owner_id', auth.userId).is('archived_at', null),
          client.from('evaluations').select('id', { count: 'exact', head: true }).eq('owner_id', auth.userId),
          client.from('evaluations').select('id,candidate_id,status,overall_score,scoring_version,created_at')
            .eq('owner_id', auth.userId).order('created_at', { ascending: false }).order('id', { ascending: true }).limit(10),
          ...statuses.map((status) => client.from('evaluations').select('id', { count: 'exact', head: true }).eq('owner_id', auth.userId).eq('status', status)),
        ]);
        if (candidateCountResult.error || evaluationTotalResult.error || recentResult.error || countResults.some(({ error }) => error)) throw databaseUnavailable();
        const knownEvaluationCount = countResults.reduce((sum, result) => sum + (result.count ?? 0), 0);
        const evaluationCount = evaluationTotalResult.count ?? 0;
        if (knownEvaluationCount !== evaluationCount) throw new HttpError(409, 'EVALUATION_STATUS_UNSUPPORTED', 'Evaluation rows contain a status outside the supported dashboard contract');
        const rows = (recentResult.data ?? []) as EvaluationRow[];
        const reportResult = rows.length
          ? await client.from('evaluations').select('id,evaluation_result').eq('owner_id', auth.userId).in('id', rows.map(({ id }) => id))
          : { data: [], error: null };
        const reportSchemaUnavailable = Boolean(reportResult.error && ['42703', 'PGRST204', 'PGRST205'].includes(reportResult.error.code ?? ''));
        if (reportResult.error && !reportSchemaUnavailable) throw databaseUnavailable();
        const reportRows = (reportResult.data ?? []) as Array<{ id: string; evaluation_result?: unknown }>;
        const reportById = new Map(reportRows.map(({ id, evaluation_result }) => [id, evaluation_result]));
        const candidateIds = [...new Set(rows.map(({ candidate_id }) => candidate_id))];
        const candidatesResult = candidateIds.length
          ? await client.from('candidates').select('id,full_name').eq('owner_id', auth.userId).in('id', candidateIds)
          : { data: [], error: null };
        if (candidatesResult.error) throw databaseUnavailable();
        const names = new Map(((candidatesResult.data ?? []) as Array<{ id: string; full_name: string }>).map(({ id, full_name }) => [id, full_name]));
        const statusCounts = Object.fromEntries(statuses.map((status, index) => [status, countResults[index]?.count ?? 0]));
        const payload = {
          candidateCount: candidateCountResult.count ?? 0,
          evaluationCount,
          statusCounts,
          recentEvaluations: rows.flatMap((row) => {
            const status = evaluationStatusSchema.safeParse(row.status);
            const candidateName = names.get(row.candidate_id);
            const score = typeof row.overall_score === 'number' ? row.overall_score
              : typeof row.overall_score === 'string' && row.overall_score.trim() !== '' ? Number(row.overall_score) : undefined;
            if (!status.success || !candidateName) return [];
            const savedResult = evaluationResponseSchema.safeParse(reportById.get(row.id));
            const finalReport = savedResult.success && savedResult.data.candidateId === row.candidate_id
              ? savedResult.data.finalReport : undefined;
            return [{ id: row.id, candidateId: row.candidate_id, candidateName, status: status.data,
              createdAt: row.created_at, ...(status.data === 'completed' && score !== undefined && Number.isFinite(score) ? { score } : {}),
              scoringVersion: row.scoring_version,
              ...(finalReport ? { finalReport } : {}),
              ...(reportSchemaUnavailable || (savedResult.success && !savedResult.data.finalReport) ? { finalReportUnavailable: true } : {}) }];
          }),
        };
        const result = dashboardResponseSchema.safeParse(payload);
        if (!result.success) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Dashboard data could not be processed');
        return result.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw databaseUnavailable();
      }
    },

    async compare(auth, input) {
      const client = clientFor(auth);
      try {
        const { data, error } = await client.from('evaluations')
          .select('id,candidate_id,status,scoring_version,target_role,evaluation_result,role_weights_snapshot,overall_score')
          .eq('owner_id', auth.userId).in('id', input.evaluationIds);
        if (error) {
          if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') throw evaluationSchemaUnavailable();
          throw databaseUnavailable();
        }
        const rows = (data ?? []) as EvaluationRow[];
        // Treat other-owner and missing IDs identically to avoid confirming their existence.
        if (rows.length !== input.evaluationIds.length) throw new HttpError(404, 'NOT_FOUND', 'One or more evaluations were not found');
        const byId = new Map(rows.map((row) => [row.id, row]));
        const eligibleRows = input.evaluationIds.map((id, index) => {
          const row = byId.get(id)!;
          if (row.candidate_id !== input.candidateIds[index]) throw new HttpError(400, 'VALIDATION_ERROR', 'Each evaluation must belong to its corresponding candidate');
          if (row.status !== 'completed' && row.status !== 'insufficient_evidence') {
            throw new HttpError(422, 'EVALUATION_INCOMPLETE', 'Comparison requires evaluations with a persisted result; pending, in-progress, and failed evaluations cannot be compared');
          }
          return row;
        });
        const roles = new Set(eligibleRows.map(({ target_role }) => target_role));
        const versions = new Set(eligibleRows.map(({ scoring_version }) => scoring_version));
        if (roles.size !== 1) throw new HttpError(409, 'ROLE_VERSION_MISMATCH', 'Evaluations must use the same role to be compared');
        if (versions.size !== 1) throw new HttpError(409, 'SCORING_VERSION_MISMATCH', 'Evaluations must use the same scoring version to be compared');
        const ordered = eligibleRows.map((row) => {
          const result = validResult(row);
          if (!result) throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', 'An evaluation has a missing, malformed, or inconsistent result snapshot');
          return { row, result, weightsKey: weightKey(result.roleWeightsUsed) };
        });
        if (new Set(ordered.map(({ weightsKey }) => weightsKey)).size !== 1) throw new HttpError(409, 'ROLE_CONFIGURATION_MISMATCH', 'Evaluations must use the same role-weight snapshot to be compared');
        const payload = {
          roleId: ordered[0]!.row.target_role,
          scoringVersion: ordered[0]!.row.scoring_version,
          items: ordered.map(({ row, result }) => ({ candidateId: row.candidate_id, evaluationId: row.id, status: row.status, result })),
        };
        const parsed = candidateComparisonResponseSchema.safeParse(payload);
        if (!parsed.success) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Comparison data could not be processed');
        return parsed.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw databaseUnavailable();
      }
    },

    async ranking(auth, query) {
      const client = clientFor(auth);
      const version = query.scoringVersion ?? scoringVersion;
      if (version !== scoringVersion) throw new HttpError(409, 'SCORING_VERSION_UNSUPPORTED', `Scoring version ${version} is not supported for live rankings`);
      try {
        const [candidateResult, evaluationResult] = await Promise.all([
          client.from('candidates').select('id,full_name,github_username,leetcode_username').eq('owner_id', auth.userId).is('archived_at', null),
          client.from('evaluations')
          .select('id,candidate_id,status,overall_score,scoring_version,created_at,target_role,evaluation_result,role_weights_snapshot')
          .eq('owner_id', auth.userId).eq('target_role', query.roleId)
          .order('created_at', { ascending: false }).order('id', { ascending: true }),
        ]);
        if (candidateResult.error) throw databaseUnavailable();
        if (evaluationResult.error) {
          if (evaluationResult.error.code === '42703' || evaluationResult.error.code === 'PGRST204' || evaluationResult.error.code === 'PGRST205') throw evaluationSchemaUnavailable();
          throw databaseUnavailable();
        }
        const candidates = (candidateResult.data ?? []) as CandidateRow[];
        const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
        const latest = new Map<string, EvaluationRow>();
        for (const row of (evaluationResult.data ?? []) as EvaluationRow[]) {
          if (candidateById.has(row.candidate_id) && !latest.has(row.candidate_id)) latest.set(row.candidate_id, row);
        }
        const excluded = { incomplete: 0, scoringVersionMismatch: 0, missingScore: 0, invalidSnapshot: 0 };
        const ranked: Array<{ candidateId: string; evaluationId: string; score: number; evaluatedAt: string }> = [];
        const compatibleWeightKeys = new Set<string>();
        for (const row of latest.values()) {
          if (row.status !== 'completed') { excluded.incomplete += 1; continue; }
          if (row.scoring_version !== version) { excluded.scoringVersionMismatch += 1; continue; }
          const result = validResult(row);
          if (!result) { excluded.invalidSnapshot += 1; continue; }
          if (result.overallScore === undefined || row.overall_score === null) { excluded.missingScore += 1; continue; }
          const persistedScore = Number(row.overall_score);
          if (!Number.isFinite(persistedScore) || Math.abs(persistedScore - result.overallScore) >= 0.005) { excluded.invalidSnapshot += 1; continue; }
          compatibleWeightKeys.add(weightKey(result.roleWeightsUsed));
          ranked.push({ candidateId: row.candidate_id, evaluationId: row.id, score: result.overallScore, evaluatedAt: row.created_at });
        }
        if (compatibleWeightKeys.size > 1) throw new HttpError(409, 'ROLE_CONFIGURATION_MISMATCH', 'Eligible evaluations use different role-weight snapshots and cannot be ranked together');
        ranked.sort((left, right) => right.score - left.score
          || left.evaluatedAt.localeCompare(right.evaluatedAt)
          || left.candidateId.localeCompare(right.candidateId)
          || left.evaluationId.localeCompare(right.evaluationId));
        const rankByCandidateId = new Map(ranked.map((item, index) => [item.candidateId, index + 1]));
        const rankedByCandidateId = new Map(ranked.map((item) => [item.candidateId, item]));
        const latestByCandidateId = new Map(latest);
        const candidateRows = candidates.map((candidate) => {
          const row = latestByCandidateId.get(candidate.id);
          const result = row && row.scoring_version === version && ['completed', 'insufficient_evidence'].includes(row.status)
            ? validResult(row) : undefined;
          const rankedItem = rankedByCandidateId.get(candidate.id);
          const sourceScore = (source: 'github' | 'leetcode') => validatedPlatformScore(result, source);
          const missingEvidence = !row ? ['No saved evaluation for this role.']
            : result?.missingEvidence.length ? result.missingEvidence.map((id) => scoringCategories.find((category) => category.id === id)?.displayName ?? id)
              : rankedItem ? [] : row.status === 'failed' ? ['The saved evaluation failed.']
                : result ? ['A complete validated score is not available.'] : ['The saved evaluation could not be validated for this role.'];
          return {
            candidateId: candidate.id,
            candidateName: candidate.full_name,
            rank: rankedItem ? rankByCandidateId.get(candidate.id)! : null,
            finalScore: rankedItem?.score ?? null,
            evaluatedAt: rankedItem?.evaluatedAt ?? null,
            githubUsername: candidate.github_username?.trim() || savedUsername(result, 'github'),
            githubScore: sourceScore('github'),
            leetcodeUsername: candidate.leetcode_username?.trim() || savedUsername(result, 'leetcode'),
            leetcodeScore: sourceScore('leetcode'),
            evaluationStatus: rankedItem ? 'completed' as const
              : row?.status === 'insufficient_evidence' ? 'insufficient_evidence' as const
                : row?.status === 'failed' ? 'failed' as const
                  : row ? 'unavailable' as const : 'not_evaluated' as const,
            missingEvidence,
          };
        }).sort((left, right) => {
          const leftRank = rankByCandidateId.get(left.candidateId);
          const rightRank = rankByCandidateId.get(right.candidateId);
          if (leftRank !== undefined || rightRank !== undefined) {
            if (leftRank === undefined) return 1;
            if (rightRank === undefined) return -1;
            if (leftRank !== rightRank) return leftRank - rightRank;
          }
          return left.candidateName.localeCompare(right.candidateName) || left.candidateId.localeCompare(right.candidateId);
        });
        const offset = (query.page - 1) * query.pageSize;
        const payload = {
          roleId: query.roleId, scoringVersion: version,
          items: ranked.slice(offset, offset + query.pageSize).map((item, index) => ({ ...item, rank: offset + index + 1 })),
          candidateRows,
          page: query.page, pageSize: query.pageSize, total: ranked.length, excluded,
        };
        const parsed = rankingResponseSchema.safeParse(payload);
        if (!parsed.success) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Ranking data could not be processed');
        return parsed.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw databaseUnavailable();
      }
    },

    async providerRanking(auth, query) {
      const client = clientFor(auth);
      try {
        const { data, error } = await client.from('evaluations')
          .select('id,candidate_id,status,overall_score,scoring_version,created_at,target_role,evaluation_result,role_weights_snapshot')
          .eq('owner_id', auth.userId).eq('target_role', query.roleId)
          .order('created_at', { ascending: false }).order('id', { ascending: true });
        if (error) {
          if (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST205') throw evaluationSchemaUnavailable();
          throw databaseUnavailable();
        }
        const latest = new Map<string, EvaluationRow>();
        for (const row of (data ?? []) as EvaluationRow[]) if (!latest.has(row.candidate_id)) latest.set(row.candidate_id, row);
        const candidateIds = [...latest.keys()];
        const candidatesResult = candidateIds.length
          ? await client.from('candidates').select('id,full_name').eq('owner_id', auth.userId).is('archived_at', null).in('id', candidateIds)
          : { data: [], error: null };
        if (candidatesResult.error) throw databaseUnavailable();
        const names = new Map(((candidatesResult.data ?? []) as Array<{ id: string; full_name: string }>).map(({ id, full_name }) => [id, full_name]));
        const ranked: Array<{ candidateId: string; candidateName: string; evaluationId: string; evaluatedAt: string; githubScore: number; githubCoverage: ReturnType<typeof providerScoresFromEvaluation>['githubCoverage']; leetcodeScore: number; combinedScore: number }> = [];
        const incomplete: Array<{ candidateId: string; candidateName: string; evaluationId: string; evaluatedAt: string; githubScore?: number; githubCoverage: ReturnType<typeof providerScoresFromEvaluation>['githubCoverage']; leetcodeScore?: number }> = [];
        for (const row of latest.values()) {
          const candidateName = names.get(row.candidate_id);
          if (!candidateName) continue;
          const result = row.status === 'completed' || row.status === 'insufficient_evidence' ? validResult(row) : undefined;
          const scores = result?.candidateId === row.candidate_id
            ? providerScoresFromEvaluation(result, row.candidate_id)
            : { githubCoverage: { availableCategories: 0, totalCategories: 5 as const, status: 'unavailable' as const } };
          const base = { candidateId: row.candidate_id, candidateName, evaluationId: row.id, evaluatedAt: row.created_at,
            githubCoverage: scores.githubCoverage };
          const combinedScore = combineProviderScores(scores.githubScore, scores.leetcodeScore);
          if (combinedScore !== undefined && scores.githubScore !== undefined && scores.leetcodeScore !== undefined) {
            ranked.push({ ...base, githubScore: scores.githubScore, leetcodeScore: scores.leetcodeScore, combinedScore });
          } else {
            incomplete.push({ ...base, ...(scores.githubScore !== undefined ? { githubScore: scores.githubScore } : {}),
              ...(scores.leetcodeScore !== undefined ? { leetcodeScore: scores.leetcodeScore } : {}) });
          }
        }
        ranked.sort((left, right) => right.combinedScore - left.combinedScore
          || left.evaluatedAt.localeCompare(right.evaluatedAt)
          || left.candidateId.localeCompare(right.candidateId)
          || left.evaluationId.localeCompare(right.evaluationId));
        incomplete.sort((left, right) => left.candidateId.localeCompare(right.candidateId)
          || left.evaluationId.localeCompare(right.evaluationId));
        const rankedItems = ranked.map((item, index) => ({ ...item, rank: index + 1, status: 'ranked' as const, missingProviders: [] as ('github' | 'leetcode')[] }));
        const incompleteItems = incomplete.map((item) => ({ ...item, status: 'incomplete' as const,
          missingProviders: [...(item.githubScore === undefined ? ['github' as const] : []), ...(item.leetcodeScore === undefined ? ['leetcode' as const] : [])] }));
        const items = [...rankedItems, ...incompleteItems];
        const offset = (query.page - 1) * query.pageSize;
        const payload = {
          mode: providerRankingMode, roleId: query.roleId, rubricId: 'github_leetcode_v4', scoringVersion,
          providerWeights: providerRankingWeights,
          items: items.slice(offset, offset + query.pageSize), page: query.page, pageSize: query.pageSize,
          rankedTotal: ranked.length, incompleteTotal: incomplete.length,
        };
        const parsed = providerRankingResponseSchema.safeParse(payload);
        if (!parsed.success) throw new HttpError(500, 'INVALID_DATABASE_RESPONSE', 'Provider ranking data could not be processed');
        return parsed.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw databaseUnavailable();
      }
    },
  };
}

export const insightsRepository = createInsightsRepository();
