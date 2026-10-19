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
    return normalized;
  }
  return isProduction ? undefined : LOCAL_API_BASE_URL;
}
