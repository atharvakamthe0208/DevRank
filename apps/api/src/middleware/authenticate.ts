import type { RequestHandler } from 'express';
import { apiErrorSchema } from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';

export type VerifiedIdentity = { userId: string };
export type TokenVerifier = (token: string) => Promise<VerifiedIdentity | null>;

async function verifySupabaseToken(token: string): Promise<VerifiedIdentity | null> {
  const { data, error } = await getSupabaseClient().auth.getUser(token);
  if (error) {
    const status = 'status' in error ? error.status : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return null;
    throw new Error('Supabase Auth verification is unavailable');
  }
  return data.user ? { userId: data.user.id } : null;
}

export function createAuthenticate(verifyToken: TokenVerifier = verifySupabaseToken): RequestHandler {
  return async (request, response, next) => {
    const authorization = request.get('authorization');
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) {
      response.status(401).json(apiErrorSchema.parse({ error: { code: 'UNAUTHENTICATED', message: 'A valid Bearer token is required' } }));
      return;
    }

    const accessToken = match[1];
    try {
      const identity = await verifyToken(accessToken);
      if (!identity) {
        response.status(401).json(apiErrorSchema.parse({ error: { code: 'UNAUTHENTICATED', message: 'The access token is invalid or expired' } }));
        return;
      }

      request.auth = { ...identity, accessToken };
      next();
    } catch {
      // Avoid exposing Supabase errors or credentials; distinguish outages from rejected tokens.
      response.status(503).json(apiErrorSchema.parse({
        error: { code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service is temporarily unavailable' },
      }));
    }
  };
}

export const authenticate = createAuthenticate();
