import { useEffect, useRef, type RefObject } from 'react';
import { useBlocker } from 'react-router-dom';

export function useUnsavedChangesBlocker(isDirty: boolean, message: string, allowNavigationRef?: RefObject<boolean>) {
  const promptedLocation = useRef<string | null>(null);
  const blocker = useBlocker(isDirty ? () => !allowNavigationRef?.current : false);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const key = `${blocker.location.pathname}${blocker.location.search}${blocker.location.hash}`;
    if (promptedLocation.current === key) return;
    promptedLocation.current = key;
    if (window.confirm(message)) blocker.proceed();
    else { promptedLocation.current = null; blocker.reset(); }
  }, [blocker, message]);
}
