import { describe, expect, it, vi } from 'vitest';
import {
  clearPasswordRecovery,
  isPasswordRecoveryForUser,
  passwordResetRequestFailureMessage,
  rememberPasswordRecovery,
  requestPasswordReset,
  updatePasswordFromRecovery,
  validatePasswordReset,
  type RecoveryStorage,
} from './password-recovery';
import { MIN_PASSWORD_LENGTH } from './validation';

function createStorage(): RecoveryStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe('password recovery', () => {
  it('validates password length and confirmation', () => {
    expect(validatePasswordReset('short', 'short').password).toContain(String(MIN_PASSWORD_LENGTH));
    expect(validatePasswordReset('a'.repeat(MIN_PASSWORD_LENGTH), 'different').confirm).toBe('Passwords do not match.');
    expect(validatePasswordReset('a'.repeat(MIN_PASSWORD_LENGTH), 'a'.repeat(MIN_PASSWORD_LENGTH))).toEqual({ password: undefined, confirm: undefined });
  });

  it('sends a reset request with the route redirect and surfaces Supabase errors', async () => {
    const request = vi.fn().mockResolvedValue({ error: null });
    await requestPasswordReset(request, 'recruiter@example.com', 'http://localhost:5173/reset-password');
    expect(request).toHaveBeenCalledWith('recruiter@example.com', { redirectTo: 'http://localhost:5173/reset-password' });
    const failure = new Error('rate limited');
    await expect(requestPasswordReset(vi.fn().mockResolvedValue({ error: failure }), 'a@example.com', '/reset')).rejects.toBe(failure);
  });

  it('shows safe rate-limit and network errors for reset requests', () => {
    expect(passwordResetRequestFailureMessage({ code: 'over_email_send_rate_limit' })).toMatch(/wait/i);
    expect(passwordResetRequestFailureMessage(new TypeError('network'))).toMatch(/connection/i);
    expect(passwordResetRequestFailureMessage(new Error('provider detail'))).not.toContain('provider detail');
  });

  it('accepts password updates only for a recovery session', async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    await expect(updatePasswordFromRecovery(update, 'a-valid-new-password', false)).rejects.toThrow(/recovery session/i);
    expect(update).not.toHaveBeenCalled();
    await updatePasswordFromRecovery(update, 'a-valid-new-password', true);
    expect(update).toHaveBeenCalledWith({ password: 'a-valid-new-password' });
    await expect(updatePasswordFromRecovery(vi.fn().mockResolvedValue({ error: new Error('expired') }), 'password', true)).rejects.toThrow('expired');
  });

  it('persists recovery intent for refresh, binds it to the same user, and clears it after use', () => {
    const storage = createStorage();
    rememberPasswordRecovery('user-1', storage);
    expect(isPasswordRecoveryForUser('user-1', storage)).toBe(true);
    expect(isPasswordRecoveryForUser('user-2', storage)).toBe(false);
    clearPasswordRecovery(storage);
    expect(isPasswordRecoveryForUser('user-1', storage)).toBe(false);
  });
});
