import { describe, expect, it } from 'vitest';
import { createSubmissionLock } from './candidate-submission-lock';

describe('candidate submission lock', () => {
  it('allows only one in-flight submission and unlocks after completion', () => {
    const lock = createSubmissionLock();
    expect(lock.acquire()).toBe(true);
    expect(lock.acquire()).toBe(false);
    lock.release();
    expect(lock.acquire()).toBe(true);
  });
});
