import { apiErrorSchema } from '@devrank/contracts';
import { supabase } from '../supabase/client';

// Use Vite's same-origin development proxy by default. This also works when the
// browser opens the app over a LAN address instead of localhost.
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: unknown) { super(message); this.name = 'ApiRequestError'; }
}

export class ApiNetworkError extends Error {
  constructor(message = 'Could not reach the DevRank API. Check that it is running and that this local frontend origin is allowed by API CORS.') {
    super(message);
    this.name = 'ApiNetworkError';
  }
}

async function send(path: string, init: RequestInit | undefined, accessToken?: string): Promise<Response> {
  try {
    const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
    });
  } catch (cause) {
    if (init?.signal?.aborted) throw cause;
    throw new ApiNetworkError();
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  let response = await send(path, init, accessToken);
  // A stored session can outlive the current access token. Refresh once and retry
  // with the SDK's renewed token; never retry arbitrary API failures.
  if (response.status === 401 && accessToken && supabase) {
    let refreshedToken: string | undefined;
    try {
      refreshedToken = (await supabase.auth.refreshSession()).data.session?.access_token;
    } catch {
      throw new ApiNetworkError('Could not refresh your secure session because Supabase Auth is unreachable. Check your connection and try again.');
    }
    if (refreshedToken && refreshedToken !== accessToken) response = await send(path, init, refreshedToken);
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
  return response.json() as Promise<T>;
}
