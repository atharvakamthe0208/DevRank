import { describe, expect, it } from 'vitest';
import { isValidScreeningSessionId, shouldShowScreeningRestoreSkeleton } from './screening-restore';

const sessionId = '146ec40d-88c1-4575-8c08-e28601b26b4d';

describe('resume screening restore skeleton decision', () => {
  it('shows the skeleton only for an authenticated, uncached saved session', () => {
    expect(shouldShowScreeningRestoreSkeleton('access-token', sessionId)).toBe(true);
    expect(shouldShowScreeningRestoreSkeleton(undefined, sessionId)).toBe(false);
    expect(shouldShowScreeningRestoreSkeleton('access-token', null)).toBe(false);
    expect(shouldShowScreeningRestoreSkeleton('access-token', 'invalid-id')).toBe(false);
  });

  it('renders cached results immediately without a skeleton delay', () => {
    expect(shouldShowScreeningRestoreSkeleton('access-token', sessionId, sessionId)).toBe(false);
  });

  it('accepts a stored session id only when it has the expected id shape', () => {
    expect(isValidScreeningSessionId(sessionId)).toBe(true);
    expect(isValidScreeningSessionId('screening-session')).toBe(false);
    expect(isValidScreeningSessionId(null)).toBe(false);
  });
});
