import { describe, expect, it } from 'vitest';
import { candidateCreateSchema, candidatePlatformVerificationRequestSchema } from './candidate-api.js';

describe('candidate create and profile verification contracts', () => {
  it('normalizes optional usernames without changing empty-username behavior', () => {
    expect(candidateCreateSchema.parse({ name: 'Candidate', githubUsername: ' @octocat ', leetcodeUsername: ' @example ' }))
      .toMatchObject({ githubUsername: 'octocat', leetcodeUsername: 'example' });
    expect(candidateCreateSchema.parse({ name: 'Candidate' })).toEqual({ name: 'Candidate' });
  });

  it('strictly validates a single platform verification request', () => {
    expect(candidatePlatformVerificationRequestSchema.parse({ platform: 'github', username: ' @octocat ' }))
      .toEqual({ platform: 'github', username: 'octocat' });
    expect(candidatePlatformVerificationRequestSchema.safeParse({ platform: 'hacker', username: 'octocat' }).success).toBe(false);
    expect(candidatePlatformVerificationRequestSchema.safeParse({ platform: 'github', username: 'not a username' }).success).toBe(false);
    expect(candidatePlatformVerificationRequestSchema.safeParse({ platform: 'github', username: 'octocat', verified: true }).success).toBe(false);
  });
});
