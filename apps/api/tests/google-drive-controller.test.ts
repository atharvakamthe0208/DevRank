import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createGoogleDriveController } from '../src/modules/google-drive/controller.js';
import { decryptRefreshToken, encryptRefreshToken, signOAuthState } from '../src/modules/google-drive/security.js';

const ownerId = 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const candidateId = 'c3a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const sessionId = 'a6a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const resumeId = 'b7a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
const config = {
  GOOGLE_DRIVE_CLIENT_ID: 'client-id', GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
  GOOGLE_DRIVE_REDIRECT_URI: 'http://localhost:3000/api/google-drive/callback',
  GOOGLE_DRIVE_STATE_SECRET: 'state-secret-value-that-is-long-enough',
  GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY: encryptionKey,
  WEB_ORIGIN: 'http://localhost:5173', WEB_ORIGINS: '', NODE_ENV: 'test' as const,
};
const encrypted = encryptRefreshToken('refresh-token-for-tests', encryptionKey);
const fileId = '1Abcdefghijk_123';

function screeningSubmit(pathSink: string[] = []): RequestHandler {
  return (request, response, next) => {
    const files = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
    void Promise.all(files.map(async (file) => {
      pathSink.push(file.path);
      return readFile(file.path);
    })).then((buffers) => {
      response.status(201).json({ sessionId, status: 'processing', resumes: files.map((file) => ({ id: resumeId, filename: file.originalname, status: 'queued' })) });
      expect(buffers.every((buffer) => buffer.subarray(0, 5).toString('ascii') === '%PDF-')).toBe(true);
    }).catch(next);
  };
}

function controllerFor(fetcher: typeof fetch, screening = screeningSubmit(), connection = { encrypted_refresh_token: encrypted.ciphertext, token_iv: encrypted.iv, token_auth_tag: encrypted.tag }) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), delete: vi.fn(), upsert: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.delete.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: connection, error: null });
  query.upsert.mockResolvedValue({ error: null });
  query.delete.mockResolvedValue({ error: null });
  const service = { from: vi.fn(() => query) };
  const factory = vi.fn(() => service) as never;
  return { controller: createGoogleDriveController(config, factory, fetcher, screening), query, factory };
}

async function invokeScreen(controller: ReturnType<typeof createGoogleDriveController>, fileIdValue = fileId) {
  return new Promise<{ error?: unknown; status: number; body?: unknown }>((resolve, reject) => {
    let status = 200;
    const response = {
      status: (value: number) => { status = value; return response; },
      json: (body: unknown) => resolve({ status, body }),
    };
    const request = {
      auth: { userId: ownerId },
      body: { jobTitle: 'Backend Engineer', jobDescription: 'Build reliable backend systems, review code, and operate production services.', resumes: [{ fileId: fileIdValue, candidateId }] },
      get: (name: string) => name === 'Idempotency-Key' ? '11111111-1111-4111-8111-111111111111' : undefined,
    } as unknown as Request;
    controller.screen(request, response as unknown as Response, ((error?: unknown) => error ? reject(error) : undefined) as NextFunction);
  });
}

function goodFetcher(bytes = Buffer.from('%PDF-1.7 valid resume')) {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ access_token: 'short-lived-token', expires_in: 3600 }), { status: 200 }))
    .mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ id: fileId, name: 'resume.pdf', mimeType: 'application/pdf', size: String(bytes.length), trashed: false, capabilities: { canDownload: true } }), { status: 200 }))
    .mockResolvedValueOnce(new globalThis.Response(bytes, { status: 200 }));
  return { fetcher, bytes };
}

