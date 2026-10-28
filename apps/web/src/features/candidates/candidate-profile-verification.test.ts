import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }));
import { apiRequest } from '../../lib/api/client';
import { isProfileVerified, normalizeProfileUsername, verifyCandidateProfile, type ProfileVerification } from './candidate-profile-verification';

describe('candidate profile verification', () => {
  afterEach(() => vi.resetAllMocks());

  it('normalizes surrounding whitespace and a leading @ consistently', () => {
    expect(normalizeProfileUsername('  @octocat  ')).toBe('octocat');
  });

  it('requires the current username to match a successful verification and allows omitted profiles', () => {
    const verified: ProfileVerification = { status: 'verified', username: 'octocat' };
    expect(isProfileVerified('@octocat', verified)).toBe(true);
    expect(isProfileVerified('other', verified)).toBe(false);
    expect(isProfileVerified('', { status: 'idle' })).toBe(true);
    expect(isProfileVerified('octocat', { status: 'retryable-error', username: 'octocat' })).toBe(false);
  });

  it('calls the authenticated platform verification endpoint with the normalized username', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ platform: 'github', username: 'octocat', verified: true });
    await expect(verifyCandidateProfile('github', ' @octocat ', 'test-access-token')).resolves.toBeUndefined();
    expect(apiRequest).toHaveBeenCalledWith('/candidates/verify-platform', {
      method: 'POST', body: JSON.stringify({ platform: 'github', username: 'octocat' }),
    }, 'test-access-token');
  });

  it('rejects a malformed or mismatched verification response', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ platform: 'leetcode', username: 'someone-else', verified: true });
    await expect(verifyCandidateProfile('leetcode', 'example', 'token')).rejects.toThrow('response could not be validated');
  });
});
