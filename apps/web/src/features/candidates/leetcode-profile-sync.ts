import { leetCodeSyncResponseSchema, type Candidate, type LeetCodeSyncResponse } from '@devrank/contracts';
import { normalizePlatformProfile } from './candidate-platform-form';
import { parseCandidateApiResponse } from './candidate-response-validation';

type ProfileRequest = (path: string, init: RequestInit, accessToken: string) => Promise<unknown>;
type FailureStage = 'validation' | 'save' | 'sync';

export class LeetCodeProfileSyncError extends Error {
  constructor(
    readonly stage: FailureStage,
    message: string,
    readonly savedCandidate?: Candidate,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'LeetCodeProfileSyncError';
  }
}

export async function saveAndSyncLeetCodeProfile(
  candidateId: string,
  input: string,
  accessToken: string,
  request: ProfileRequest,
): Promise<{ candidate: Candidate; handle: string; result: LeetCodeSyncResponse }> {
  const normalized = normalizePlatformProfile('leetcode', input);
  if (!normalized.success) throw new LeetCodeProfileSyncError('validation', normalized.message);

  let candidate: Candidate;
  try {
    const response = await request(`/candidates/${encodeURIComponent(candidateId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ leetcodeUsername: normalized.handle }),
    }, accessToken);
    const parsed = parseCandidateApiResponse(response);
    if (!parsed) throw new Error('The saved candidate response could not be verified.');
    candidate = parsed;
  } catch (error) {
    throw new LeetCodeProfileSyncError('save', 'Could not save the LeetCode profile.', undefined, error);
  }

  try {
    const response = await request(`/candidates/${encodeURIComponent(candidateId)}/platform-data/leetcode-sync`, {
      method: 'POST',
      body: JSON.stringify({ profile: normalized.handle }),
    }, accessToken);
    return { candidate, handle: normalized.handle, result: leetCodeSyncResponseSchema.parse(response) };
  } catch (error) {
    throw new LeetCodeProfileSyncError('sync', 'The profile was saved, but LeetCode could not be synchronized.', candidate, error);
  }
}
