import { apiErrorSchema } from '@devrank/contracts';
import { resolveApiBaseUrl } from './api-base-url';

const baseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD);

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
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
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
    });
  } catch (cause) {
    throw new ApiNetworkError(undefined, { cause });
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsedError = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      parsedError.success ? parsedError.data.error.message : `API request failed (${response.status})`,
      response.status,
      parsedError.success ? parsedError.data.error.code : undefined,
      parsedError.success ? parsedError.data.error.details : undefined,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
