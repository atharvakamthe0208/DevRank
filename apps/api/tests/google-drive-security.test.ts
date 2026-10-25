import { describe, expect, it } from 'vitest';
import { decryptRefreshToken, encryptRefreshToken, parseDriveFileId, signOAuthState, verifyOAuthState } from '../src/modules/google-drive/security.js';

const key = Buffer.alloc(32, 19).toString('base64');

describe('Google Drive resume reference security', () => {
  it('extracts IDs from supported Google Drive upload link formats', () => {
    expect(parseDriveFileId('https://drive.google.com/open?id=1Abcdefghijk_123')).toBe('1Abcdefghijk_123');
    expect(parseDriveFileId('https://drive.google.com/file/d/1Abcdefghijk_123/view?usp=sharing')).toBe('1Abcdefghijk_123');
    expect(parseDriveFileId('https://drive.google.com/uc?export=download&id=1Abcdefghijk_123')).toBe('1Abcdefghijk_123');
  });

  it('rejects arbitrary hosts, insecure URLs, credentials, malformed IDs, and unrecognized paths', () => {
    for (const value of [
      'https://example.com/file/d/1Abcdefghijk_123',
      'http://drive.google.com/open?id=1Abcdefghijk_123',
      'https://user@drive.google.com/open?id=1Abcdefghijk_123',
      'https://drive.google.com.evil.test/open?id=1Abcdefghijk_123',
      'https://drive.google.com/not-an-upload?id=1Abcdefghijk_123',
      'https://drive.google.com/file/d/short/view',
      'not a URL',
    ]) expect(parseDriveFileId(value)).toBeNull();
  });
});

describe('Google Drive OAuth state and token storage', () => {
  it('signs and validates short-lived OAuth state, rejecting tampering and expiry', () => {
    const payload = { userId: 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2', webOrigin: 'http://localhost:5173', expiresAt: 19_500, nonce: 'a'.repeat(32) };
    const signed = signOAuthState(payload, 'state-secret-that-is-long-enough-for-tests');
    expect(verifyOAuthState(signed, 'state-secret-that-is-long-enough-for-tests', 19_000)).toEqual(payload);
    expect(verifyOAuthState(`${signed}x`, 'state-secret-that-is-long-enough-for-tests', 19_000)).toBeNull();
    expect(verifyOAuthState(signed, 'different-state-secret-for-tests', 19_000)).toBeNull();
    expect(verifyOAuthState(signed, 'state-secret-that-is-long-enough-for-tests', 19_500)).toBeNull();
  });

  it('encrypts refresh tokens with authenticated encryption and detects tampering', () => {
    const encrypted = encryptRefreshToken('refresh-token-never-log-this', key);
    expect(encrypted.ciphertext).not.toContain('refresh-token-never-log-this');
    expect(decryptRefreshToken(encrypted, key)).toBe('refresh-token-never-log-this');
    expect(() => decryptRefreshToken({ ...encrypted, ciphertext: Buffer.from('changed').toString('base64') }, key)).toThrow();
  });
});
