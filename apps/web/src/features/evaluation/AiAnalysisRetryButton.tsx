import { useEffect, useState } from 'react';

export function AiAnalysisRetryButton({
  retryAt,
  pending = false,
  onRetry,
  className,
  idleLabel = 'Try again',
}: {
  retryAt?: number;
  pending?: boolean;
  onRetry?: () => void;
  className: string;
    idleLabel?: string;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : 0);

  useEffect(() => {
    if (!retryAt) {
      setSecondsLeft(0);
      return;
    }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);

  return <button className={className} type="button" onClick={onRetry} disabled={pending || secondsLeft > 0}>
    {pending ? 'Analyzing…' : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : idleLabel}
  </button>;
}
