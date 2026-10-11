import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function hasBrowserSafeConfiguration(projectUrl: string | undefined, publicKey: string | undefined): boolean {
  if (!projectUrl || !publicKey || /your-project|your-public-anon-key|placeholder/i.test(`${projectUrl} ${publicKey}`)) return false;
  if (publicKey.startsWith('sb_secret_')) return false;
  const jwtPayload = publicKey.split('.')[1];
  if (jwtPayload) {
    try {
      const payload = JSON.parse(atob(jwtPayload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
      if (payload.role === 'service_role') return false;
    } catch {
      // New publishable keys are not JWTs; Supabase validates their format.
    }
  }
  try {
    const parsed = new URL(projectUrl);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    return (parsed.protocol === 'https:' || localHttp) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

// Browser code may only use the publishable/anon key. Never place a service-role key here.
export const supabase = url && anonKey && hasBrowserSafeConfiguration(url, anonKey) ? createClient(url, anonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
}) : null;
