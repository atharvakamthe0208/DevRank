import type { CandidateCreateInput } from '@devrank/contracts';
import { githubAdapter } from './github-adapter.js';
import { leetCodeAdapter } from './leetcode-adapter.js';

export type CandidatePlatform = 'github' | 'leetcode';
export type CandidatePlatformVerifier = (platform: CandidatePlatform, username: string) => Promise<void>;

export const verifyCandidatePlatform: CandidatePlatformVerifier = async (platform, username) => {
  if (platform === 'github') await githubAdapter.verifyUsername(username);
  else await leetCodeAdapter.verifyUsername(username);
};

/** Candidate creation is gated on server-side checks; client verification state is never authoritative. */
export async function verifyCandidateProfiles(input: CandidateCreateInput, verify: CandidatePlatformVerifier = verifyCandidatePlatform): Promise<void> {
  const checks: Array<Promise<void>> = [];
  if (input.githubUsername) checks.push(verify('github', input.githubUsername));
  if (input.leetcodeUsername) checks.push(verify('leetcode', input.leetcodeUsername));
  await Promise.all(checks);
}
