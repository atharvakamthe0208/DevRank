import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { candidatePlatformSubmissionSchema } from '@devrank/contracts';
import { createCandidatePlatformRepository } from '../src/repositories/candidate-platform-repository.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const evidenceId = 'ea574cd8-8d21-4586-a887-dc2a6fc7ba08';

function query(maybeSingleResult: unknown, singleResult: unknown) {
  const builder: Record<string, any> = {};
  for (const method of ['select', 'eq', 'is']) builder[method] = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => maybeSingleResult);
  builder.single = vi.fn(async () => singleResult);
  return builder;
}

function createClient(candidateResult: unknown, evidenceResult: unknown) {
  const candidateQuery = query(candidateResult, undefined);
  const evidenceQuery = query(undefined, evidenceResult);
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
      { data: { id: evidenceId, candidate_id: candidateId, created_at: '2026-10-11T12:00:00.000Z' }, error: null },
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
    expect(result).toMatchObject({ id: evidenceId, candidateId, provenance: 'github_api', profile });
  });

  it('does not call GitHub or write evidence for a candidate outside the recruiter scope', async () => {
    const { client } = createClient({ data: null, error: null }, undefined);
    const getGitHubProfile = vi.fn();
    const repository = createCandidatePlatformRepository(() => client, getGitHubProfile);
    await expect(repository.syncGitHub(auth, candidateId, 'octocat')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(getGitHubProfile).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
