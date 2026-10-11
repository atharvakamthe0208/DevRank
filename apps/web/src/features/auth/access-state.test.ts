import { describe, expect, it } from 'vitest';
import { classifyRecruiterAccess, type RecruiterProfile } from './access-state';

const recruiter = (approval_status: RecruiterProfile['approval_status']): RecruiterProfile => ({
  id: 'user-1',
  display_name: 'Recruiter',
  role: 'recruiter',
  approval_status,
});

describe('recruiter access classification', () => {
  it('distinguishes a missing profile from temporary verification failures', () => {
    expect(classifyRecruiterAccess(null, true)).toBe('profile-missing');
  });

  it('preserves email confirmation and recruiter approval gates', () => {
    expect(classifyRecruiterAccess(recruiter('approved'), false)).toBe('unconfirmed');
    expect(classifyRecruiterAccess(recruiter('pending'), true)).toBe('pending');
    expect(classifyRecruiterAccess(recruiter('rejected'), true)).toBe('rejected');
    expect(classifyRecruiterAccess(recruiter('suspended'), true)).toBe('pending');
    expect(classifyRecruiterAccess(recruiter('approved'), true)).toBe('approved');
  });

  it('recognizes only approved administrator profiles as admin', () => {
    expect(classifyRecruiterAccess({ ...recruiter('approved'), role: 'admin' }, true)).toBe('admin');
    expect(classifyRecruiterAccess({ ...recruiter('pending'), role: 'admin' }, true)).toBe('pending');
  });
});
