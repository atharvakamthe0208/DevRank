import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const DRIVE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** Accept only known Google Drive URL shapes. Never accepts a URL to fetch. */
export function parseDriveFileId(reference: string): string | null {
  try {
    const url = new URL(reference.trim());
    if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const markerIndex = parts.findIndex((part, index) => part === 'd'
      && ['file', 'document', 'spreadsheets', 'presentation', 'forms'].includes(parts[index - 1] ?? ''));
    const pathId = markerIndex >= 0 ? parts[markerIndex + 1] : null;
    const knownQueryPath = url.pathname === '/' || url.pathname === '/open' || url.pathname === '/uc';
    const ids = url.searchParams.getAll('id');
    const queryId = knownQueryPath && ids.length === 1 ? ids[0] : null;
    const fileId = pathId ?? queryId;
    return fileId && DRIVE_FILE_ID.test(fileId) ? fileId : null;
  } catch {
    return null;
  }
}

export type GoogleDriveOAuthState = { userId: string; webOrigin: string; expiresAt: number; nonce: string };

export function signOAuthState(value: GoogleDriveOAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyOAuthState(state: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): GoogleDriveOAuthState | null {
  const [payload, signature, extra] = state.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<GoogleDriveOAuthState>;
    if (typeof parsed.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(parsed.userId)
      || typeof parsed.webOrigin !== 'string' || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= nowSeconds || parsed.expiresAt > nowSeconds + 11 * 60
      || typeof parsed.nonce !== 'string' || !/^[a-f0-9]{32}$/i.test(parsed.nonce)) return null;
    const origin = new URL(parsed.webOrigin);
    if (origin.origin !== parsed.webOrigin || !['http:', 'https:'].includes(origin.protocol)) return null;
    return parsed as GoogleDriveOAuthState;
  } catch { return null; }
}

export function encryptRefreshToken(token: string, keyBase64: string): { ciphertext: string; iv: string; tag: string } {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key material.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptRefreshToken(value: { ciphertext: string; iv: string; tag: string }, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key material.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
