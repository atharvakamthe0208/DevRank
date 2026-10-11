import { describe, expect, it } from 'vitest';
import { validatePlatformForm } from './candidate-platform-form.js';

describe('candidate platform form validation', () => {
  it('requires a handle and at least one statistic for available LeetCode evidence', () => {
    expect(validatePlatformForm('leetcode', {
      handle: '', availability: 'available', statistics: {},
    })).toMatchObject({ success: false, errors: { handle: expect.any(String), statistics: expect.any(String) } });
  });

  it('accepts partial HackerRank statistics and preserves zero', () => {
    expect(validatePlatformForm('hackerrank', {
      handle: '  candidate  ', availability: 'available', statistics: { points: '0', badges: '', certificates: '2' },
    })).toEqual({
      success: true,
      data: { platform: 'hackerrank', handle: 'candidate', availability: 'available', statistics: { points: 0, certificates: 2 } },
    });
  });

  it.each(['-1', '1.5', 'NaN'])('rejects invalid LeetCode counts such as %s', (problemsSolved) => {
    expect(validatePlatformForm('leetcode', {
      handle: 'candidate', availability: 'available', statistics: { problemsSolved },
    })).toMatchObject({ success: false, errors: { 'statistics.problemsSolved': expect.any(String) } });
  });

  it('omits statistics when the source is unavailable or not provided', () => {
    expect(validatePlatformForm('leetcode', {
      handle: 'candidate', availability: 'not_provided', statistics: { problemsSolved: '10' },
    })).toEqual({ success: true, data: { platform: 'leetcode', handle: 'candidate', availability: 'not_provided' } });
  });
});
