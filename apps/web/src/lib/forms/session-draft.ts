export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const SESSION_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ENVELOPE_VERSION = 1;

function browserSessionStorage(): DraftStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; }
}

export function sessionDraftKey(userId: string, formId: string): string {
  return `devrank.form-draft.v1:${encodeURIComponent(userId)}:${encodeURIComponent(formId)}`;
}

export function readSessionDraft<T>(
  key: string,
  isValue: (value: unknown) => value is T,
  storage = browserSessionStorage(),
  now = Date.now(),
  maxAgeMs = SESSION_DRAFT_MAX_AGE_MS,
): T | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(key);
    if (!serialized) return null;
    const envelope: unknown = JSON.parse(serialized);
    if (typeof envelope !== 'object' || envelope === null || !('version' in envelope) || !('savedAt' in envelope) || !('value' in envelope)) {
      storage.removeItem(key);
      return null;
    }
    const value = envelope.value;
    const savedAt = envelope.savedAt;
    if (envelope.version !== ENVELOPE_VERSION || typeof savedAt !== 'number' || !Number.isFinite(savedAt)
      || savedAt > now || now - savedAt > maxAgeMs || !isValue(value)) {
      storage.removeItem(key);
      return null;
    }
    return value;
  } catch {
    try { storage.removeItem(key); } catch { /* Storage may be disabled or unavailable. */ }
    return null;
  }
}

export function writeSessionDraft<T>(key: string, value: T, storage = browserSessionStorage(), now = Date.now()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ version: ENVELOPE_VERSION, savedAt: now, value }));
    return true;
  } catch { return false; }
}

export function clearSessionDraft(key: string, storage = browserSessionStorage()): void {
  try { storage?.removeItem(key); } catch { /* Storage may be disabled or unavailable. */ }
}
