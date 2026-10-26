import { describe, expect, it } from 'vitest';
import { clearSessionDraft, readSessionDraft, sessionDraftKey, writeSessionDraft, type DraftStorage } from './session-draft';

function memoryStorage(): DraftStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

function isStringRecord(value: unknown): value is { name: string; email: string } {
  return typeof value === 'object' && value !== null
    && 'name' in value && typeof value.name === 'string'
    && 'email' in value && typeof value.email === 'string';
}

describe('session-scoped form drafts', () => {
  it('restores a partially entered form after a simulated route remount or browser refresh', () => {
    const storage = memoryStorage();
    const key = sessionDraftKey('user-1', 'candidate:new');
    const partial = { name: 'Jordan', email: '' };
    expect(writeSessionDraft(key, partial, storage, 1000)).toBe(true);
    // A second read represents a newly mounted page after navigation or reload.
    expect(readSessionDraft(key, isStringRecord, storage, 1500)).toEqual(partial);
  });

  it('isolates drafts by user, form, and record identifier', () => {
    const storage = memoryStorage();
    const candidateA = sessionDraftKey('user-1', 'candidate:abc');
    const candidateB = sessionDraftKey('user-1', 'candidate:def');
    const anotherUser = sessionDraftKey('user-2', 'candidate:abc');
    writeSessionDraft(candidateA, { name: 'A', email: '' }, storage, 1000);
    writeSessionDraft(candidateB, { name: 'B', email: '' }, storage, 1000);
    expect(readSessionDraft(candidateA, isStringRecord, storage, 1100)?.name).toBe('A');
    expect(readSessionDraft(candidateB, isStringRecord, storage, 1100)?.name).toBe('B');
    expect(readSessionDraft(anotherUser, isStringRecord, storage, 1100)).toBeNull();
  });

  it('removes malformed, incompatible, and expired drafts without throwing', () => {
    const storage = memoryStorage();
    const key = sessionDraftKey('user-1', 'screening:new');
    storage.setItem(key, '{bad json');
    expect(readSessionDraft(key, isStringRecord, storage, 1000)).toBeNull();
    expect(storage.getItem(key)).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 2, savedAt: 900, value: { name: 'old', email: '' } }));
    expect(readSessionDraft(key, isStringRecord, storage, 1000)).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 1, savedAt: 0, value: { name: 'old', email: '' } }));
    expect(readSessionDraft(key, isStringRecord, storage, 86_400_001)).toBeNull();
  });

  it('clears only the explicitly saved or discarded draft', () => {
    const storage = memoryStorage();
    const first = sessionDraftKey('user-1', 'candidate:new');
    const second = sessionDraftKey('user-1', 'profile:recruiter');
    writeSessionDraft(first, { name: 'Jordan', email: '' }, storage, 1000);
    writeSessionDraft(second, { name: 'Recruiter', email: 'work@example.com' }, storage, 1000);
    clearSessionDraft(first, storage);
    expect(readSessionDraft(first, isStringRecord, storage, 1100)).toBeNull();
    expect(readSessionDraft(second, isStringRecord, storage, 1100)).toEqual({ name: 'Recruiter', email: 'work@example.com' });
  });

  it('keeps a failed or unconfirmed save draft until explicitly cleared after success', () => {
    const storage = memoryStorage();
    const key = sessionDraftKey('user-1', 'candidate:new');
    const entered = { name: 'Jordan', email: 'jordan@example.com' };
    writeSessionDraft(key, entered, storage, 1000);
    const failedSave = { ok: false };
    if (failedSave.ok) clearSessionDraft(key, storage);
    expect(readSessionDraft(key, isStringRecord, storage, 1100)).toEqual(entered);
    const confirmedSave = { ok: true };
    if (confirmedSave.ok) clearSessionDraft(key, storage);
    expect(readSessionDraft(key, isStringRecord, storage, 1200)).toBeNull();
  });
});
