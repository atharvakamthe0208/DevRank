import { describe, expect, it } from 'vitest';
import { validateCandidateForm } from './candidateForm';

describe('validateCandidateForm', () => {
  it('requires a candidate name and role', () => {
    expect(validateCandidateForm({ name: '  ', role: '', email: '' })).toEqual({
      name: 'Enter the candidate’s name.',
      role: 'Enter a role or position.',
    });
  });

  it('allows an omitted email and trims required fields', () => {
    expect(validateCandidateForm({ name: ' Maya Chen ', role: ' Engineer ', email: '' })).toEqual({});
  });

  it('rejects a malformed optional email', () => {
    expect(validateCandidateForm({ name: 'Maya Chen', role: 'Engineer', email: 'maya@' })).toEqual({
      email: 'Enter a valid email address.',
    });
  });
});
