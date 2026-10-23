const screeningSessionIdPattern = /^[0-9a-f-]{36}$/i;

export function isValidScreeningSessionId(value: string | null): value is string {
  return value !== null && screeningSessionIdPattern.test(value);
}

export function shouldShowScreeningRestoreSkeleton(
  accessToken: string | null | undefined,
  storedSessionId: string | null,
  cachedSessionId?: string,
): boolean {
  return Boolean(accessToken && isValidScreeningSessionId(storedSessionId) && cachedSessionId !== storedSessionId);
}
