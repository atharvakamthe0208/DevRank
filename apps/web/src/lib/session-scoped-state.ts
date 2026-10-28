const clearers = new Set<() => void>();

/** Register ephemeral client state that must be cleared when Supabase ends a session. */
export function registerSessionStateClearer(clearer: () => void) {
  clearers.add(clearer);
  return () => clearers.delete(clearer);
}

export function clearSessionScopedState() {
  for (const clear of clearers) clear();
}
