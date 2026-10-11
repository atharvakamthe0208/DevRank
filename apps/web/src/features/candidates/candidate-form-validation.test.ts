import { describe, expect, it } from 'vitest';
import { validateCandidateForm, type CandidateFormValues } from './candidate-form-validation';

const blank: CandidateFormValues = {
  name: '', email: '', githubUsername: '', leetcodeUsername: '', hackerrankUsername: '',
};

describe('candidate form validation', () => {
  it('requires a candidate name', () => {
    const result = validateCandidateForm(blank);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.name).toBeTruthy();
  });

  it('accepts optional fields left blank and trims supported input', () => {
    const result = validateCandidateForm({ ...blank, name: '  Taylor Example  ', githubUsername: '  taylor-dev ' });
    expect(result).toMatchObject({ success: true, data: { name: 'Taylor Example', githubUsername: 'taylor-dev' } });
  });

  it('rejects malformed email and profile URLs where usernames are expected', () => {
    const result = validateCandidateForm({ ...blank, name: 'Taylor Example', email: 'not-an-email', githubUsername: 'https://github.com/taylor' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors).toMatchObject({ email: expect.any(String), githubUsername: expect.any(String) });
  });

  it('passes only the fields supported by the shared API contract', () => {
    const result = validateCandidateForm({ ...blank, name: 'Taylor Example', email: 'taylor@example.com' });
    expect(result).toMatchObject({ success: true, data: { name: 'Taylor Example', email: 'taylor@example.com' } });
    if (result.success) expect(Object.keys(result.data)).toEqual(['name', 'email']);
  });
});
