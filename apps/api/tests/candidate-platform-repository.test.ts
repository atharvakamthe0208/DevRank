import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { candidatePlatformSubmissionSchema } from '@devrank/contracts';
import { createCandidatePlatformRepository } from '../src/repositories/candidate-platform-repository.js';
import type { NormalizedLeetCodeProfile } from '../src/services/leetcode-adapter.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const evidenceId = 'ea574cd8-8d21-4586-a887-dc2a6fc7ba08';

function query(maybeSingleResult: unknown, singleResult: unknown, listResult: unknown = { data: [], error: null }) {
  const builder: Record<string, any> = {};
  for (const method of ['select', 'eq', 'is', 'order', 'limit']) builder[method] = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => maybeSingleResult);
  builder.single = vi.fn(async () => singleResult);
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(listResult).then(resolve, reject);
  return builder;
}

function createClient(candidateResult: unknown, evidenceResult: unknown, existingEvidenceResult: unknown = { data: null, error: null }, listEvidenceResult: unknown = { data: [], error: null }) {
  const candidateQuery = query(candidateResult, undefined, candidateResult);
  const evidenceQuery = query(existingEvidenceResult, evidenceResult, listEvidenceResult);
  const client = {
    from: vi.fn((table: string) => table === 'candidates' ? candidateQuery : evidenceQuery),
  } as unknown as SupabaseClient;
  return { client, candidateQuery, evidenceQuery };
}

