import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseConfigurationError } from '../src/config/supabase.js';
import { createAuthenticate, createSupabaseTokenVerifier } from '../src/middleware/authenticate.js';

afterEach(() => vi.restoreAllMocks());

describe('Supabase authentication failure diagnostics', () => {
  it('returns a safe temporary error and logs configuration stage without secrets', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const verifier = createSupabaseTokenVerifier(() => {
      throw new Error('SUPABASE_ANON_KEY=must-not-be-logged');
    });
    const middleware = createAuthenticate(verifier);
    const request = { get: vi.fn().mockReturnValue('Bearer diagnostic-test-token') } as unknown as Request;
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json } as unknown as Response;

    await middleware(request, response, vi.fn());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'AUTH_SERVICE_UNAVAILABLE' }),
    }));
    expect(diagnostic).toHaveBeenCalledWith('DevRank authentication verification unavailable', { stage: 'configuration' });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('diagnostic-test-token');
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('must-not-be-logged');
  });

  it('returns a specific, safe configuration error when the API public key is missing', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const verifier = createSupabaseTokenVerifier(() => { throw new SupabaseConfigurationError(); });
    const middleware = createAuthenticate(verifier);
    const request = { get: vi.fn().mockReturnValue('Bearer test-access-token') } as unknown as Request;
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnThis(), json } as unknown as Response;

    await middleware(request, response, vi.fn());

    expect(response.status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({
        code: 'AUTH_CONFIGURATION_MISSING',
        message: expect.stringContaining('SUPABASE_ANON_KEY'),
      }),
    }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('test-access-token');
  });

  it('suppresses repeated identical verification failure logs', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const middleware = createAuthenticate(async () => { throw new Error('temporary auth outage'); });
    const makeResponse = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as unknown as Response;

    await middleware({ get: () => 'Bearer token-a' } as unknown as Request, makeResponse(), vi.fn());
    await middleware({ get: () => 'Bearer token-b' } as unknown as Request, makeResponse(), vi.fn());

    expect(diagnostic).toHaveBeenCalledTimes(1);
  });
});

describe('Supabase access-token and profile verification', () => {
  function fakeClient(userResult: unknown, profileResult: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue(profileResult);
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue(userResult) },
      from: vi.fn().mockReturnValue({ select }),
    };
    return { client, maybeSingle };
  }

  it('validates the supplied access token with Supabase and returns its recruiter profile', async () => {
    const user = { id: 'user-1', email: 'recruiter@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
    const profile = { id: 'user-1', display_name: 'Recruiter', role: 'recruiter', approval_status: 'approved' };
    const { client } = fakeClient({ data: { user }, error: null }, { data: profile, error: null });
    const factory = vi.fn().mockReturnValue(client);

    const identity = await createSupabaseTokenVerifier(factory as never)('real-access-token');

    expect(factory).toHaveBeenCalledWith('real-access-token');
    expect(client.auth.getUser).toHaveBeenCalledWith('real-access-token');
    expect(identity).toEqual({ userId: 'user-1', email: user.email, emailConfirmed: true, profile });
  });

  it.each(['invalid', 'expired'])('rejects an %s token without a profile lookup', async () => {
    const { client, maybeSingle } = fakeClient({ data: { user: null }, error: { status: 401 } }, { data: null, error: null });
    const identity = await createSupabaseTokenVerifier((() => client) as never)('rejected-access-token');
    expect(identity).toBeNull();
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('returns a valid identity with no profile so authorization can deny access explicitly', async () => {
    const { client } = fakeClient(
      { data: { user: { id: 'user-without-profile', email_confirmed_at: '2026-10-01T00:00:00Z' } }, error: null },
      { data: null, error: null },
    );
    const identity = await createSupabaseTokenVerifier((() => client) as never)('valid-access-token');
    expect(identity).toMatchObject({ userId: 'user-without-profile', emailConfirmed: true, profile: null });
  });
});
