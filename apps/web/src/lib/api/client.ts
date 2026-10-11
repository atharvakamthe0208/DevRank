import { apiErrorSchema } from '@devrank/contracts';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'ApiRequestError'; }
}

export async function apiRequest<T>(path: string, init?: RequestInit, accessToken?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsedError = apiErrorSchema.safeParse(body);
    throw new ApiRequestError(parsedError.success ? parsedError.data.error.message : `API request failed (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}
