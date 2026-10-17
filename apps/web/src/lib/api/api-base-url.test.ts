import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './api-base-url';

describe('API base URL configuration', () => {
  it('uses an explicitly configured API URL and removes trailing slashes', () => {
    expect(resolveApiBaseUrl('https://api.example.test/api/', true)).toBe('https://api.example.test/api');
  });

  it('keeps localhost as the development default', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('http://localhost:3000/api');
  });

  it('does not silently send production requests to localhost when configuration is missing', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBeUndefined();
  });

  it('rejects insecure or localhost API URLs in a production build', () => {
    expect(resolveApiBaseUrl('http://localhost:3000/api', true)).toBeUndefined();
    expect(resolveApiBaseUrl('http://api.example.test/api', true)).toBeUndefined();
  });
});
