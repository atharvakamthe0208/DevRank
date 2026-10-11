import { validatePassword } from './validation';

const RECOVERY_SESSION_KEY = 'devrank.password-recovery-user';

export interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): RecoveryStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function rememberPasswordRecovery(userId: string, storage = browserStorage()): void {
  try { storage?.setItem(RECOVERY_SESSION_KEY, userId); } catch { /* Recovery remains valid for this mounted session. */ }
}

export function isPasswordRecoveryForUser(userId: string | undefined, storage = browserStorage()): boolean {
  if (!userId || !storage) return false;
  try { return storage.getItem(RECOVERY_SESSION_KEY) === userId; } catch { return false; }
}

export function clearPasswordRecovery(storage = browserStorage()): void {
  try { storage?.removeItem(RECOVERY_SESSION_KEY); } catch { /* Storage may be disabled by the browser. */ }
}

export function validatePasswordReset(password: string, confirmation: string) {
  return {
    password: validatePassword(password),
    confirm: confirmation === password && confirmation ? undefined : 'Passwords do not match.',
  };
}

type ResetError = Error | null;
export type PasswordResetRequester = (email: string, options: { redirectTo: string }) => Promise<{ error: ResetError }>;
export type PasswordUpdater = (attributes: { password: string }) => Promise<{ error: ResetError }>;

export async function requestPasswordReset(request: PasswordResetRequester, email: string, redirectTo: string): Promise<void> {
  const { error } = await request(email, { redirectTo });
  if (error) throw error;
}

export function passwordResetRequestFailureMessage(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many reset requests. Wait a little while before trying again.';
  }
  if (cause instanceof TypeError || (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AuthRetryableFetchError')) {
    return 'The password service could not be reached. Check your connection and try again.';
  }
  return 'We could not send a reset email right now. Please try again later.';
}

export async function updatePasswordFromRecovery(
  update: PasswordUpdater,
  password: string,
  hasRecoverySession: boolean,
): Promise<void> {
  if (!hasRecoverySession) throw new Error('A valid password recovery session is required.');
  const { error } = await update({ password });
  if (error) throw error;
}

export function passwordUpdateFailureMessage(cause: unknown): string {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
  if (code === 'weak_password') return 'Choose a password that meets the Supabase project password requirements.';
  if (code === 'otp_expired' || code === 'session_not_found' || code === 'bad_code_verifier') {
    return 'This reset link may have expired or already been used. Request a new password reset email.';
  }
  if (cause instanceof TypeError || (typeof cause === 'object' && cause !== null && 'name' in cause && cause.name === 'AuthRetryableFetchError')) {
    return 'The password service could not be reached. Check your connection and try again.';
  }
  return 'We could not update your password right now. Try again or request a new reset email.';
}
