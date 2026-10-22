import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyRecruiterAccess } from '../../features/auth/access-state';
import { ApiNetworkError, ApiRequestError, apiRequest } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('preserves API error status, code, and details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'VALIDATION_ERROR', message: 'Request body is invalid', details: [{ field: 'email' }] },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })));

    await expect(apiRequest('/candidates')).rejects.toMatchObject({
      name: 'ApiRequestError',
      message: 'Request body is invalid',
      status: 400,
      code: 'VALIDATION_ERROR',
      details: [{ field: 'email' }],
    });
  });

  it('uses a safe fallback for unrecognized error responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 502 })));

    await expect(apiRequest('/health')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(apiRequest('/health')).rejects.toMatchObject({
      message: 'API request failed (502)',
      status: 502,
      code: undefined,
      details: undefined,
    });
  });

  it('wraps fetch failures in the exported ApiNetworkError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection refused')));

    await expect(apiRequest('/health')).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it('forwards the provided Supabase access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ ok: boolean }>('/auth/me', undefined, 'test-access-token')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: { Authorization: 'Bearer test-access-token' },
    });
  });

  it('parses the confirmed admin profile from /auth/me so the admin route guard receives admin state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'admin-1', email: 'admin@example.com' },
      profile: { id: 'admin-1', display_name: 'Admin', phone_number: null, company_name: null, job_title: null, company_website: null, location_city: null, location_country: null, role: 'admin', approval_status: 'approved' },
      emailConfirmed: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const identity = await apiRequest<{ user: { id: string }; profile: { id: string; display_name: string | null; phone_number: string | null; company_name: string | null; job_title: string | null; company_website: string | null; location_city: string | null; location_country: string | null; role: 'recruiter' | 'admin'; approval_status: 'pending' | 'approved' | 'rejected' | 'suspended' } | null; emailConfirmed: boolean }>(
      '/auth/me', undefined, 'test-access-token',
    );

    expect(identity.profile).toMatchObject({ id: 'admin-1', role: 'admin', approval_status: 'approved' });
    expect(classifyRecruiterAccess(identity.profile, identity.emailConfirmed)).toBe('admin');
  });

  it('accepts a successful no-content response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(apiRequest<void>('/candidates/candidate-id', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('leaves multipart content type to the browser and forwards recruiter auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const formData = new FormData();
    formData.set('jobTitle', 'Engineer');

    await apiRequest('/screenings', { method: 'POST', body: formData }, 'recruiter-token');
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(request.headers);
    expect(headers.get('Content-Type')).toBeNull();
    expect(headers.get('Authorization')).toBe('Bearer recruiter-token');
  });
});
