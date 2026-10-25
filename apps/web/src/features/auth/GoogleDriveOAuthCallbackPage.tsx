import { useEffect } from 'react';

const allowedStatuses = new Set(['connected', 'authorization_denied', 'connection_failed', 'invalid_state']);

export function GoogleDriveOAuthCallbackPage() {
  const queryStatus = new URLSearchParams(window.location.search).get('status');
  const status = queryStatus && allowedStatuses.has(queryStatus) ? queryStatus : 'connection_failed';

  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage({ type: 'devrank-google-drive-oauth', status }, window.location.origin);
    window.setTimeout(() => window.close(), 250);
  }, [status]);

  const message = status === 'connected' ? 'Google Drive is connected. Return to the DevRank import window.'
    : status === 'authorization_denied' ? 'Google Drive access was not granted. Return to DevRank to continue with CSV-only import.'
      : status === 'invalid_state' ? 'The Google Drive authorization expired or could not be verified. Return to DevRank and try again.'
        : 'Google Drive could not be connected. Check the Google Cloud OAuth configuration and try again.';
  return <main className="auth-state-page"><h1>Google Drive authorization</h1><p role="status">{message}</p><button className="secondary-button" type="button" onClick={() => window.close()}>Close this window</button></main>;
}
