import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { screeningErrorMessage } from './screening-errors';

describe('screeningErrorMessage', () => {
  it('replaces raw schema diagnostics with a concise next step', () => {
    const error = z.string().safeParse(42).error!;
    const message = screeningErrorMessage(error, 'fallback');
    expect(message).toContain('unexpected format');
    expect(message).toContain('Try loading the results again');
    expect(message).not.toContain('invalid_type');
    expect(message).not.toContain('"path"');
  });

  it('preserves safe API messages and falls back for unknown failures', () => {
    expect(screeningErrorMessage(Object.assign(new Error('Temporary API failure.'), { name: 'ApiRequestError' }), 'fallback')).toBe('Temporary API failure.');
    expect(screeningErrorMessage(null, 'Could not load results.')).toBe('Could not load results.');
  });
});
