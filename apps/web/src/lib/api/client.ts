import { apiErrorSchema } from '@devrank/contracts';
import { resolveApiBaseUrl } from './api-base-url';

const baseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD);

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Represents a request that could not receive an HTTP response. */
export class ApiNetworkError extends Error {
  constructor(message = 'Could not connect to the API. Check your connection and try again.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiNetworkError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  if (!baseUrl) {
    throw new ApiRequestError('Set VITE_API_BASE_URL to the deployed HTTPS API before building the production frontend.', 0);
  }
  let response: Response;
  try {
    const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
    });
  } catch (cause) {
    throw new ApiNetworkError(undefined, { cause });
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsedError = apiErrorSchema.safeParse(body);
    const error = parsedError.success ? parsedError.data.error : undefined;
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined;
    throw new ApiRequestError(
      error?.message ?? `API request failed (${response.status})`,
      response.status,
      error?.code,
      error?.details,
      retryAfterSeconds,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
