export type CandidateCodingPlatform = 'leetcode' | 'hackerrank';

export const platformSyncCapabilities = {
  leetcode: {
    supported: true,
    explanation: 'Public statistics are fetched through the configured alfa-leetcode-api provider. They are informational and do not verify candidate identity or affect evaluation scores.',
  },
  hackerrank: {
    supported: false,
    explanation: 'Automatic sync is unavailable for public usernames. HackerRank’s documented APIs require a HackerRank for Work account and authorized API access.',
  },
} as const;

export type NormalizedPlatformProfile =
  | { success: true; handle: string }
  | { success: false; message: string };

const usernamePattern = /^[A-Za-z0-9_.-]{1,100}$/;

export function normalizePlatformProfile(
  platform: CandidateCodingPlatform,
  input: string,
): NormalizedPlatformProfile {
  const value = input.trim();
  if (!value) return { success: false, message: 'Enter a username or public profile URL.' };

  let handle = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const expectedHost = platform === 'leetcode' ? 'leetcode.com' : 'hackerrank.com';
      const hostAllowed = url.hostname.toLowerCase() === expectedHost
        || url.hostname.toLowerCase() === `www.${expectedHost}`;
      const segments = url.pathname.split('/').filter(Boolean);
      const profileSegment = platform === 'leetcode' ? 'u' : 'profile';
      if (url.protocol !== 'https:' || !hostAllowed || url.search || url.hash
        || segments.length !== 2 || segments[0].toLowerCase() !== profileSegment) {
        return { success: false, message: `Enter a valid ${platform === 'leetcode' ? 'LeetCode' : 'HackerRank'} profile URL.` };
      }
      handle = segments[1];
    } catch {
      return { success: false, message: 'Enter a valid HTTPS profile URL.' };
    }
  }

  if (!usernamePattern.test(handle)) {
    return { success: false, message: 'Use a valid username or supported profile URL.' };
  }
  return { success: true, handle };
}
