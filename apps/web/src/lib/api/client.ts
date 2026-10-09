import { apiErrorSchema } from '@devrank/contracts';

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api';

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsedError = apiErrorSchema.safeParse(body);
    throw new Error(parsedError.success ? parsedError.data.error.message : `API request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
