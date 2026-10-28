import { registerSessionStateClearer } from '../../lib/session-scoped-state';

export function createUserSessionCache<T>() {
  const cache = new Map<string, T>();
  const key = (userId: string, sessionId: string) => `${userId}\u0000${sessionId}`;
  const cacheApi = {
    get(userId: string, sessionId: string) { return cache.get(key(userId, sessionId)); },
    set(userId: string, sessionId: string, value: T) { cache.set(key(userId, sessionId), value); },
    delete(userId: string, sessionId: string) { cache.delete(key(userId, sessionId)); },
    clear() { cache.clear(); },
  };
  registerSessionStateClearer(cacheApi.clear);
  return cacheApi;
}
