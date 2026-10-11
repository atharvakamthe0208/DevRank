import {
  candidatePlatformResponseSchema,
  githubSyncResponseSchema,
  type CandidatePlatformResponse,
  type CandidatePlatformSubmission,
  type GitHubProfileResponse,
  type GitHubSyncResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { githubAdapter } from '../services/github-adapter.js';
import type { AuthContext } from '../types/auth.js';

export interface CandidatePlatformRepository {
  submit(auth: AuthContext, candidateId: string, input: CandidatePlatformSubmission): Promise<CandidatePlatformResponse>;
  syncGitHub(auth: AuthContext, candidateId: string, profile: string): Promise<GitHubSyncResponse>;
}

function unavailable(operation: string): never {
  throw new HttpError(503, 'DATABASE_UNAVAILABLE', `Unable to ${operation} right now`);
}

export function createCandidatePlatformRepository(
  getClient = getSupabaseClient,
  getGitHubProfile: (profile: string) => Promise<GitHubProfileResponse> = (profile) => githubAdapter.getProfile(profile),
): CandidatePlatformRepository {
  return {
    async submit(auth, candidateId, input) {
      let client;
      try {
        client = getClient(auth.accessToken);
      } catch {
        throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Platform data storage is not configured');
      }

      try {
        const { data: candidate, error: candidateError } = await client
          .from('candidates')
          .select('id')
          .eq('id', candidateId)
          .eq('owner_id', auth.userId)
          .is('archived_at', null)
          .maybeSingle();
        if (candidateError) unavailable('verify the candidate');
        if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');

        const rawEvidence = {
          provenance: 'candidate_provided',
          ...(input.profileUrl ? { profileUrl: input.profileUrl } : {}),
          ...(input.handle ? { handle: input.handle } : {}),
          ...(input.statistics ? { statistics: input.statistics } : {}),
        };
        const normalizedEvidence = {
          platform: input.platform,
          provenance: 'candidate_provided',
          ...(input.profileUrl ? { profileUrl: input.profileUrl } : {}),
          ...(input.handle ? { handle: input.handle } : {}),
          ...(input.statistics ? { statistics: input.statistics } : {}),
        };
        const { data, error } = await client
          .from('platform_evidence')
          .insert({
            candidate_id: candidateId,
            owner_id: auth.userId,
            source: input.platform,
            availability: input.availability,
            raw_evidence: rawEvidence,
            normalized_evidence: normalizedEvidence,
          })
          .select('id,candidate_id,source,availability,raw_evidence,created_at')
          .single();
        if (error || !data) unavailable('save platform data');

        const savedRaw = data.raw_evidence as typeof rawEvidence;
        return candidatePlatformResponseSchema.parse({
          id: data.id,
          candidateId: data.candidate_id,
          platform: data.source,
          availability: data.availability,
          provenance: savedRaw.provenance,
          ...(savedRaw.profileUrl ? { profileUrl: savedRaw.profileUrl } : {}),
          ...(savedRaw.handle ? { handle: savedRaw.handle } : {}),
          ...(savedRaw.statistics ? { statistics: savedRaw.statistics } : {}),
          submittedAt: data.created_at,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('save platform data');
      }
    },
    async syncGitHub(auth, candidateId, profile) {
      let client;
      try {
        client = getClient(auth.accessToken);
      } catch {
        throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Platform data storage is not configured');
      }

      let candidate;
      try {
        const result = await client
          .from('candidates')
          .select('id')
          .eq('id', candidateId)
          .eq('owner_id', auth.userId)
          .is('archived_at', null)
          .maybeSingle();
        if (result.error) unavailable('verify the candidate');
        candidate = result.data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('verify the candidate');
      }
      if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');

      // The adapter returns only the validated, public fields needed by the recruiter UI.
      const profileData = await getGitHubProfile(profile);
      try {
        const { data, error } = await client
          .from('platform_evidence')
          .insert({
            candidate_id: candidateId,
            owner_id: auth.userId,
            source: 'github',
            availability: 'available',
            raw_evidence: { username: profileData.username, profileUrl: profileData.profileUrl },
            normalized_evidence: profileData,
            observed_at: new Date().toISOString(),
          })
          .select('id,candidate_id,created_at')
          .single();
        if (error || !data) unavailable('save GitHub profile data');
        return githubSyncResponseSchema.parse({
          id: data.id,
          candidateId: data.candidate_id,
          source: 'github',
          availability: 'available',
          provenance: 'github_api',
          syncedAt: data.created_at,
          profile: profileData,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('save GitHub profile data');
      }
    },
  };
}

export const candidatePlatformRepository = createCandidatePlatformRepository();
