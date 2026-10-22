const LOCAL_API_BASE_URL = 'http://localhost:3000/api';

/** Vite variables are embedded at build time; production must opt into its API URL explicitly. */
export function resolveApiBaseUrl(configuredUrl: string | undefined, isProduction: boolean): string | undefined {
  const normalized = configuredUrl?.trim().replace(/\/+$/, '');
  if (normalized) {
    if (isProduction) {
      try {
        const url = new URL(normalized);
        if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return undefined;
      } catch {
        return undefined;
      }
    }
    // API routes are mounted under /api. Accept a host-root Vercel setting as
    // well as an already-prefixed base so callers can append paths consistently.
    if (isProduction) {
      const url = new URL(normalized);
      if (!url.pathname.replace(/\/+$/, '').endsWith('/api')) {
        url.pathname = `${url.pathname.replace(/\/+$/, '')}/api`;
      }
      return url.toString().replace(/\/$/, '');
    }
    return normalized;
  }
  return isProduction ? undefined : LOCAL_API_BASE_URL;
}
