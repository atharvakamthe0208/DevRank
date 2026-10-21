import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { HttpError } from '../middleware/http-error.js';

type SupabaseConfiguration = {
  url?: string;
  anonKey?: string;
};

export class SupabaseConfigurationError extends Error {
  constructor() {
    super('Supabase API authentication requires SUPABASE_URL and SUPABASE_ANON_KEY.');
    this.name = 'SupabaseConfigurationError';
  }
}

let anonymousClient: SupabaseClient | undefined;

function assertConfigured(config: SupabaseConfiguration): asserts config is { url: string; anonKey: string } {
  if (!config.url || !config.anonKey || config.url.includes('your-project') || config.anonKey === 'your-public-anon-key') {
    throw new SupabaseConfigurationError();
  }
}

function makeClient(url: string, anonKey: string, accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
  });
}

/** Returns a shared anonymous client or a request-scoped client carrying a verified user's JWT. */
export function getSupabaseClient(accessToken?: string): SupabaseClient {
  const config = { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };
  assertConfigured(config);

  if (accessToken) return makeClient(config.url, config.anonKey, accessToken);
  anonymousClient ??= makeClient(config.url, config.anonKey);
  return anonymousClient;
}

/** Server-only client for the screening worker. Never import this into the web workspace. */
export function getSupabaseServiceClient(): SupabaseClient {
  if (!env.SUPABASE_URL || env.SUPABASE_URL.includes('your-project') || !env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY.startsWith('your-')) {
    throw new HttpError(503, 'SCREENING_WORKER_NOT_CONFIGURED', 'Background resume processing requires SUPABASE_SERVICE_ROLE_KEY in apps/api/.env.');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function isSupabaseServiceConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && !env.SUPABASE_URL.includes('your-project') && env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SERVICE_ROLE_KEY.startsWith('your-'));
}

/** Exposed for configuration tests without creating a client or making a network request. */
export function assertSupabaseConfiguration(config: SupabaseConfiguration): void {
  assertConfigured(config);
}
