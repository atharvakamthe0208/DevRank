import {
  candidateEvaluationsResponseSchema,
  evaluationResponseSchema,
  evaluationRoleSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  persistedEvaluationSchema,
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
    if (!checkedWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define five valid v2 category weights totaling 100');
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
    const result = evaluationResponseSchema.parse(evaluation);
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
    const items = data.map((row: Record<string, unknown>) => {
      const parsed = persistedEvaluationSchema.safeParse({
        id: row.id, candidateId: row.candidate_id, roleProfileId: row.role_profile_id,
        targetRole: row.target_role, status: row.status, createdAt: row.created_at, result: row.evaluation_result,
      });
      if (!parsed.success) throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', 'One or more saved evaluations use a legacy or unsupported result format');
      return parsed.data;
    });
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
        if (!profileWeights.success && typeof role.weights === 'object' && role.weights !== null && 'communication_skills' in role.weights) {
          throw new HttpError(422, 'ROLE_PROFILE_REQUIRES_V2_WEIGHTS', 'This saved role profile uses the legacy six-category scoring model. Update it to five approved v2 category weights before evaluating; its stored configuration has not been modified.');
        }
        if (!profileWeights.success) throw new HttpError(422, 'ROLE_CONFIGURATION_INVALID', 'The selected role must define five valid v2 category weights totaling 100');
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
        if (!data.target_role || !data.evaluation_result) {
          throw new HttpError(409, 'EVALUATION_RESULT_UNAVAILABLE', 'This evaluation predates the stored result format');
        }
        const parsed = persistedEvaluationSchema.safeParse({
          id: data.id, candidateId: data.candidate_id, roleProfileId: data.role_profile_id,
          targetRole: data.target_role, status: data.status, createdAt: data.created_at, result: data.evaluation_result,
        });
        if (!parsed.success) throw new HttpError(409, 'SCORING_VERSION_UNSUPPORTED', 'This saved evaluation uses a legacy or unsupported scoring version and was not recalculated');
        return parsed.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        databaseFailure(error, 'evaluation_processing', 'thrown_exception');
      }
    },
  };
}

export const evaluationRepository = createEvaluationRepository();
