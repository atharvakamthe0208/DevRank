import {
  candidatePlatformResponseSchema,
  candidatePlatformDataResponseSchema,
  githubSyncResponseSchema,
  leetCodeSyncResponseSchema,
  type CandidatePlatformResponse,
  type CandidatePlatformDataResponse,
  type CandidatePlatformSubmission,
  type GitHubProfileResponse,
  type GitHubSyncResponse,
  type LeetCodeSyncResponse,
} from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/http-error.js';
import { githubAdapter } from '../services/github-adapter.js';
import { leetCodeAdapter, type NormalizedLeetCodeProfile } from '../services/leetcode-adapter.js';
import type { AuthContext } from '../types/auth.js';

export interface CandidatePlatformRepository {
  getLatest(auth: AuthContext, candidateId: string): Promise<CandidatePlatformDataResponse>;
  submit(auth: AuthContext, candidateId: string, input: CandidatePlatformSubmission): Promise<CandidatePlatformResponse>;
  syncGitHub(auth: AuthContext, candidateId: string, profile: string): Promise<GitHubSyncResponse>;
  syncLeetCode(auth: AuthContext, candidateId: string, profile: string): Promise<LeetCodeSyncResponse>;
}

function unavailable(operation: string): never {
  throw new HttpError(503, 'DATABASE_UNAVAILABLE', `Unable to ${operation} right now`);
}

type DatabaseFailure = { code?: unknown; message?: unknown; hint?: unknown; status?: unknown };

