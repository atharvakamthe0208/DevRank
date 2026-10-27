const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const productionWebOrigins = new Set(['https://dev-rank-ruddy.vercel.app']);

/** Allow configured/known app origins everywhere and arbitrary Vite loopback ports only outside production. */
export function isCorsOriginAllowed(
  origin: string | undefined,
  nodeEnv: 'development' | 'test' | 'production',
  configuredOrigin: string,
  additionalOrigins: readonly string[] = [],
): boolean {
  // Requests without Origin are typically server-to-server or command-line clients.
  if (!origin || origin === configuredOrigin || additionalOrigins.includes(origin) || productionWebOrigins.has(origin)) return true;
  if (nodeEnv === 'production') return false;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || !localHosts.has(parsed.hostname)) return false;
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
    // Browser Origin values are serialized without a trailing slash.
    return parsed.origin === origin;
  } catch {
    return false;
  }
}
