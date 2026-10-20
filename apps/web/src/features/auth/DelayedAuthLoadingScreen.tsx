import { useEffect, useState } from 'react';
import { AuthLoadingScreen } from './AuthLoadingScreen';

export function DelayedAuthLoadingScreen({ loading, message }: { loading: boolean; message: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }

    const timeout = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  return visible ? <AuthLoadingScreen message={message}/> : null;
}