function safeDiagnostic(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.replace(/[\r\n\t]/g, ' ').replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(token|secret|password|key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .slice(0, 300);
}

function githubSaveFailure(
  failure: unknown,
  logFailure: (diagnostics: Record<string, string | number>) => void,
  stage: 'lookup' | 'save' = 'save',
): never {
  const error = failure && typeof failure === 'object' ? failure as DatabaseFailure : {};
  const code = typeof error.code === 'string' && /^[A-Z0-9_-]{1,32}$/i.test(error.code) ? error.code : undefined;
  const status = typeof error.status === 'number' ? error.status : undefined;
  const message = safeDiagnostic(error.message);
  const hint = safeDiagnostic(error.hint);
  logFailure({ stage, ...(code ? { code } : {}), ...(message ? { message } : {}), ...(status ? { status } : {}), ...(hint ? { hint } : {}) });
  if (code === '42501' || status === 403) {
    throw new HttpError(403, 'GITHUB_DATABASE_PERMISSION_DENIED', 'The database denied saving GitHub data. Check the candidate ownership and platform_evidence permissions.');
  }
  if (stage === 'lookup') {
    throw new HttpError(503, 'GITHUB_DATA_LOOKUP_FAILED', 'Could not check the saved GitHub snapshot. Check the API logs and database permissions, then retry.');
  }
  throw new HttpError(503, 'GITHUB_DATA_SAVE_FAILED', 'GitHub data was retrieved, but the database could not save it. Check the API logs and database schema/permissions, then retry.');
}

export function createCandidatePlatformRepository(
  getClient = getSupabaseClient,
  getGitHubProfile: (profile: string) => Promise<GitHubProfileResponse> = (profile) => githubAdapter.getProfile(profile),
  logGitHubSaveFailure: (diagnostics: Record<string, string | number>) => void = (diagnostics) => {
    if (env.NODE_ENV === 'development') console.error('DevRank GitHub profile persistence failed', diagnostics);
  },
  getLeetCodeProfile: (profile: string) => Promise<NormalizedLeetCodeProfile> = (profile) => leetCodeAdapter.getProfile(profile),
): CandidatePlatformRepository {
  return {
    async getLatest(auth, candidateId) {
      let client;
      try { client = getClient(auth.accessToken); } catch {
        throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Platform data storage is not configured');
      }
      try {
        const { data: candidate, error: candidateError } = await client.from('candidates')
          .select('id').eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle();
        if (candidateError) unavailable('verify the candidate');
        if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
        const { data, error } = await client.from('platform_evidence')
          .select('id,candidate_id,source,availability,raw_evidence,normalized_evidence,created_at,observed_at')
          .eq('candidate_id', candidateId).eq('owner_id', auth.userId).order('created_at', { ascending: false });
        if (error || !data) unavailable('load platform data');
        const latest = new Map<string, (typeof data)[number]>();
        for (const row of data) {
          const raw = row.raw_evidence as Record<string, unknown>;
          const key = row.source === 'leetcode' && raw?.provenance === 'alfa_leetcode_api' ? 'leetcode_sync' : row.source;
          if (!latest.has(key)) latest.set(key, row);
        }
        const items: Array<import('@devrank/contracts').CandidatePlatformResponse | GitHubSyncResponse | LeetCodeSyncResponse> = [];
        for (const row of latest.values()) {
          if (row.source === 'github' && row.availability === 'available') {
            const parsed = githubSyncResponseSchema.safeParse({
              id: row.id, candidateId: row.candidate_id, source: 'github', availability: 'available',
              provenance: 'github_api', syncedAt: row.observed_at ?? row.created_at,
              profile: row.normalized_evidence,
            });
            if (parsed.success) items.push(parsed.data);
            continue;
          }
          if ((row.source === 'leetcode' || row.source === 'hackerrank') && ['available', 'unavailable', 'not_provided'].includes(row.availability)) {
            const raw = row.raw_evidence as Record<string, unknown>;
            if (row.source === 'leetcode' && raw?.provenance === 'alfa_leetcode_api') {
              const parsed = leetCodeSyncResponseSchema.safeParse({
                id: row.id, candidateId: row.candidate_id, platform: 'leetcode', availability: 'available',
                provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api',
                handle: raw.handle, profileUrl: raw.profileUrl,
                statistics: (row.normalized_evidence as Record<string, unknown> | null)?.statistics,
                syncedAt: row.observed_at ?? row.created_at,
              });
              if (parsed.success) items.push(parsed.data);
              continue;
            }
            const parsed = candidatePlatformResponseSchema.safeParse({
              id: row.id, candidateId: row.candidate_id, platform: row.source, availability: row.availability,
              provenance: raw?.provenance, profileUrl: raw?.profileUrl, handle: raw?.handle,
              statistics: raw?.statistics, submittedAt: row.created_at,
            });
            if (parsed.success) items.push(parsed.data);
          }
        }
        return candidatePlatformDataResponseSchema.parse({ items });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('load platform data');
      }
    },
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
      const syncedAt = new Date().toISOString();
      let saved: { id: string; candidate_id: string; observed_at: string | null };
      try {
        const { data: existing, error: lookupError } = await client
          .from('platform_evidence')
          .select('id')
          .eq('candidate_id', candidateId)
          .eq('owner_id', auth.userId)
          .eq('source', 'github')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lookupError) githubSaveFailure(lookupError, logGitHubSaveFailure, 'lookup');

        const snapshot = {
          candidate_id: candidateId,
          owner_id: auth.userId,
          source: 'github',
          availability: 'available',
          raw_evidence: { username: profileData.username, profileUrl: profileData.profileUrl },
          normalized_evidence: profileData,
          observed_at: syncedAt,
        };
        const writeResult = existing?.id
          ? await client.from('platform_evidence').update(snapshot)
            .eq('id', existing.id)
            .eq('candidate_id', candidateId)
            .eq('owner_id', auth.userId)
            .eq('source', 'github')
            .select('id,candidate_id,observed_at')
            .single()
          : await client.from('platform_evidence').insert(snapshot)
            .select('id,candidate_id,observed_at')
            .single();
        const { data, error } = writeResult;
        if (error) githubSaveFailure(error, logGitHubSaveFailure);
        if (!data) githubSaveFailure({ message: 'Database returned no saved row after GitHub evidence insert' }, logGitHubSaveFailure);
        saved = data;
      } catch (error) {
        if (error instanceof HttpError) throw error;
        githubSaveFailure(error, logGitHubSaveFailure);
      }

      const response = githubSyncResponseSchema.safeParse({
        id: saved.id,
        candidateId: saved.candidate_id,
        source: 'github',
        availability: 'available',
        provenance: 'github_api',
        syncedAt: saved.observed_at ?? syncedAt,
        profile: profileData,
      });
      if (!response.success) {
        logGitHubSaveFailure({ stage: 'response', message: safeDiagnostic(response.error.message) ?? 'Invalid GitHub sync response' });
        throw new HttpError(502, 'GITHUB_RESPONSE_INVALID', 'GitHub data was saved, but the API could not format the saved response. Reload the candidate data or retry the sync.');
      }
      return response.data;
    },
    async syncLeetCode(auth, candidateId, profile) {
      let client;
      try { client = getClient(auth.accessToken); }
      catch { throw new HttpError(503, 'DATABASE_NOT_CONFIGURED', 'Platform data storage is not configured'); }

      try {
        const { data: candidate, error } = await client.from('candidates')
          .select('id').eq('id', candidateId).eq('owner_id', auth.userId).is('archived_at', null).maybeSingle();
        if (error) unavailable('verify the candidate');
        if (!candidate) throw new HttpError(404, 'NOT_FOUND', 'Candidate not found');
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('verify the candidate');
      }

      // Fetch and validate before inserting so a failed refresh never replaces the last saved snapshot.
      const profileData = await getLeetCodeProfile(profile);
      const syncedAt = new Date().toISOString();
      try {
        const { data, error } = await client.from('platform_evidence').insert({
          candidate_id: candidateId,
          owner_id: auth.userId,
          source: 'leetcode',
          availability: 'available',
          raw_evidence: { provenance: profileData.provenance, provider: profileData.provider, handle: profileData.handle, profileUrl: profileData.profileUrl },
          normalized_evidence: profileData,
          observed_at: syncedAt,
        }).select('id,candidate_id,observed_at').single();
        if (error || !data) unavailable('save LeetCode profile data');
        return leetCodeSyncResponseSchema.parse({
          id: data.id,
          candidateId: data.candidate_id,
          ...profileData,
          availability: 'available',
          syncedAt: data.observed_at ?? syncedAt,
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        unavailable('save LeetCode profile data');
      }
    },
  };
}

export const candidatePlatformRepository = createCandidatePlatformRepository();
