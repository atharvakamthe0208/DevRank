import {
  candidatePlatformVerificationResponseSchema,
  type CandidatePlatformVerificationRequest,
} from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';

export type CandidatePlatform = CandidatePlatformVerificationRequest['platform'];
export type ProfileVerification =
  | { status: 'idle' }
  | { status: 'checking'; username: string }
  | { status: 'verified'; username: string }
  | { status: 'invalid'; username: string }
  | { status: 'not-found'; username: string }
  | { status: 'retryable-error'; username: string };

export function normalizeProfileUsername(value: string): string {
  return value.trim().replace(/^@/, '');
}

export function isProfileVerified(value: string, verification: ProfileVerification): boolean {
  return value.trim().length === 0 || (verification.status === 'verified'
    && verification.username === normalizeProfileUsername(value));
}

export async function verifyCandidateProfile(platform: CandidatePlatform, username: string, accessToken: string): Promise<void> {
  const normalizedUsername = normalizeProfileUsername(username);
  const response = await apiRequest<unknown>('/candidates/verify-platform', {
    method: 'POST',
    body: JSON.stringify({ platform, username: normalizedUsername }),
  }, accessToken);
  const parsed = candidatePlatformVerificationResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.platform !== platform || parsed.data.username !== normalizedUsername) {
    throw new Error('The profile verification response could not be validated. Please try again.');
  }
}
