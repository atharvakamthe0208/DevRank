export function screeningErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && (cause.name === 'ApiRequestError' || cause.name === 'ApiNetworkError')) return cause.message;
  if (cause instanceof Error && cause.name === 'ZodError') {
    return 'The screening service returned results in an unexpected format. Try loading the results again; contact support if the problem continues.';
  }
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
