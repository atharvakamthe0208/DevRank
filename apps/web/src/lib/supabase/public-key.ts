/** Prefer the current public publishable key, while keeping legacy anon-key env files compatible. */
export function selectSupabasePublicKey(publishableKey: string | undefined, legacyAnonKey: string | undefined): string | undefined {
  return publishableKey?.trim() || legacyAnonKey?.trim() || undefined;
}
