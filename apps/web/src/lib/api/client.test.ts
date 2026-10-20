import { afterEach, describe, expect, it, vi } from 'vitest';
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
