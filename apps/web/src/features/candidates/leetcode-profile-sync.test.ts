import { describe, expect, it, vi } from 'vitest';
import { LeetCodeProfileSyncError, saveAndSyncLeetCodeProfile } from './leetcode-profile-sync';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const savedCandidate = {
  id: candidateId,
  name: 'Test Candidate',
  email: 'candidate@example.com',
  leetcodeUsername: 'example',
  createdAt: '2026-10-14T00:00:00.000Z',
  updatedAt: '2026-10-14T00:00:00.000Z',
};
const syncResult = {
  id: 'ea574cd8-a6cf-407b-b8b6-66e4e540f14c',
  candidateId,
  platform: 'leetcode',
  availability: 'available',
  provenance: 'alfa_leetcode_api',
  provider: 'alfa-leetcode-api',
  handle: 'example',
  profileUrl: 'https://leetcode.com/u/example/',
  statistics: { problemsSolved: 12 },
  syncedAt: '2026-10-15T12:00:00.000Z',
};

describe('save and sync LeetCode profile workflow', () => {
  it('validates the profile before requests and persists it before syncing', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(savedCandidate)
      .mockResolvedValueOnce(syncResult);

    const outcome = await saveAndSyncLeetCodeProfile(candidateId, 'https://leetcode.com/u/example/', 'test-token', request);

    expect(request).toHaveBeenNthCalledWith(1, `/candidates/${candidateId}`, {
      method: 'PATCH', body: JSON.stringify({ leetcodeUsername: 'example' }),
    }, 'test-token');
    expect(request).toHaveBeenNthCalledWith(2, `/candidates/${candidateId}/platform-data/leetcode-sync`, {
      method: 'POST', body: JSON.stringify({ profile: 'example' }),
    }, 'test-token');
    expect(outcome).toMatchObject({ candidate: savedCandidate, handle: 'example', result: syncResult });
  });

  it('rejects invalid input without saving or starting a sync', async () => {
    const request = vi.fn();

    await expect(saveAndSyncLeetCodeProfile(candidateId, 'https://example.com/user', 'test-token', request))
      .rejects.toMatchObject({ stage: 'validation' });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not call the provider if the profile cannot be saved', async () => {
    const request = vi.fn().mockRejectedValue(new Error('save failed'));

    await expect(saveAndSyncLeetCodeProfile(candidateId, 'example', 'test-token', request))
      .rejects.toMatchObject({ stage: 'save' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retains the successfully saved candidate if the provider sync fails', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(savedCandidate)
      .mockRejectedValueOnce(new Error('provider unavailable'));

    let failure: unknown;
    try {
      await saveAndSyncLeetCodeProfile(candidateId, 'example', 'test-token', request);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LeetCodeProfileSyncError);
    expect(failure).toMatchObject({ stage: 'sync', savedCandidate });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
