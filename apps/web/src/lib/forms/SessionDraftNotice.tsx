import type { ReactNode } from 'react';

export function SessionDraftNotice({
  status,
  persisted,
  onDiscard,
  discardLabel = 'Discard draft',
  restoredMessage,
}: {
  status: 'restored' | 'pending' | null;
  persisted: boolean;
  onDiscard?: () => void;
  discardLabel?: ReactNode;
  restoredMessage?: string;
}) {
  if (!status) return null;
  const message = status === 'restored'
    ? restoredMessage ?? 'Draft restored from this browser tab. Review it before saving.'
    : persisted ? 'Unsaved changes are kept in this browser tab.' : 'Unsaved changes.';
  return <div className="form-draft-notice" role="status" aria-live="polite"><span>{message}</span>{onDiscard && <button type="button" className="text-button" onClick={onDiscard}>{discardLabel}</button>}</div>;
}