describe('candidate platform evidence repository', () => {
  const auth = { userId: ownerId, accessToken: 'verified-token' };
  const input = candidatePlatformSubmissionSchema.parse({
    platform: 'leetcode',
    handle: 'example',
    availability: 'available',
    statistics: { problemsSolved: 0 },
  });

  it('checks ownership and persists normalized evidence without changing zero or provenance', async () => {
    const evidence = {
      provenance: 'candidate_provided',
      handle: 'example',
      statistics: { problemsSolved: 0 },
    };
    const { client, candidateQuery, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      {
        data: {
          id: evidenceId,
          candidate_id: candidateId,
          source: 'leetcode',
          availability: 'available',
          raw_evidence: evidence,
          created_at: '2026-10-11T12:00:00.000Z',
        },
        error: null,
      },
    );
    const getClient = vi.fn(() => client);
    const repository = createCandidatePlatformRepository(getClient);

    const result = await repository.submit(auth, candidateId, input);

    expect(getClient).toHaveBeenCalledWith('verified-token');
    expect(client.from).toHaveBeenNthCalledWith(1, 'candidates');
    expect(candidateQuery.eq.mock.calls).toEqual([['id', candidateId], ['owner_id', ownerId]]);
    expect(client.from).toHaveBeenNthCalledWith(2, 'platform_evidence');
    expect(evidenceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      candidate_id: candidateId,
      owner_id: ownerId,
      source: 'leetcode',
      availability: 'available',
      raw_evidence: expect.objectContaining({ provenance: 'candidate_provided', statistics: { problemsSolved: 0 } }),
      normalized_evidence: expect.objectContaining({ platform: 'leetcode', statistics: { problemsSolved: 0 } }),
    }));
    expect(result).toMatchObject({ id: evidenceId, candidateId, statistics: { problemsSolved: 0 } });
  });

  it('does not insert evidence for an unknown or unauthorized candidate', async () => {
    const { client } = createClient({ data: null, error: null }, undefined);
    const repository = createCandidatePlatformRepository(() => client);
    await expect(repository.submit(auth, candidateId, input)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('sanitizes evidence persistence failures', async () => {
    const { client } = createClient(
      { data: { id: candidateId }, error: null },
      { data: null, error: { message: 'database password detail' } },
    );
    const repository = createCandidatePlatformRepository(() => client);
    await expect(repository.submit(auth, candidateId, input)).rejects.toMatchObject({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Unable to save platform data right now',
    });
  });

  it('verifies candidate ownership and persists the validated GitHub profile snapshot', async () => {
    const profile = {
      username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 8,
      followers: 10, following: 5, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
    };
    const { client, candidateQuery, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      { data: { id: evidenceId, candidate_id: candidateId, observed_at: '2026-10-11T12:00:00.000+00:00' }, error: null },
    );
    const getGitHubProfile = vi.fn(async () => profile);
    const repository = createCandidatePlatformRepository(() => client, getGitHubProfile);

    const result = await repository.syncGitHub(auth, candidateId, 'octocat');

    expect(candidateQuery.eq.mock.calls).toEqual([['id', candidateId], ['owner_id', ownerId]]);
    expect(getGitHubProfile).toHaveBeenCalledWith('octocat');
    expect(evidenceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      candidate_id: candidateId,
      owner_id: ownerId,
      source: 'github',
      availability: 'available',
      raw_evidence: { username: 'octocat', profileUrl: 'https://github.com/octocat' },
      normalized_evidence: profile,
    }));
    expect(evidenceQuery.eq.mock.calls).toEqual(expect.arrayContaining([
      ['candidate_id', candidateId], ['owner_id', ownerId], ['source', 'github'],
    ]));
    expect(result).toMatchObject({ id: evidenceId, candidateId, provenance: 'github_api', syncedAt: '2026-10-11T12:00:00.000+00:00', profile });
  });

  it('updates the latest owned GitHub snapshot on repeated syncs instead of inserting another row', async () => {
    const profile = {
      username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 0,
      followers: 0, following: 0, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
    };
    const existing = { data: { id: evidenceId }, error: null };
    const { client, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      { data: { id: evidenceId, candidate_id: candidateId, observed_at: '2026-10-11T12:00:00.000+00:00' }, error: null },
      existing,
    );
    evidenceQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce(existing);
    const repository = createCandidatePlatformRepository(() => client, async () => profile);

    await repository.syncGitHub(auth, candidateId, 'octocat');
    await repository.syncGitHub(auth, candidateId, 'octocat');

    expect(evidenceQuery.insert).toHaveBeenCalledTimes(1);
    expect(evidenceQuery.update).toHaveBeenCalledTimes(1);
    expect(evidenceQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      candidate_id: candidateId, owner_id: ownerId, source: 'github', normalized_evidence: profile,
    }));
    expect(evidenceQuery.eq).toHaveBeenCalledWith('id', evidenceId);
  });

  it('reloads a saved GitHub snapshot when PostgREST returns an offset timestamp', async () => {
    const profile = {
      username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 0,
      followers: 0, following: 0, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
    };
    const { client } = createClient(
      { data: { id: candidateId }, error: null },
      undefined,
      undefined,
      { data: [{
        id: evidenceId, candidate_id: candidateId, owner_id: ownerId, source: 'github', availability: 'available',
        raw_evidence: { username: 'octocat' }, normalized_evidence: profile, created_at: '2026-10-11T12:00:00.000+00:00',
        observed_at: '2026-10-11T12:00:00.000+00:00',
      }], error: null },
    );
    const repository = createCandidatePlatformRepository(() => client);
    await expect(repository.getLatest(auth, candidateId)).resolves.toMatchObject({ items: [{
      id: evidenceId, candidateId, source: 'github', syncedAt: '2026-10-11T12:00:00.000+00:00', profile,
    }] });
  });

  it('does not call GitHub or write evidence for a candidate outside the recruiter scope', async () => {
    const { client } = createClient({ data: null, error: null }, undefined);
    const getGitHubProfile = vi.fn();
    const repository = createCandidatePlatformRepository(() => client, getGitHubProfile);
    await expect(repository.syncGitHub(auth, candidateId, 'octocat')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(getGitHubProfile).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('reports GitHub persistence failures distinctly and logs sanitized database diagnostics', async () => {
    const { client } = createClient(
      { data: { id: candidateId }, error: null },
      { data: null, error: { code: '42501', message: 'permission denied; bearer super-secret-token', status: 403, hint: 'Check RLS policy' } },
    );
    const log = vi.fn();
    const repository = createCandidatePlatformRepository(() => client, async () => ({
      username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 0,
      followers: 0, following: 0, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
    }), log);
    await expect(repository.syncGitHub(auth, candidateId, 'octocat')).rejects.toMatchObject({
      statusCode: 403, code: 'GITHUB_DATABASE_PERMISSION_DENIED',
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      code: '42501', status: 403, hint: 'Check RLS policy',
      message: 'permission denied; bearer [redacted]',
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('super-secret-token');
  });

  it('returns a distinct save failure when the database write throws or returns no row', async () => {
    const { client, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      { data: null, error: null },
    );
    evidenceQuery.single.mockRejectedValueOnce(new Error('connection refused'));
    const repository = createCandidatePlatformRepository(() => client, async () => ({
      username: 'octocat', profileUrl: 'https://github.com/octocat', publicRepositoryCount: 0,
      followers: 0, following: 0, repositories: [], repositoriesReturned: 0, repositoriesTruncated: false,
    }), vi.fn());
    await expect(repository.syncGitHub(auth, candidateId, 'octocat')).rejects.toMatchObject({
      statusCode: 503, code: 'GITHUB_DATA_SAVE_FAILED',
    });
  });

  it('checks candidate ownership before provider calls and appends a validated LeetCode snapshot', async () => {
    const profile: NormalizedLeetCodeProfile = {
      platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example',
      profileUrl: 'https://leetcode.com/u/example/', statistics: { problemsSolved: 12, easySolved: 0 },
    };
    const { client, candidateQuery, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      { data: { id: evidenceId, candidate_id: candidateId, observed_at: '2026-10-15T12:00:00.000+00:00' }, error: null },
    );
    const getProfile = vi.fn(async () => profile);
    const repository = createCandidatePlatformRepository(() => client, undefined, undefined, getProfile);
    const result = await repository.syncLeetCode(auth, candidateId, 'example');
    expect(candidateQuery.eq.mock.calls).toEqual([['id', candidateId], ['owner_id', ownerId]]);
    expect(getProfile).toHaveBeenCalledWith('example');
    expect(evidenceQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      candidate_id: candidateId, owner_id: ownerId, source: 'leetcode', availability: 'available',
      raw_evidence: expect.objectContaining({ provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example' }),
      normalized_evidence: profile,
    }));
    expect(result).toMatchObject({ id: evidenceId, candidateId, provenance: 'alfa_leetcode_api', syncedAt: '2026-10-15T12:00:00.000+00:00', statistics: { problemsSolved: 12, easySolved: 0 } });
    expect(result).not.toHaveProperty('score');
  });

  it('does not fetch or persist for another owner and leaves previous evidence alone when the provider fails', async () => {
    const { client } = createClient({ data: null, error: null }, undefined);
    const getProfile = vi.fn();
    const repository = createCandidatePlatformRepository(() => client, undefined, undefined, getProfile);
    await expect(repository.syncLeetCode(auth, candidateId, 'example')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(getProfile).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);

    const { client: ownedClient, evidenceQuery } = createClient({ data: { id: candidateId }, error: null }, undefined);
    const failingRepository = createCandidatePlatformRepository(() => ownedClient, undefined, undefined, async () => { throw new Error('provider unavailable'); });
    await expect(failingRepository.syncLeetCode(auth, candidateId, 'example')).rejects.toThrow('provider unavailable');
    expect(evidenceQuery.insert).not.toHaveBeenCalled();
  });

  it('returns a controlled persistence failure after a successful fetch without updating existing evidence', async () => {
    const { client, evidenceQuery } = createClient(
      { data: { id: candidateId }, error: null },
      { data: null, error: { code: '42501', message: 'sensitive database detail' } },
    );
    const repository = createCandidatePlatformRepository(() => client, undefined, undefined, async () => ({
      platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example',
      profileUrl: 'https://leetcode.com/u/example/', statistics: { problemsSolved: 12 },
    }));
    await expect(repository.syncLeetCode(auth, candidateId, 'example')).rejects.toMatchObject({
      statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'Unable to save LeetCode profile data right now',
    });
    expect(evidenceQuery.insert).toHaveBeenCalledTimes(1);
    expect(evidenceQuery.update).not.toHaveBeenCalled();
  });

  it('logs a safe SQLSTATE diagnosis for a LeetCode evidence insert failure without exposing database text', async () => {
    const { client } = createClient(
      { data: { id: candidateId }, error: null },
      { data: null, error: { code: '42501', message: 'permission denied for candidate atharva@example.com token=private-value' } },
    );
    const log = vi.fn();
    const repository = createCandidatePlatformRepository(
      () => client,
      undefined,
      undefined,
      async () => ({
        platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'private-handle',
        profileUrl: 'https://leetcode.com/u/private-handle/', statistics: { problemsSolved: 12 },
      }),
      log,
    );

    await expect(repository.syncLeetCode(auth, candidateId, 'private-handle')).rejects.toMatchObject({
      statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'Unable to save LeetCode profile data right now',
    });
    expect(log).toHaveBeenCalledWith({
      operation: 'evidence_insert', code: '42501',
      message: 'Database permission or row-level security denied the operation.',
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|atharva|example\.com/);
  });

  it('identifies candidate lookup failures separately from evidence persistence failures', async () => {
    const { client } = createClient(
      { data: null, error: { code: '42P01', message: 'relation candidates does not exist' } },
      undefined,
    );
    const log = vi.fn();
    const getProfile = vi.fn();
    const repository = createCandidatePlatformRepository(() => client, undefined, undefined, getProfile, log);

    await expect(repository.syncLeetCode(auth, candidateId, 'example')).rejects.toMatchObject({
      statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'Unable to verify the candidate right now',
    });
    expect(log).toHaveBeenCalledWith({
      operation: 'candidate_lookup', code: '42P01', message: 'Database relation is missing or unavailable.',
    });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('returns LeetCode sync provenance and retrieval time from owner-scoped saved evidence', async () => {
    const normalized = {
      platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example',
      profileUrl: 'https://leetcode.com/u/example/', statistics: { problemsSolved: 15 },
    };
    const { client } = createClient(
      { data: { id: candidateId }, error: null }, undefined, undefined,
      { data: [{
        id: evidenceId, candidate_id: candidateId, owner_id: ownerId, source: 'leetcode', availability: 'available',
        raw_evidence: { provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example', profileUrl: normalized.profileUrl },
        normalized_evidence: normalized, created_at: '2026-10-15T12:00:00.000+00:00', observed_at: '2026-10-15T12:00:00.000+00:00',
      }], error: null },
    );
    const repository = createCandidatePlatformRepository(() => client);
    await expect(repository.getLatest(auth, candidateId)).resolves.toMatchObject({ items: [{
      id: evidenceId, candidateId, provenance: 'alfa_leetcode_api', syncedAt: '2026-10-15T12:00:00.000+00:00', statistics: { problemsSolved: 15 },
    }] });
  });

  it('retains candidate-reported LeetCode evidence alongside the most recent provider snapshot', async () => {
    const { client } = createClient(
      { data: { id: candidateId }, error: null }, undefined, undefined,
      { data: [
        {
          id: evidenceId, candidate_id: candidateId, owner_id: ownerId, source: 'leetcode', availability: 'available',
          raw_evidence: { provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example', profileUrl: 'https://leetcode.com/u/example/' },
          normalized_evidence: { platform: 'leetcode', provenance: 'alfa_leetcode_api', provider: 'alfa-leetcode-api', handle: 'example', profileUrl: 'https://leetcode.com/u/example/', statistics: { problemsSolved: 15 } },
          created_at: '2026-10-15T12:00:00.000Z', observed_at: '2026-10-15T12:00:00.000Z',
        },
        {
          id: 'fe574cd8-8d21-4586-a887-dc2a6fc7ba09', candidate_id: candidateId, owner_id: ownerId, source: 'leetcode', availability: 'available',
          raw_evidence: { provenance: 'candidate_provided', handle: 'example', statistics: { problemsSolved: 14 } },
          normalized_evidence: { platform: 'leetcode', provenance: 'candidate_provided', handle: 'example', statistics: { problemsSolved: 14 } },
          created_at: '2026-10-14T12:00:00.000Z', observed_at: null,
        },
      ], error: null },
    );
    const repository = createCandidatePlatformRepository(() => client);
    const result = await repository.getLatest(auth, candidateId);
    expect(result.items).toHaveLength(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ provenance: 'alfa_leetcode_api', statistics: { problemsSolved: 15 } }),
      expect.objectContaining({ provenance: 'candidate_provided', statistics: { problemsSolved: 14 } }),
    ]));
  });
});
