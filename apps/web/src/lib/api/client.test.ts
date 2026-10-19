import { afterEach, describe, expect, it, vi } from 'vitest';

const { refreshSession } = vi.hoisted(() => ({ refreshSession: vi.fn() }));
vi.mock('../supabase/client', () => ({ supabase: { auth: { refreshSession } } }));

import { apiRequest, ApiNetworkError, ApiRequestError } from './client';

describe('API access token forwarding', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forwards the current bearer token and retries once with a refreshed token after 401', async () => {
    refreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: 'user-1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/auth/me', undefined, 'expired-token')).resolves.toEqual({ user: { id: 'user-1' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer expired-token' });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
  });

  it('does not repeat a request when refresh cannot restore a session', async () => {
    refreshSession.mockResolvedValue({ data: { session: null }, error: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }), { status: 401 })));

    await expect(apiRequest('/auth/me', undefined, 'expired-token')).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('turns fetch failures into a safe connectivity error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/candidates')).rejects.toBeInstanceOf(ApiNetworkError);
    await expect(apiRequest('/candidates')).rejects.toThrow(/DevRank API/);
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
