import {
  evaluationRoleSchema,
  evaluationRolesResponseSchema,
  evaluationRunResponseSchema,
  type EvaluationRole,
  type EvaluationRolesResponse,
  type EvaluationRunRequest,
  type EvaluationRunResponse,
} from '@devrank/contracts';
import { loadRoleWeightConfiguration } from '../modules/scoring/index.js';
import { processCandidateEvidence } from '../modules/evidence-processing/index.js';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import type { AuthContext } from '../types/auth.js';

export interface EvaluationRepository {
  listRoles(): EvaluationRolesResponse;
  run(auth: AuthContext, input: EvaluationRunRequest): Promise<EvaluationRunResponse>;
}

const roleNames: Record<EvaluationRole['id'], string> = {
  software_developer: 'Software Developer',
  ai_ml_engineer: 'AI/ML Engineer',
  data_analyst: 'Data Analyst',
};

function configuredRoles() {
  const configuration = loadRoleWeightConfiguration();
  return evaluationRolesResponseSchema.parse({
    roles: Object.entries(configuration.roles).map(([id, weights]) => evaluationRoleSchema.parse({
      id,
      displayName: roleNames[id as EvaluationRole['id']],
      weights,
    })),
  });
}

export function createEvaluationRepository(getClient = getSupabaseClient): EvaluationRepository {
  return {
    listRoles() {
      return configuredRoles();
    },
    async run(auth, input) {
      let client;
      try {
        client = getClient(auth.accessToken);
      } catch {
        throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Evaluation service is not configured');
      }

      let candidate: { id: string; full_name: string } | null;
      try {
        const result = await client.from('candidates')
          .select('id,full_name')
          .eq('id', input.candidateId)
          .eq('owner_id', auth.userId)
          .is('archived_at', null)
          .maybeSingle();
        if (result.error) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to run this evaluation right now');
        candidate = result.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Unable to run this evaluation right now');
      }
      if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');

      // Platform snapshots are not mapped to category scores by the approved evidence rubric.
      // Until evidence with an explicit normalized value is collected, score only the supplied
      // evidence (currently none); the scorer returns six honest insufficient-evidence results.
      const evaluation = processCandidateEvidence({
        candidateId: candidate.id,
        targetRole: input.roleId,
        evidence: [],
      }).evaluation;
      const role = configuredRoles().roles.find(({ id }) => id === input.roleId);
      if (!role) throw new HttpError(400, 'VALIDATION_ERROR', 'Select a supported role');
      return evaluationRunResponseSchema.parse({
        candidate: { id: candidate.id, name: candidate.full_name },
        role,
        evaluatedAt: new Date().toISOString(),
        evaluation,
        evidenceLimitations: ['No rubric-scored assessment evidence is available. Platform profile counts are not converted into category scores.'],
      });
    },
  };
}

export const evaluationRepository = createEvaluationRepository();
