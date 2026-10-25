import { describe, expect, it } from 'vitest';
import { isValidScreeningSessionId } from './screening-restore';

const sessionId = '146ec40d-88c1-4575-8c08-e28601b26b4d';

describe('resume screening session id validation', () => {
  it('accepts only ids with the expected session id shape', () => {
    expect(isValidScreeningSessionId(sessionId)).toBe(true);
    expect(isValidScreeningSessionId('screening-session')).toBe(false);
    expect(isValidScreeningSessionId(null)).toBe(false);
  });
});
