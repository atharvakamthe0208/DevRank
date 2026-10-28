import { useCallback, useEffect, useRef, useState } from 'react';
import { clearSessionDraft, readSessionDraft, sessionDraftKey, writeSessionDraft } from './session-draft';

type DraftStatus = 'restored' | 'pending' | null;
type Snapshot<T> = { key: string | null; value: T; status: DraftStatus; persisted: boolean };

function snapshotFor<T>(key: string | null, initialValue: T, isValue: (value: unknown) => value is T): Snapshot<T> {
  if (!key) return { key, value: initialValue, status: null, persisted: false };
  const restored = readSessionDraft(key, isValue);
  return restored === null
    ? { key, value: initialValue, status: null, persisted: false }
    : { key, value: restored, status: 'restored', persisted: true };
}

/** Keeps small, validated form values in this browser tab, isolated by user and form/resource. */
export function useSessionDraft<T>(
  userId: string | undefined,
  formId: string,
  initialValue: T,
  isValue: (value: unknown) => value is T,
) {
  const key = userId ? sessionDraftKey(userId, formId) : null;
  const initialRef = useRef(initialValue);
  const validatorRef = useRef(isValue);
  initialRef.current = initialValue;
  validatorRef.current = isValue;
  const [snapshot, setSnapshot] = useState(() => snapshotFor(key, initialValue, isValue));

  useEffect(() => {
    if (snapshot.key !== key) setSnapshot(snapshotFor(key, initialRef.current, validatorRef.current));
  }, [key, snapshot.key]);

  // Do not render a previous user's or record's draft during the render before the effect loads the new key.
  const current = snapshot.key === key ? snapshot : { key, value: initialValue, status: null, persisted: false } as Snapshot<T>;

  const setValue = useCallback((next: T | ((current: T) => T)) => {
    const value = typeof next === 'function' ? (next as (current: T) => T)(current.value) : next;
    const persisted = key ? writeSessionDraft(key, value) : false;
    setSnapshot({ key, value, status: key ? 'pending' : null, persisted });
  }, [current.value, key]);

  const initialize = useCallback((value: T) => {
    setSnapshot((existing) => {
      if (existing.key !== key) return snapshotFor(key, initialRef.current, validatorRef.current);
      if (existing.key === key && (existing.status === 'restored' || existing.status === 'pending')) return existing;
      return { key, value, status: null, persisted: false };
    });
  }, [key]);

  const clear = useCallback((value?: T) => {
    if (key) clearSessionDraft(key);
    setSnapshot({ key, value: value === undefined ? initialRef.current : value, status: null, persisted: false });
  }, [key]);

  return { value: current.value, status: current.status, persisted: current.persisted, setValue, initialize, clear };
}
