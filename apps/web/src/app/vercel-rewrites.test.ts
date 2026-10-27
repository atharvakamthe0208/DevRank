import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(new URL('../../../../vercel.json', import.meta.url), 'utf8')) as {
  rewrites?: Array<{ source: string; destination: string }>;
};

describe('Vercel SPA fallback', () => {
  it('serves client routes through the SPA entry while excluding API and file paths', () => {
    const fallback = config.rewrites?.find((rewrite) => rewrite.destination === '/index.html');
    expect(fallback).toBeDefined();
    const matcher = new RegExp(`^${fallback?.source}$`);

    for (const route of ['/auth/callback', '/reset-password', '/dashboard', '/evaluations']) {
      expect(matcher.test(route), `${route} should use the SPA entry`).toBe(true);
    }
    for (const path of ['/api/auth/me', '/api', '/assets/index-abc123.js', '/favicon.ico']) {
      expect(matcher.test(path), `${path} should not use the SPA fallback`).toBe(false);
    }
  });
});
