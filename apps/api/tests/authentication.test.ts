import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
});
