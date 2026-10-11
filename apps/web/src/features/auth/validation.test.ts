import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, validateEmail, validatePassword, validateSignup } from './validation';

describe('recruiter auth validation', () => {
  it('rejects malformed email addresses', () => {
    expect(validateEmail('aryanexample.com')).toMatch(/valid email/i);
    expect(validateEmail('recruiter@example.com')).toBeUndefined();
  });
  it('enforces minimum password length', () => {
    expect(validatePassword('short')).toContain(String(MIN_PASSWORD_LENGTH));
    expect(validatePassword('a'.repeat(MIN_PASSWORD_LENGTH))).toBeUndefined();
  });
  it('requires name and matching confirmation for recruiter signup', () => {
    expect(validateSignup('', 'x@y.com', 'long-password-here', 'different')).toMatchObject({ fullName: 'Enter your full name.', confirm: 'Passwords do not match.' });
  });
});
