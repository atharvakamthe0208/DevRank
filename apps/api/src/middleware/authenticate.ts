import type { RequestHandler } from 'express';
import { apiErrorSchema } from '@devrank/contracts';
import { getSupabaseClient, SupabaseConfigurationError } from '../config/supabase.js';
import type { AuthContext } from '../types/auth.js';

export type VerifiedIdentity = Omit<AuthContext, 'accessToken'>;
export type TokenVerifier = (token: string) => Promise<VerifiedIdentity | null>;

type VerificationStage = 'configuration' | 'token_verification' | 'profile_lookup' | 'custom_verifier';
type SupabaseClientFactory = typeof getSupabaseClient;

class VerificationUnavailableError extends Error {
  constructor(readonly stage: VerificationStage, readonly status?: number, readonly configurationMissing = false) {
    super('Authentication verification is unavailable');
    this.name = 'VerificationUnavailableError';
  }
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = error.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

const profileDetailsColumns = ['phone_number', 'company_name', 'job_title', 'company_website', 'location_city', 'location_country'] as const;

/** These PostgREST/Postgres codes mean the additive recruiter-details migration is absent or stale. */
export function isMissingRecruiterProfileDetailsSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = error.code;
  return code === '42703' || code === 'PGRST204';
}

export function createSupabaseTokenVerifier(clientFactory: SupabaseClientFactory = getSupabaseClient): TokenVerifier {
  return async (token) => {
    let client: ReturnType<SupabaseClientFactory>;
    try {
      client = clientFactory(token);
    } catch (cause) {
      if (cause instanceof SupabaseConfigurationError) {
        throw new VerificationUnavailableError('configuration', undefined, true);
      }
      throw new VerificationUnavailableError('configuration');
    }

    let user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error) {
        const status = providerStatus(error);
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) return null;
        throw new VerificationUnavailableError('token_verification', status);
      }
      user = data.user;
    } catch (cause) {
      if (cause instanceof VerificationUnavailableError) throw cause;
      throw new VerificationUnavailableError('token_verification');
    }
    if (!user) return null;

    let profile: VerifiedIdentity['profile'];
    try {
      const result = await client
        .from('profiles')
        .select('id, display_name, phone_number, company_name, job_title, company_website, location_city, location_country, role, approval_status')
        .eq('id', user.id)
        .maybeSingle();
      if (result.error && isMissingRecruiterProfileDetailsSchema(result.error)) {
        // Keep login/access verification independent from the optional profile-details migration.
        // Do not mask unrelated permission, connectivity, or database failures.
        const base = await client.from('profiles')
          .select('id, display_name, role, approval_status')
          .eq('id', user.id)
          .maybeSingle();
        if (base.error) throw new VerificationUnavailableError('profile_lookup', providerStatus(base.error));
        profile = base.data ? {
          ...base.data,
          ...Object.fromEntries(profileDetailsColumns.map((column) => [column, null])),
        } as VerifiedIdentity['profile'] : null;
      } else if (result.error) {
        throw new VerificationUnavailableError('profile_lookup', providerStatus(result.error));
      } else {
        profile = result.data as VerifiedIdentity['profile'];
      }
    } catch (cause) {
      if (cause instanceof VerificationUnavailableError) throw cause;
      throw new VerificationUnavailableError('profile_lookup');
    }
    return {
      userId: user.id,
      email: user.email ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
      profile,
    };
  };
}

export function createAuthenticate(verifyToken: TokenVerifier = createSupabaseTokenVerifier()): RequestHandler {
  let lastUnavailableLogKey: string | undefined;
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
      lastUnavailableLogKey = undefined;
      next();
    } catch (cause) {
      // Avoid exposing Supabase errors or credentials; distinguish outages from rejected tokens.
      const failure = cause instanceof VerificationUnavailableError
        ? cause
        : new VerificationUnavailableError('custom_verifier');
      const logDetails = {
        stage: failure.stage,
        ...(failure.status ? { status: failure.status } : {}),
      };
      const logKey = `${failure.stage}:${failure.status ?? ''}:${failure.configurationMissing}`;
      if (lastUnavailableLogKey !== logKey) {
        console.error('DevRank authentication verification unavailable', logDetails);
        lastUnavailableLogKey = logKey;
      }
      response.status(503).json(apiErrorSchema.parse({
        error: failure.configurationMissing
          ? {
              code: 'AUTH_CONFIGURATION_MISSING',
              message: 'Supabase API authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in apps/api/.env, then restart the API.',
            }
          : { code: 'AUTH_SERVICE_UNAVAILABLE', message: 'Authentication service is temporarily unavailable' },
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
