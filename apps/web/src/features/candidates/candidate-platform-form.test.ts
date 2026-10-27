import { describe, expect, it } from 'vitest';
import { normalizePlatformProfile, platformSyncCapabilities } from './candidate-platform-form.js';

describe('coding platform profile links', () => {
  it('trims and accepts a username', () => {
    expect(normalizePlatformProfile('leetcode', '  candidate_1  ')).toEqual({ success: true, handle: 'candidate_1' });
  });

  it.each([
    ['leetcode', 'https://leetcode.com/u/candidate/'],
    ['hackerrank', 'https://www.hackerrank.com/profile/candidate'],
  ] as const)('extracts only the supported %s public profile URL', (platform, url) => {
    expect(normalizePlatformProfile(platform, url)).toEqual({ success: true, handle: 'candidate' });
  });

  it('rejects lookalike hosts, insecure URLs, and unsupported paths', () => {
    expect(normalizePlatformProfile('leetcode', 'https://leetcode.com.evil.test/u/user').success).toBe(false);
    expect(normalizePlatformProfile('leetcode', 'http://leetcode.com/u/user').success).toBe(false);
    expect(normalizePlatformProfile('hackerrank', 'https://hackerrank.com/user').success).toBe(false);
  });

  it('marks the configured LeetCode provider as syncable while HackerRank remains unavailable', () => {
    expect(platformSyncCapabilities.leetcode.supported).toBe(true);
    expect(platformSyncCapabilities.hackerrank.supported).toBe(false);
    expect(platformSyncCapabilities.leetcode.explanation).toContain('alfa-leetcode-api');
    expect(platformSyncCapabilities.hackerrank.explanation).toContain('unavailable');
  });
});
