import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { googleDriveResumeScreenRequestSchema, googleDriveResumeScreenResponseSchema, screeningSubmissionResponseSchema, type GoogleDriveResumeScreenResponse } from '@devrank/contracts';
import { env } from '../../config/env.js';
import { getSupabaseServiceClient } from '../../config/supabase.js';
import { HttpError } from '../../middleware/http-error.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { isCorsOriginAllowed } from '../../config/cors-policy.js';
import { createScreeningController } from '../../controllers/screening-controller.js';
import { decryptRefreshToken, encryptRefreshToken, signOAuthState, verifyOAuthState } from './security.js';

const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const MAX_RESUME_BYTES = 10 * 1024 * 1024;
type DriveConnection = { encrypted_refresh_token: string; token_iv: string; token_auth_tag: string };
type CachedToken = { token: string; expiresAt: number };
type GoogleDriveEnvironment = Pick<typeof env, 'GOOGLE_DRIVE_CLIENT_ID' | 'GOOGLE_DRIVE_CLIENT_SECRET' | 'GOOGLE_DRIVE_REDIRECT_URI' | 'GOOGLE_DRIVE_STATE_SECRET' | 'GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY' | 'WEB_ORIGIN' | 'WEB_ORIGINS' | 'NODE_ENV'>;
type Fetcher = typeof fetch;
type ServiceClientFactory = typeof getSupabaseServiceClient;
type ScreeningSubmit = RequestHandler;

function configurationReady(config: GoogleDriveEnvironment) {
  if (!config.GOOGLE_DRIVE_CLIENT_ID || !config.GOOGLE_DRIVE_CLIENT_SECRET || !config.GOOGLE_DRIVE_REDIRECT_URI
    || !config.GOOGLE_DRIVE_STATE_SECRET || config.GOOGLE_DRIVE_STATE_SECRET.length < 32 || !config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY) return false;
  try {
    const redirect = new URL(config.GOOGLE_DRIVE_REDIRECT_URI);
    const localHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname);
    if ((!localHttp && redirect.protocol !== 'https:') || redirect.pathname.replace(/\/$/, '') !== '/api/google-drive/callback' || redirect.search || redirect.hash) return false;
    return Buffer.from(config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY, 'base64').length === 32;
  } catch { return false; }
}

function requireConfiguration(config: GoogleDriveEnvironment) {
  if (!configurationReady(config)) throw new HttpError(503, 'GOOGLE_DRIVE_NOT_CONFIGURED', 'Google Drive OAuth is not configured. Add the server-side Google Drive settings to apps/api/.env and restart the API.');
}

