import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireAdmin, requireApprovedRecruiter } from '../src/middleware/authenticate.js';
import type { AuthContext } from '../src/types/auth.js';

type ApprovalStatus = NonNullable<AuthContext['profile']>['approval_status'];

function requestFor(role: 'recruiter' | 'admin', approval_status: ApprovalStatus, emailConfirmed = true) {
  const auth: AuthContext = {
    userId: 'user-1', email: 'user@example.com', emailConfirmed, accessToken: 'test-token',
    profile: { id: 'user-1', display_name: 'Test User', role, approval_status },
  };
  return { auth } as unknown as Request;
}

function responseForTest() {
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

describe('server-side role authorization', () => {
  it('allows an approved recruiter and blocks pending, rejected, and unconfirmed accounts', () => {
    const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
    requireApprovedRecruiter(requestFor('recruiter', 'approved'), {} as Response, next);
    expect(next).toHaveBeenCalledWith();

    for (const [status, expectedCode] of [['pending', 'RECRUITER_APPROVAL_REQUIRED'], ['rejected', 'APPLICATION_REJECTED']] as const) {
      const response = responseForTest();
      requireApprovedRecruiter(requestFor('recruiter', status), response as unknown as Response, vi.fn());
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: expectedCode, message: expect.any(String) } }));
    }
    const unconfirmed = responseForTest();
    requireApprovedRecruiter(requestFor('recruiter', 'approved', false), unconfirmed as unknown as Response, vi.fn());
    expect(unconfirmed.status).toHaveBeenCalledWith(403);
    expect(unconfirmed.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'EMAIL_NOT_CONFIRMED', message: expect.any(String) } }));
  });

  it('denies a valid account without a recruiter profile and denies approved admins as recruiters', () => {
    const missingProfileResponse = responseForTest();
    const missingProfileRequest = {
      auth: { userId: 'user-1', email: 'user@example.com', emailConfirmed: true, accessToken: 'test-token', profile: null },
    } as unknown as Request;
    requireApprovedRecruiter(missingProfileRequest, missingProfileResponse as unknown as Response, vi.fn());
    expect(missingProfileResponse.status).toHaveBeenCalledWith(403);
    expect(missingProfileResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PROFILE_MISSING' }),
    }));

    const adminResponse = responseForTest();
    requireApprovedRecruiter(requestFor('admin', 'approved'), adminResponse as unknown as Response, vi.fn());
    expect(adminResponse.status).toHaveBeenCalledWith(403);
    expect(adminResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'RECRUITER_APPROVAL_REQUIRED' }),
    }));
  });

  it('allows only a confirmed, approved administrator to use admin APIs', () => {
    const next = vi.fn();
    requireAdmin(requestFor('admin', 'approved'), {} as Response, next);
    expect(next).toHaveBeenCalledWith();

    const recruiter = responseForTest();
    requireAdmin(requestFor('recruiter', 'approved'), recruiter as unknown as Response, vi.fn());
    expect(recruiter.status).toHaveBeenCalledWith(403);
    expect(recruiter.json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'ADMIN_REQUIRED', message: expect.any(String) } }));
  });
});
