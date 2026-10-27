import { describe, expect, it } from 'vitest';
import { mergeEnvironment, parseEnv } from '../src/config/env.js';
import { assertSupabaseConfiguration } from '../src/config/supabase.js';
import { isCorsOriginAllowed } from '../src/config/cors-policy.js';

describe('API environment configuration', () => {
  it('supplies safe local defaults', () => {
    expect(parseEnv({})).toMatchObject({
      API_PORT: 3000,
      API_HOST: '0.0.0.0',
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173',
      LEETCODE_API_BASE_URL: 'https://alfa-leetcode-api.onrender.com',
      GROQ_MODEL: 'openai/gpt-oss-120b',
      AI_TIMEOUT_MS: 12000,
    });
  });

  it('keeps Groq configuration optional and validates its bounds', () => {
    expect(parseEnv({ GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model', AI_TIMEOUT_MS: '5000' })).toMatchObject({
      GROQ_API_KEY: 'test-key', GROQ_MODEL: 'test-model', AI_TIMEOUT_MS: 5000,
    });
    expect(() => parseEnv({ AI_TIMEOUT_MS: '999' })).toThrow('Invalid API environment configuration');
  });

  it('accepts a separate optional server-only GitHub contribution token', () => {
    expect(parseEnv({ GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN: 'public-scope-token' }).GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN).toBe('public-scope-token');
  });

  it('rejects invalid ports without echoing environment values', () => {
    expect(() => parseEnv({ API_PORT: 'not-a-port' })).toThrow('Invalid API environment configuration');
  });

  it('does not let a blank inherited key mask the API workspace env value', () => {
    const source = mergeEnvironment(
      { SUPABASE_ANON_KEY: 'local-publishable-key' },
      { SUPABASE_ANON_KEY: '' },
    );
    expect(parseEnv(source).SUPABASE_ANON_KEY).toBe('local-publishable-key');
  });

  it('requires both Supabase URL and anonymous key when database access is requested', () => {
    expect(() => assertSupabaseConfiguration({})).toThrow(
      'Supabase API authentication requires SUPABASE_URL and SUPABASE_ANON_KEY.',
    );
    expect(() => assertSupabaseConfiguration({
      url: 'https://your-project.supabase.co',
      anonKey: 'your-public-anon-key',
    })).toThrow('Supabase API authentication requires SUPABASE_URL and SUPABASE_ANON_KEY.');
  });
});

describe('CORS origin policy', () => {
  const configured = 'http://localhost:5177';
  it.each(['http://localhost:5177', 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://[::1]:5174'])('allows local development origin %s', (origin) => {
    expect(isCorsOriginAllowed(origin, 'development', configured)).toBe(true);
  });
  it('allows the configured origin in production but rejects other local ports', () => {
    expect(isCorsOriginAllowed(configured, 'production', configured)).toBe(true);
    expect(isCorsOriginAllowed('http://localhost:5174', 'production', configured)).toBe(false);
  });
  it('allows the exact production Vercel app origin and rejects other hosted origins', () => {
    expect(isCorsOriginAllowed('https://dev-rank-ruddy.vercel.app', 'production', configured)).toBe(true);
    expect(isCorsOriginAllowed('https://dev-rank-ruddy.vercel.app.attacker.example', 'production', configured)).toBe(false);
    expect(isCorsOriginAllowed('https://another-app.vercel.app', 'production', configured)).toBe(false);
  });
  it.each(['https://attacker.example', 'http://localhost.attacker.example:5174', 'http://localhost:5174.evil.test', 'http://localhost:5174/path', 'https://localhost:5174'])('rejects unsafe origin %s', (origin) => {
    expect(isCorsOriginAllowed(origin, 'development', configured)).toBe(false);
  });
  it('supports requests without an Origin header', () => {
    expect(isCorsOriginAllowed(undefined, 'production', configured)).toBe(true);
  });
  it('allows explicit LAN frontend origins while keeping other origins blocked', () => {
    const lan = 'http://192.168.148.1:5173';
    expect(isCorsOriginAllowed(lan, 'development', configured, [lan])).toBe(true);
    expect(isCorsOriginAllowed(lan, 'production', configured, [lan])).toBe(true);
    expect(isCorsOriginAllowed('http://192.168.148.2:5173', 'development', configured, [lan])).toBe(false);
  });
});