function webOriginFromRequest(request: Request, config: GoogleDriveEnvironment) {
  const origin = request.get('origin') ?? config.WEB_ORIGIN;
  const allowed = isCorsOriginAllowed(origin, config.NODE_ENV, config.WEB_ORIGIN,
    (config.WEB_ORIGINS ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  if (!allowed || !origin) throw new HttpError(400, 'GOOGLE_DRIVE_ORIGIN_NOT_ALLOWED', 'Open DevRank from an approved web origin before connecting Google Drive.');
  return origin;
}

function safeCallbackUrl(origin: string, status: string) {
  const url = new URL('/google-drive/callback', origin);
  url.searchParams.set('status', status);
  return url.toString();
}

function providerError(status: number, reason?: string): HttpError {
  if (status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason ?? '')) return new HttpError(503, 'GOOGLE_DRIVE_RATE_LIMITED', 'Google Drive is temporarily rate limited. Wait briefly and retry this resume.');
  if (status === 401 || status === 403) return new HttpError(403, 'GOOGLE_DRIVE_FILE_INACCESSIBLE', 'The authorized Google account cannot access this resume. Share the file with that account or choose a different Drive account.');
  if (status === 404) return new HttpError(404, 'GOOGLE_DRIVE_FILE_NOT_FOUND', 'This Google Drive file was deleted or is not available to the authorized account.');
  return new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google Drive could not provide this resume right now. Retry the download.');
}

async function mapProviderError(response: globalThis.Response): Promise<HttpError> {
  const body = await response.clone().json().catch(() => null) as { error?: { errors?: Array<{ reason?: unknown }> } } | null;
  const reason = body?.error?.errors?.[0]?.reason;
  return providerError(response.status, typeof reason === 'string' ? reason : undefined);
}

async function readLimited(response: globalThis.Response, maximum: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) throw new HttpError(413, 'GOOGLE_DRIVE_FILE_TOO_LARGE', 'This resume exceeds DevRank’s 10 MB upload limit.');
  if (!response.body) throw new HttpError(502, 'GOOGLE_DRIVE_EMPTY_FILE', 'Google Drive returned an empty file.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximum) { await reader.cancel(); throw new HttpError(413, 'GOOGLE_DRIVE_FILE_TOO_LARGE', 'This resume exceeds DevRank’s 10 MB upload limit.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function createGoogleDriveController(
  config: GoogleDriveEnvironment = env,
  serviceClientFactory: ServiceClientFactory = getSupabaseServiceClient,
  fetcher: Fetcher = fetch,
  screeningSubmit: ScreeningSubmit = createScreeningController().submit,
) {
  const accessTokens = new Map<string, CachedToken>();
  const inFlightTokenRefresh = new Map<string, Promise<string>>();

  async function connectionFor(ownerId: string): Promise<DriveConnection | null> {
    let client;
    try { client = serviceClientFactory(); }
    catch { throw new HttpError(503, 'GOOGLE_DRIVE_STORAGE_UNAVAILABLE', 'Secure Google Drive connection storage is unavailable. Apply the Google Drive connection migration and configure the API service key.'); }
    const { data, error } = await client.from('google_drive_connections').select('encrypted_refresh_token,token_iv,token_auth_tag').eq('owner_id', ownerId).maybeSingle();
    if (error) throw new HttpError(503, 'GOOGLE_DRIVE_STORAGE_UNAVAILABLE', 'Secure Google Drive connection storage is unavailable. Apply the Google Drive connection migration.');
    return data as DriveConnection | null;
  }

  async function clearConnection(ownerId: string) {
    accessTokens.delete(ownerId);
    inFlightTokenRefresh.delete(ownerId);
    try {
      const { error } = await serviceClientFactory().from('google_drive_connections').delete().eq('owner_id', ownerId);
      if (error) throw error;
    } catch { /* Keep revoke and recovery errors independent of provider response bodies. */ }
  }

  async function getAccessToken(ownerId: string): Promise<string> {
    const cached = accessTokens.get(ownerId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const current = inFlightTokenRefresh.get(ownerId);
    if (current) return current;
    const refresh = (async () => {
      const connection = await connectionFor(ownerId);
      if (!connection) throw new HttpError(409, 'GOOGLE_DRIVE_REAUTH_REQUIRED', 'Connect an authorized Google Drive account before importing resumes.');
      let refreshToken: string;
      try { refreshToken = decryptRefreshToken({ ciphertext: connection.encrypted_refresh_token, iv: connection.token_iv, tag: connection.token_auth_tag }, config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY!); }
      catch { await clearConnection(ownerId); throw new HttpError(409, 'GOOGLE_DRIVE_REAUTH_REQUIRED', 'The saved Google Drive connection is no longer usable. Connect Google Drive again.'); }
      let response: globalThis.Response;
      try {
        response = await fetcher(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: config.GOOGLE_DRIVE_CLIENT_ID!, client_secret: config.GOOGLE_DRIVE_CLIENT_SECRET!, refresh_token: refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15_000) });
      } catch { throw new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google authorization could not be reached. Retry shortly.'); }
      const tokenBody = await response.json().catch(() => ({})) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; error?: unknown };
      if (!response.ok) {
        if (tokenBody.error === 'invalid_grant' || response.status === 401) {
          await clearConnection(ownerId);
          throw new HttpError(409, 'GOOGLE_DRIVE_REAUTH_REQUIRED', 'Google Drive access expired or was revoked. Connect Google Drive again.');
        }
        throw new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google authorization could not refresh access. Retry shortly.');
      }
      if (typeof tokenBody.access_token !== 'string' || typeof tokenBody.expires_in !== 'number') throw new HttpError(502, 'GOOGLE_DRIVE_INVALID_TOKEN_RESPONSE', 'Google authorization returned an invalid response. Reconnect Google Drive if the problem continues.');
      if (typeof tokenBody.refresh_token === 'string') {
        const encrypted = encryptRefreshToken(tokenBody.refresh_token, config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY!);
        const { error } = await serviceClientFactory().from('google_drive_connections').update({ encrypted_refresh_token: encrypted.ciphertext, token_iv: encrypted.iv, token_auth_tag: encrypted.tag, updated_at: new Date().toISOString() }).eq('owner_id', ownerId);
        if (error) throw new HttpError(503, 'GOOGLE_DRIVE_STORAGE_UNAVAILABLE', 'Google Drive token storage could not be updated securely. Retry or reconnect Google Drive.');
      }
      accessTokens.set(ownerId, { token: tokenBody.access_token, expiresAt: Date.now() + tokenBody.expires_in * 1000 });
      return tokenBody.access_token;
    })();
    inFlightTokenRefresh.set(ownerId, refresh);
    try { return await refresh; } finally { inFlightTokenRefresh.delete(ownerId); }
  }

  async function fetchPdf(ownerId: string, fileId: string): Promise<{ bytes: Buffer; filename: string }> {
    const accessToken = await getAccessToken(ownerId);
    const fileUrl = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}`);
    fileUrl.searchParams.set('fields', 'id,name,mimeType,size,trashed,capabilities(canDownload)');
    let metadataResponse: globalThis.Response;
    try { metadataResponse = await fetcher(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) }); }
    catch { throw new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google Drive could not be reached. Retry this resume.'); }
    if (!metadataResponse.ok) throw await mapProviderError(metadataResponse);
    const metadata = await metadataResponse.json().catch(() => null) as { id?: unknown; name?: unknown; mimeType?: unknown; size?: unknown; trashed?: unknown; capabilities?: { canDownload?: unknown } } | null;
    if (!metadata || metadata.id !== fileId) throw new HttpError(502, 'GOOGLE_DRIVE_INVALID_METADATA', 'Google Drive returned invalid file metadata.');
    if (metadata.trashed === true) throw new HttpError(404, 'GOOGLE_DRIVE_FILE_NOT_FOUND', 'This Google Drive resume was deleted.');
    if (metadata.mimeType !== 'application/pdf') throw new HttpError(415, 'GOOGLE_DRIVE_UNSUPPORTED_FILE', 'This Google Drive item is not a PDF. Upload a PDF resume.');
    const size = typeof metadata.size === 'string' && /^\d+$/.test(metadata.size) ? Number(metadata.size) : NaN;
    if (!Number.isSafeInteger(size) || size < 1) throw new HttpError(422, 'GOOGLE_DRIVE_INVALID_SIZE', 'Google Drive did not return a valid resume size.');
    if (size > MAX_RESUME_BYTES) throw new HttpError(413, 'GOOGLE_DRIVE_FILE_TOO_LARGE', 'This resume exceeds DevRank’s 10 MB upload limit.');
    if (metadata.capabilities?.canDownload === false) throw new HttpError(403, 'GOOGLE_DRIVE_FILE_INACCESSIBLE', 'The authorized Google account cannot download this resume.');
    const downloadUrl = new URL(`${DRIVE_API}/${encodeURIComponent(fileId)}`);
    downloadUrl.searchParams.set('alt', 'media');
    let fileResponse: globalThis.Response;
    try { fileResponse = await fetcher(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }); }
    catch { throw new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google Drive could not download this resume. Retry it.'); }
    if (!fileResponse.ok) throw await mapProviderError(fileResponse);
    const bytes = await readLimited(fileResponse, MAX_RESUME_BYTES);
    if (bytes.length !== size) throw new HttpError(502, 'GOOGLE_DRIVE_INCOMPLETE_FILE', 'Google Drive returned an incomplete resume file. Retry the download.');
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new HttpError(415, 'GOOGLE_DRIVE_INVALID_PDF', 'The downloaded file does not contain valid PDF data.');
    const rawName = typeof metadata.name === 'string' ? metadata.name : 'resume.pdf';
    const baseName = rawName.replace(/[\r\n"\\/]/g, '_').replace(/\.[^.]*$/, '').slice(0, 180).trim() || 'resume';
    return { bytes, filename: `${baseName}.pdf` };
  }

  const status = asyncHandler(async (request, response) => {
    const ownerId = request.auth!.userId;
    if (!configurationReady(config)) { response.json({ configured: false, connected: false }); return; }
    const connection = await connectionFor(ownerId);
    response.json({ configured: configurationReady(config), connected: Boolean(connection) });
  });

  const connect = asyncHandler(async (request, response) => {
    requireConfiguration(config);
    const ownerId = request.auth!.userId;
    const webOrigin = webOriginFromRequest(request, config);
    const state = signOAuthState({ userId: ownerId, webOrigin, expiresAt: Math.floor(Date.now() / 1000) + 600, nonce: randomBytes(16).toString('hex') }, config.GOOGLE_DRIVE_STATE_SECRET!);
    const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorization.search = new URLSearchParams({ client_id: config.GOOGLE_DRIVE_CLIENT_ID!, redirect_uri: config.GOOGLE_DRIVE_REDIRECT_URI!, response_type: 'code', scope: DRIVE_READ_SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state }).toString();
    response.json({ authorizationUrl: authorization.toString() });
  });

  const callback = asyncHandler(async (request, response) => {
    const rawState = typeof request.query.state === 'string' ? request.query.state : '';
    const state = config.GOOGLE_DRIVE_STATE_SECRET ? verifyOAuthState(rawState, config.GOOGLE_DRIVE_STATE_SECRET) : null;
    if (!state) { response.redirect(303, safeCallbackUrl(config.WEB_ORIGIN, 'invalid_state')); return; }
    if (typeof request.query.error === 'string' || typeof request.query.code !== 'string') {
      response.redirect(303, safeCallbackUrl(state.webOrigin, 'authorization_denied')); return;
    }
    try {
      requireConfiguration(config);
      const tokenResponse = await fetcher(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: request.query.code, client_id: config.GOOGLE_DRIVE_CLIENT_ID!, client_secret: config.GOOGLE_DRIVE_CLIENT_SECRET!, redirect_uri: config.GOOGLE_DRIVE_REDIRECT_URI!, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15_000) });
      const tokenBody = await tokenResponse.json().catch(() => ({})) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; error?: unknown };
      if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') throw new Error('oauth_exchange_failed');
      const existing = await connectionFor(state.userId);
      const refreshToken = typeof tokenBody.refresh_token === 'string' ? tokenBody.refresh_token : existing ? decryptRefreshToken({ ciphertext: existing.encrypted_refresh_token, iv: existing.token_iv, tag: existing.token_auth_tag }, config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY!) : null;
      if (!refreshToken) throw new Error('offline_access_missing');
      if (typeof tokenBody.scope === 'string' && !tokenBody.scope.split(' ').includes(DRIVE_READ_SCOPE)) throw new Error('drive_scope_missing');
      const encrypted = encryptRefreshToken(refreshToken, config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY!);
      const { error } = await serviceClientFactory().from('google_drive_connections').upsert({ owner_id: state.userId, encrypted_refresh_token: encrypted.ciphertext, token_iv: encrypted.iv, token_auth_tag: encrypted.tag, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
      if (error) throw new Error('secure_store_failed');
      accessTokens.set(state.userId, { token: tokenBody.access_token, expiresAt: Date.now() + (typeof tokenBody.expires_in === 'number' ? tokenBody.expires_in : 3300) * 1000 });
      response.redirect(303, safeCallbackUrl(state.webOrigin, 'connected'));
    } catch {
      response.redirect(303, safeCallbackUrl(state.webOrigin, 'connection_failed'));
    }
  });

  const disconnect = asyncHandler(async (request, response) => {
    const ownerId = request.auth!.userId;
    const connection = await connectionFor(ownerId);
    if (connection && config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY) {
      try {
        const token = decryptRefreshToken({ ciphertext: connection.encrypted_refresh_token, iv: connection.token_iv, tag: connection.token_auth_tag }, config.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY);
        await fetcher('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(5000) }).catch(() => undefined);
      } catch { /* Local disconnection still removes encrypted credentials. */ }
    }
    await clearConnection(ownerId);
    response.status(204).end();
  });

  const screen = asyncHandler(async (request, response) => {
    requireConfiguration(config);
    if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in before screening Google Drive resumes.');
    const parsed = googleDriveResumeScreenRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_GOOGLE_DRIVE_SCREEN_REQUEST', 'Provide a job title, a job description of at least 50 characters, and up to 20 unique candidate Drive resumes.');
    const directory = await mkdtemp(join(tmpdir(), 'devrank-drive-resumes-'));
    const results: Array<GoogleDriveResumeScreenResponse['results'][number] | undefined> = Array(parsed.data.resumes.length).fill(undefined);
    const accepted: Array<{ index: number; candidateId: string; fileId: string; file: Express.Multer.File }> = [];
    let screenResult: GoogleDriveResumeScreenResponse;
    try {
      for (const [index, resume] of parsed.data.resumes.entries()) {
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(resume.fileId)) {
          results[index] = { ...resume, status: 'failed', code: 'INVALID_GOOGLE_DRIVE_FILE_ID', message: 'The resume link does not contain a valid Google Drive file ID.' };
          continue;
        }
        try {
          const file = await fetchPdf(request.auth!.userId, resume.fileId);
          const filePath = join(directory, randomUUID());
          await writeFile(filePath, file.bytes, { flag: 'wx', mode: 0o600 });
          accepted.push({ index, ...resume, file: {
            fieldname: 'resumes', originalname: file.filename, encoding: '7bit', mimetype: 'application/pdf',
            destination: directory, filename: filePath.slice(directory.length + 1), path: filePath, size: file.bytes.length, buffer: Buffer.alloc(0), stream: undefined as never,
          } as Express.Multer.File });
        } catch (cause) {
          const failure = cause instanceof HttpError ? cause : new HttpError(503, 'GOOGLE_DRIVE_UNAVAILABLE', 'Google Drive could not retrieve this resume. Retry it shortly.');
          results[index] = { ...resume, status: 'failed', code: failure.code, message: failure.message };
        }
      }
      if (accepted.length) {
        const body = { jobTitle: parsed.data.jobTitle, jobDescription: parsed.data.jobDescription, candidateIds: accepted.map(({ candidateId }) => candidateId) };
        const screeningRequest = { auth: request.auth, body, files: accepted.map(({ file }) => file), get: (name: string) => request.get(name) } as unknown as Request;
        const screeningResult = await new Promise<unknown>((resolve, reject) => {
          let statusCode = 200;
          const screeningResponse = {
            status: (value: number) => { statusCode = value; return screeningResponse; },
            json: (value: unknown) => resolve({ statusCode, body: value }),
          };
          screeningSubmit(screeningRequest, screeningResponse as unknown as Response, ((error?: unknown) => error ? reject(error) : undefined) as NextFunction);
        });
        const parsedResult = screeningSubmissionResponseSchema.safeParse((screeningResult as { body?: unknown }).body);
        if (!parsedResult.success || parsedResult.data.resumes.length !== accepted.length) throw new HttpError(502, 'SCREENING_INVALID_RESPONSE', 'The existing screening service returned an incomplete result.');
        parsedResult.data.resumes.forEach((item, acceptedIndex) => {
          const source = accepted[acceptedIndex]!;
          results[source.index] = {
            candidateId: source.candidateId, fileId: source.fileId, status: item.status === 'failed' ? 'failed' : 'queued',
            sessionId: parsedResult.data.sessionId, resumeId: item.id,
            ...(item.status === 'failed' ? { code: 'RESUME_SCREENING_UPLOAD_FAILED', message: 'The existing screening service could not accept this resume.' } : {}),
          };
        });
      }
      screenResult = googleDriveResumeScreenResponseSchema.parse({ results });
    } finally { await rm(directory, { recursive: true, force: true }); }
    response.json(screenResult);
  });

  return { status, connect, callback, disconnect, screen };
}

export const googleDriveController = createGoogleDriveController();
