import type { RequestHandler } from 'express';
import { apiErrorSchema } from '@devrank/contracts';
import { getSupabaseClient } from '../config/supabase.js';
import type { AuthContext } from '../types/auth.js';

export type VerifiedIdentity = Omit<AuthContext, 'accessToken'>;
export type TokenVerifier = (token: string) => Promise<VerifiedIdentity | null>;

async function verifySupabaseToken(token: string): Promise<VerifiedIdentity | null> {
  const client = getSupabaseClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error) {
    const status = 'status' in error ? error.status : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return null;
    throw new Error('Supabase Auth verification is unavailable');
  }
  if (!data.user) return null;
  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('id, display_name, role, approval_status')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) throw new Error('Recruiter profile lookup is unavailable');
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    emailConfirmed: Boolean(data.user.email_confirmed_at),
    profile: profile as VerifiedIdentity['profile'],
  };
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

export const requireApprovedRecruiter: RequestHandler = (request, response, next) => {
  const auth = request.auth;
  if (!auth) {
    response.status(401).json(apiErrorSchema.parse({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } }));
    return;
  }
  if (!auth.emailConfirmed) {
    response.status(403).json(apiErrorSchema.parse({ error: { code: 'EMAIL_NOT_CONFIRMED', message: 'Confirm your email address before continuing' } }));
    return;
  }
  if (!auth.profile) {
    response.status(403).json(apiErrorSchema.parse({ error: { code: 'PROFILE_MISSING', message: 'Your recruiter profile could not be found. Contact the project administrator.' } }));
    return;
  }
  if (auth.profile.approval_status === 'rejected') {
    response.status(403).json(apiErrorSchema.parse({ error: { code: 'APPLICATION_REJECTED', message: 'Your recruiter application was not approved' } }));
    return;
  }
  if (auth.profile.role !== 'recruiter' || auth.profile.approval_status !== 'approved') {
    response.status(403).json(apiErrorSchema.parse({ error: { code: 'RECRUITER_APPROVAL_REQUIRED', message: 'Recruiter access is awaiting administrator approval' } }));
    return;
  }
  next();
};

export const requireAdmin: RequestHandler = (request, response, next) => {
  const auth = request.auth;
  if (!auth) {
    response.status(401).json(apiErrorSchema.parse({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required' } }));
    return;
  }
  if (!auth.emailConfirmed || auth.profile?.role !== 'admin' || auth.profile.approval_status !== 'approved') {
    response.status(403).json(apiErrorSchema.parse({ error: { code: 'ADMIN_REQUIRED', message: 'Administrator access is required' } }));
    return;
  }
  next();
};
