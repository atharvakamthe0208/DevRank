import {
  evaluationResponseSchema,
  evaluationRoleSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  legacyEvaluationResponseV1Schema,
  persistedEvaluationSchema,
  roleIdSchema,
  roleWeightsSchema,
  type AiAnalysisResult,
  type EvaluationResponse,
  type EvaluationRequest,
  type EvaluationRole,
  type EvaluationRolesResponse,
  type EvaluationRunRequest,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { processCandidateEvidence } from '../modules/evidence-processing/index.js';
import { analyzeEvaluation, attachAiAnalysis } from '../modules/ai/index.js';
import { loadRoleWeightConfiguration } from '../modules/scoring/index.js';
import type { AuthContext } from '../types/auth.js';

export interface EvaluationRepository {
  listRoles(): EvaluationRolesResponse;
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

export type EvaluationAnalyzer = (evaluation: EvaluationResponse) => Promise<AiAnalysisResult>;

function configuredRoles(): EvaluationRolesResponse {
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

export function createEvaluationRepository(
  getClient = getSupabaseClient,
  analyze: EvaluationAnalyzer = analyzeEvaluation,
): EvaluationRepository {
  async function persist(
    client: ReturnType<typeof getSupabaseClient>,
    auth: AuthContext,
    candidate: { id: string },
    roleProfileId: string | null,
    targetRole: EvaluationRole['id'],
    weights: unknown,
    includeAiAnalysis = false,
  ) {
    const checkedWeights = roleWeightsSchema.safeParse(weights);
    if (!checkedWeights.success) {
      throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define five valid weights totaling 100');
    }
    const { data: rows, error: evidenceError } = await client.from('platform_evidence')
      .select('id,source,availability,normalized_evidence,observed_at,created_at')
      .eq('candidate_id', candidate.id).eq('owner_id', auth.userId).order('created_at', { ascending: true });
    if (evidenceError || !rows) throw unavailable();

    // Provider snapshots and raw metrics remain provenance; only explicit contract evidence is scoreable.
    const configuredScoring = loadRoleWeightConfiguration();
    const configuration = { ...configuredScoring, roles: { [targetRole]: checkedWeights.data } };
    const { evaluation } = processCandidateEvidence({
      candidateId: candidate.id, targetRole, evidence: makeEvidence(rows as Array<Record<string, unknown>>),
    }, { roleWeights: configuration });
    const deterministicResult = evaluationResponseSchema.parse(evaluation);
    // Keep the owner-defined route's optional explanation behavior; configured-role runs persist deterministic output.
    const result = includeAiAnalysis ? await attachAiAnalysis(deterministicResult, analyze) : deterministicResult;
    const { data: saved, error: insertError } = await client.from('evaluations').insert({
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
    }).select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result').single();
    if (insertError || !saved) throw unavailable();
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
    const { data, error } = await client.from('candidates').select('id,full_name')
      .eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle();
    if (error) throw unavailable();
    if (!data) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
    return data;
  }

  return {
    listRoles() { return configuredRoles(); },
    async run(auth, input) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const candidate = await ownedCandidate(client, auth, input.candidateId);
        const role = configuredRoles().roles.find(({ id }) => id === input.roleId);
        if (!role) throw new HttpError(400, 'VALIDATION_ERROR', 'Select a supported role');
        const stored = await persist(client, auth, candidate, null, role.id, role.weights);
        const result = evaluationResponseSchema.parse(stored.result);
        return evaluationRunResponseSchema.parse({
          id: stored.id,
          status: stored.status,
          candidate: { id: candidate.id, name: candidate.full_name },
          role,
          evaluatedAt: stored.createdAt,
          evaluation: result,
          evidenceLimitations: result.missingEvidence.length > 0
            ? ['Insufficient rubric-normalized evidence is available for a complete overall score. Platform counts are not converted into category scores.']
            : [],
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
    async create(auth, candidateId, input) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const candidate = await ownedCandidate(client, auth, candidateId);
        const { data: role, error } = await client.from('role_profiles').select('id,name,weights')
          .eq('id', input.roleProfileId).eq('owner_id', auth.userId).maybeSingle();
        if (error) throw unavailable();
        if (!role) throw new HttpError(404, 'ROLE_PROFILE_NOT_FOUND', 'Role profile not found');
        const targetRole = roleIdSchema.safeParse(role.name);
        if (!targetRole.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'Role profile name must match a supported role identifier');
        return persistedEvaluationSchema.parse(await persist(
          client, auth, candidate, input.roleProfileId, targetRole.data, role.weights, true,
        ));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
    async get(auth, id) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const { data, error } = await client.from('evaluations')
          .select('id,candidate_id,role_profile_id,target_role,status,created_at,evaluation_result')
          .eq('id', id).eq('owner_id', auth.userId).maybeSingle();
        if (error) throw unavailable();
        if (!data) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
        if (!data.evaluation_result) {
          throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', 'This evaluation predates the stored result format');
        }
        const currentResult = evaluationResponseSchema.safeParse(data.evaluation_result);
        const legacyResult = currentResult.success ? null : legacyEvaluationResponseV1Schema.safeParse(data.evaluation_result);
        const result = currentResult.success ? currentResult.data : legacyResult?.success ? legacyResult.data : null;
        if (!result) {
          throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', 'The stored evaluation result is not a supported snapshot');
        }
        const targetRole = data.target_role ?? result.targetRole;
        return persistedEvaluationSchema.parse({
          id: data.id,
          candidateId: data.candidate_id,
          roleProfileId: data.role_profile_id,
          targetRole,
          status: data.status,
          createdAt: data.created_at,
          result,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
  };
}

export const evaluationRepository = createEvaluationRepository();
