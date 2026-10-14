import { candidateEvaluationsResponseSchema, evaluationResponseSchema, persistedEvaluationSchema, roleIdSchema, roleWeightsSchema, type AiAnalysisResult, type EvaluationRequest, type EvaluationResponse, roleProfileListResponseSchema } from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { processCandidateEvidence } from '../modules/evidence-processing/index.js';
import { analyzeEvaluation, attachAiAnalysis } from '../modules/ai/index.js';
import { loadRoleWeightConfiguration } from '../modules/scoring/index.js';
import type { AuthContext } from '../types/auth.js';

export interface EvaluationRepository {
  listRoleProfiles(auth: AuthContext): Promise<unknown>;
  listForCandidate(auth: AuthContext, candidateId: string): Promise<unknown>;
  create(auth: AuthContext, candidateId: string, input: EvaluationRequest): Promise<unknown>;
  get(auth: AuthContext, id: string): Promise<unknown>;
}
const unavailable = () => new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to process the evaluation right now');

export type EvaluationAnalyzer = (evaluation: EvaluationResponse) => Promise<AiAnalysisResult>;

export function createEvaluationRepository(
  getClient = getSupabaseClient,
  analyze: EvaluationAnalyzer = analyzeEvaluation,
): EvaluationRepository {
  return {
    async listForCandidate(auth, candidateId) {
      let client;
      try { client = getClient(auth.accessToken); } catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const { data: candidate, error: candidateError } = await client.from('candidates').select('id').eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle();
        if (candidateError) throw unavailable();
        if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
        const { data, error } = await client.from('evaluations').select('id,candidate_id,role_profile_id,status,created_at,evaluation_result').eq('candidate_id', candidateId).eq('owner_id', auth.userId).order('created_at', { ascending: false }).limit(20);
        if (error || !data) throw unavailable();
        return candidateEvaluationsResponseSchema.parse({ items: data.map((row) => ({ id: row.id, candidateId: row.candidate_id, roleProfileId: row.role_profile_id, status: row.status, createdAt: row.created_at, result: row.evaluation_result })) });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
    async listRoleProfiles(auth) {
      let client;
      try { client = getClient(auth.accessToken); } catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Role profiles are not configured'); }
      try {
        const { data, error } = await client.from('role_profiles').select('id,name,description,weights').eq('owner_id', auth.userId).order('name', { ascending: true });
        if (error || !data) throw unavailable();
        return roleProfileListResponseSchema.parse({ items: data.map((profile) => {
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
        }) });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
    async create(auth, candidateId, input) {
      let client;
      try { client = getClient(auth.accessToken); } catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const { data: candidate, error: candidateError } = await client.from('candidates').select('id').eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle();
        if (candidateError) throw unavailable();
        if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
        const { data: role, error: roleError } = await client.from('role_profiles').select('id,name,weights').eq('id', input.roleProfileId).eq('owner_id', auth.userId).maybeSingle();
        if (roleError) throw unavailable();
        if (!role) throw new HttpError(404, 'ROLE_PROFILE_NOT_FOUND', 'Role profile not found');
        const targetRole = roleIdSchema.safeParse(role.name);
        const weights = roleWeightsSchema.safeParse(role.weights);
        if (!targetRole.success || !weights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'Role profile must use a supported role name and five valid weights totaling 100');

        const { data: rows, error: evidenceError } = await client.from('platform_evidence').select('id,source,availability,normalized_evidence,observed_at,created_at').eq('candidate_id', candidateId).eq('owner_id', auth.userId).order('created_at', { ascending: true });
        if (evidenceError || !rows) throw unavailable();
        // Only explicit normalized contract evidence is scoreable. Provider snapshots and raw stats remain provenance, not inferred scores.
        const evidence = rows.flatMap((row) => {
          const value = row.normalized_evidence;
          if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
          const item = value as Record<string, unknown>;
          if (!('evidenceId' in item && 'evidenceType' in item)) return [];
          return [{ ...item, evidenceId: row.id, source: row.source, availability: row.availability === 'available' ? 'available' : 'missing', ...(row.observed_at ? { observedAt: row.observed_at } : {}) }];
        });
        const configuredScoring = loadRoleWeightConfiguration();
        const config = { ...configuredScoring, roles: { [targetRole.data]: weights.data } };
        const { evaluation } = processCandidateEvidence({ candidateId, targetRole: targetRole.data, evidence }, { roleWeights: config });
        const deterministicResult = evaluationResponseSchema.parse(evaluation);
        const validResult = await attachAiAnalysis(deterministicResult, analyze);
        const status = validResult.evaluationStatus;
        const { data: saved, error: insertError } = await client.from('evaluations').insert({
          owner_id: auth.userId, candidate_id: candidateId, role_profile_id: input.roleProfileId,
          status, overall_score: validResult.overallScore ?? null, scoring_version: validResult.scoringVersion,
          evidence_snapshot: validResult.evidence, role_weights_snapshot: validResult.roleWeightsUsed, evaluation_result: validResult,
        }).select('id,candidate_id,role_profile_id,status,created_at,evaluation_result').single();
        if (insertError || !saved) throw unavailable();
        return persistedEvaluationSchema.parse({ id: saved.id, candidateId: saved.candidate_id, roleProfileId: saved.role_profile_id, status: saved.status, createdAt: saved.created_at, result: saved.evaluation_result });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
    async get(auth, id) {
      let client;
      try { client = getClient(auth.accessToken); } catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation storage is not configured'); }
      try {
        const { data, error } = await client.from('evaluations').select('id,candidate_id,role_profile_id,status,created_at,evaluation_result').eq('id', id).eq('owner_id', auth.userId).maybeSingle();
        if (error) throw unavailable();
        if (!data) throw new HttpError(404, 'NOT_FOUND', 'Evaluation not found');
        return persistedEvaluationSchema.parse({ id: data.id, candidateId: data.candidate_id, roleProfileId: data.role_profile_id, status: data.status, createdAt: data.created_at, result: data.evaluation_result });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw unavailable();
      }
    },
  };
}
export const evaluationRepository = createEvaluationRepository();