describe('secure Google Drive resume processing', () => {
  it('builds a short-lived authorization-code URL with only the Drive read-only scope', async () => {
    const controller = createGoogleDriveController(config, vi.fn() as never, vi.fn() as never);
    const request = { auth: { userId: ownerId }, get: () => 'http://localhost:5173' } as unknown as Request;
    const result = await new Promise<{ authorizationUrl: string }>((resolve, reject) => {
      controller.connect(request, { json: resolve } as unknown as Response, reject as NextFunction);
    });
    const authorization = new URL(result.authorizationUrl);
    expect(authorization.origin).toBe('https://accounts.google.com');
    expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.readonly');
    expect(authorization.searchParams.get('access_type')).toBe('offline');
    expect(authorization.searchParams.get('response_type')).toBe('code');
  });

  it('exchanges a valid callback and stores only an encrypted refresh token', async () => {
    let stored: Record<string, unknown> | undefined;
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), upsert: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    query.upsert.mockImplementation(async (value: Record<string, unknown>) => { stored = value; return { error: null }; });
    const factory = vi.fn(() => ({ from: vi.fn(() => query) })) as never;
    const fetcher = vi.fn().mockResolvedValue(new globalThis.Response(JSON.stringify({ access_token: 'temporary-access-token', refresh_token: 'long-lived-refresh-secret', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.readonly' }), { status: 200 }));
    const controller = createGoogleDriveController(config, factory, fetcher);
    const state = signOAuthState({ userId: ownerId, webOrigin: 'http://localhost:5173', expiresAt: Math.floor(Date.now() / 1000) + 60, nonce: 'b'.repeat(32) }, config.GOOGLE_DRIVE_STATE_SECRET!);
    const result = await new Promise<{ status: number; location: string }>((resolve, reject) => {
      const request = { query: { state, code: 'one-time-code' } } as unknown as Request;
      const response = { redirect: (code: number, location: string) => resolve({ status: code, location }) };
      controller.callback(request, response as unknown as Response, reject as NextFunction);
    });
    expect(result).toEqual({ status: 303, location: 'http://localhost:5173/google-drive/callback?status=connected' });
    expect(stored).toMatchObject({ owner_id: ownerId });
    expect(stored?.encrypted_refresh_token).not.toBe('long-lived-refresh-secret');
    expect(decryptRefreshToken({ ciphertext: String(stored?.encrypted_refresh_token), iv: String(stored?.token_iv), tag: String(stored?.token_auth_tag) }, encryptionKey)).toBe('long-lived-refresh-secret');
  });

  it('downloads through a restricted API path into private temp storage and cleans it after the existing screener queues the file', async () => {
    const { fetcher, bytes } = goodFetcher();
    const paths: string[] = [];
    const { controller } = controllerFor(fetcher, screeningSubmit(paths));
    const result = await invokeScreen(controller);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ results: [{ candidateId, fileId, status: 'queued', sessionId, resumeId }] });
    expect(paths).toHaveLength(1);
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect(stat(paths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=`);
    expect(String(fetcher.mock.calls[2]?.[0])).toBe(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  });

  it('rejects malformed file IDs before outbound requests', async () => {
    const fetcher = vi.fn();
    const { controller, factory } = controllerFor(fetcher);
    const result = await invokeScreen(controller, 'https://evil.example/private-file');
    expect(result.body).toMatchObject({ results: [{ status: 'failed', code: 'INVALID_GOOGLE_DRIVE_FILE_ID' }] });
    expect(factory).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns clear results for inaccessible, deleted, unsupported, invalid, and oversized files', async () => {
    const scenarios = [
      { response: new globalThis.Response(JSON.stringify({ error: { message: 'secret file metadata' } }), { status: 403 }), code: 'GOOGLE_DRIVE_FILE_INACCESSIBLE' },
      { response: new globalThis.Response(JSON.stringify({ error: { errors: [{ reason: 'notFound' }] } }), { status: 404 }), code: 'GOOGLE_DRIVE_FILE_NOT_FOUND' },
      { response: new globalThis.Response(JSON.stringify({ id: fileId, name: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: '100' }), { status: 200 }), code: 'GOOGLE_DRIVE_UNSUPPORTED_FILE' },
      { response: new globalThis.Response(JSON.stringify({ id: fileId, name: 'resume.pdf', mimeType: 'application/pdf', size: '4', capabilities: { canDownload: true } }), { status: 200 }), code: 'GOOGLE_DRIVE_INVALID_PDF', content: Buffer.from('NOPE') },
      { response: new globalThis.Response(JSON.stringify({ id: fileId, name: 'resume.pdf', mimeType: 'application/pdf', size: String(10 * 1024 * 1024 + 1), capabilities: { canDownload: true } }), { status: 200 }), code: 'GOOGLE_DRIVE_FILE_TOO_LARGE' },
    ];
    for (const scenario of scenarios) {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ access_token: 'access', expires_in: 3600 }), { status: 200 }))
        .mockResolvedValueOnce(scenario.response);
      if (scenario.content) fetcher.mockResolvedValueOnce(new globalThis.Response(scenario.content, { status: 200 }));
      const result = await invokeScreen(controllerFor(fetcher).controller);
      expect(result.body).toMatchObject({ results: [{ status: 'failed', code: scenario.code }] });
      expect(result.body).not.toEqual(expect.objectContaining({ message: 'secret file metadata' }));
    }
  });

  it('clears the connection after Google reports a revoked refresh token', async () => {
    const fetcher = vi.fn().mockResolvedValue(new globalThis.Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    const { controller, query } = controllerFor(fetcher);
    const result = await invokeScreen(controller);
    expect(result.body).toMatchObject({ results: [{ status: 'failed', code: 'GOOGLE_DRIVE_REAUTH_REQUIRED' }] });
    expect(query.delete).toHaveBeenCalled();
  });
});
