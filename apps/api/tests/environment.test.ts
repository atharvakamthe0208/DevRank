import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { assertSupabaseConfiguration } from '../src/config/supabase.js';

describe('API environment configuration', () => {
  it('supplies safe local defaults', () => {
    expect(parseEnv({})).toMatchObject({
      API_PORT: 3000,
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173',
    });
  });

  it('rejects invalid ports without echoing environment values', () => {
    expect(() => parseEnv({ API_PORT: 'not-a-port' })).toThrow('Invalid API environment configuration');
  });

  it('requires both Supabase URL and anonymous key when database access is requested', () => {
    expect(() => assertSupabaseConfiguration({})).toThrow(
      'Set SUPABASE_URL and SUPABASE_ANON_KEY before using database services.',
    );
    expect(() => assertSupabaseConfiguration({
      url: 'https://your-project.supabase.co',
      anonKey: 'your-public-anon-key',
    })).toThrow('Set SUPABASE_URL and SUPABASE_ANON_KEY before using database services.');
  });
});
