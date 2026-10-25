const screeningSessionIdPattern = /^[0-9a-f-]{36}$/i;

export function isValidScreeningSessionId(value: string | null): value is string {
  return value !== null && screeningSessionIdPattern.test(value);
}
