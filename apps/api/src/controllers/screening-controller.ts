import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Request } from 'express';
import { screeningComparisonRequestSchema, screeningComparisonResponseSchema, screeningCreateSchema, screeningDetailsResponseSchema, screeningRankingResponseSchema, screeningReportResponseSchema, screeningRetryableErrorCodes, screeningRetryResponseSchema, screeningSubmissionResponseSchema } from '@devrank/contracts';
import { getSupabaseClient, getSupabaseServiceClient } from '../config/supabase.js';
import { HttpError } from '../middleware/http-error.js';
import { createScreeningProcessor, extractResumeText, type ScreeningProcessor } from '../modules/screening/processor.js';
import { asyncHandler } from '../utils/async-handler.js';

type ScreeningFile = Express.Multer.File;
type DatabaseClient = ReturnType<typeof getSupabaseClient>;
const MAX_BATCH = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function inputFiles(request: Request): ScreeningFile[] {
  const files = request.files;
  return Array.isArray(files) ? files as ScreeningFile[] : [];
}

function safeFilename(name: string) {
  const clean = basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255);
  return clean || 'resume';
}

export function screeningDatabaseError(operation: string, error: unknown): HttpError {
  const detail = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; hint?: unknown; status?: unknown } : {};
  console.error('Resume screening database operation failed', {
    operation,
    ...(typeof detail.code === 'string' ? { code: detail.code.slice(0, 32) } : {}),
    ...(typeof detail.status === 'number' ? { status: detail.status } : {}),
    ...(typeof detail.message === 'string' ? { message: detail.message.slice(0, 240) } : {}),
    ...(typeof detail.hint === 'string' ? { hint: detail.hint.slice(0, 160) } : {}),
  });
  if (detail.code === '42501' || detail.code === 'PGRST301') {
    return new HttpError(403, 'SCREENING_PERMISSION_DENIED', 'The database denied screening access. Confirm recruiter approval and the screening row-level security policies.');
  }
  if (detail.code === '42P01' || detail.code === 'PGRST205') {
    return new HttpError(503, 'SCREENING_SCHEMA_MISSING', 'Resume screening tables are missing. Apply the latest DevRank resume screening migration, then retry.');
  }
  if (detail.code === '42703' || detail.code === 'PGRST204') {
    return new HttpError(503, 'SCREENING_SCHEMA_OUTDATED', 'The resume screening database schema is incomplete. Apply the latest DevRank resume screening migration, then retry.');
  }
  return new HttpError(503, 'SCREENING_DATABASE_ERROR', 'The screening record could not be saved. Check the database migration and try again.');
}

const rankingCriteria = 'Descending deterministic resume job-match score from the saved screening evaluation. Equal scores share a rank. Unscored and failed resumes are not ranked. Ranking supports recruiter review and is not a hiring decision.';

function buildScreeningRanking(details: ReturnType<typeof screeningDetailsResponseSchema.parse>) {
  const rankedCandidates = details.resumes.filter((resume) => resume.status === 'completed' && resume.evaluation?.score !== undefined)
    .sort((a, b) => b.evaluation!.score! - a.evaluation!.score! || a.filename.localeCompare(b.filename));
  let rank = 0;
  let previousScore: number | undefined;
  const ranked = rankedCandidates.map((resume, index) => {
    const score = resume.evaluation!.score!;
    if (score !== previousScore) rank = index + 1;
    previousScore = score;
    return { resumeId: resume.id, rank, score };
  });
  const rankedIds = new Set(ranked.map((item) => item.resumeId));
  const unranked = details.resumes.filter((resume) => !rankedIds.has(resume.id)).map((resume) => ({
    resumeId: resume.id, filename: resume.filename, status: resume.status,
    reason: resume.status !== 'completed' ? (resume.error ?? 'Processing did not complete.')
      : resume.preliminaryEvaluation ? 'A preliminary document match is available but is not included in validated ranking.'
        : 'No deterministic overall score is available.',
  }));
  return { ranked, unranked, rankingCriteria };
}

function assertFile(file: ScreeningFile, buffer: Buffer) {
  if (!file.size || file.size > MAX_FILE_SIZE) throw new HttpError(413, 'INVALID_RESUME_SIZE', 'Each resume must be between 1 byte and 10 MB.');
  if (!['application/pdf', DOCX].includes(file.mimetype)) throw new HttpError(415, 'UNSUPPORTED_RESUME_TYPE', 'Only PDF and DOCX resumes are supported.');
  if (file.mimetype === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new HttpError(415, 'INVALID_PDF', 'A selected PDF file has invalid file contents.');
  if (file.mimetype === DOCX && buffer.subarray(0, 2).toString('ascii') !== 'PK') throw new HttpError(415, 'INVALID_DOCX', 'A selected DOCX file has invalid file contents.');
}

export function createScreeningController(
  clientForToken: typeof getSupabaseClient = getSupabaseClient,
  processor: ScreeningProcessor = createScreeningProcessor(),
  serviceClientFactory: typeof getSupabaseServiceClient = getSupabaseServiceClient,
) {
  async function loadDetails(auth: NonNullable<Request['auth']>, sessionId: string) {
    const client: DatabaseClient = clientForToken(auth.accessToken);
    const session = await client.from('screening_sessions').select('id,job_title,status').eq('id', sessionId).single();
    if (session.error || !session.data) {
      if (session.error?.code === 'PGRST116') throw new HttpError(404, 'SCREENING_NOT_FOUND', 'Screening session not found.');
      throw screeningDatabaseError('session_read', session.error);
    }
    const resumes = await client.from('resume_screenings').select('id,original_filename,status,extracted_data,evaluation,preliminary_evaluation,safe_error_code,retry_count,safe_error_message').eq('session_id', sessionId).order('created_at');
    if (resumes.error) throw screeningDatabaseError('resume_read', resumes.error);
    return screeningDetailsResponseSchema.parse({
      sessionId, jobTitle: session.data.job_title, status: session.data.status,
      resumes: (resumes.data ?? []).map((row) => ({
        id: row.id, filename: row.original_filename, status: row.status,
        candidate: row.extracted_data && typeof row.extracted_data === 'object' && 'candidate' in row.extracted_data ? row.extracted_data.candidate : null,
        evaluation: row.evaluation, preliminaryEvaluation: row.preliminary_evaluation ?? null,
        ...(row.safe_error_code ? { errorCode: row.safe_error_code } : {}),
        ...(typeof row.retry_count === 'number' ? { retryCount: row.retry_count } : {}),
        ...(row.safe_error_message ? { error: row.safe_error_message } : {}),
      })),
    });
  }

  function selectedCompleted(details: ReturnType<typeof screeningDetailsResponseSchema.parse>, ids: string[]) {
    const found = new Map(details.resumes.map((resume) => [resume.id, resume]));
    const selected = ids.map((id) => found.get(id));
    if (selected.some((resume) => !resume)) throw new HttpError(404, 'SCREENING_RESUME_NOT_FOUND', 'One or more selected resumes do not belong to this screening.');
    if (selected.some((resume) => resume!.status !== 'completed')) throw new HttpError(400, 'SCREENING_RESUME_NOT_COMPLETED', 'Only successfully processed resumes can be compared.');
    return selected as typeof details.resumes;
  }

  return {
    submit: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in before submitting resumes.');
      const parsed = screeningCreateSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_SCREENING_REQUEST', 'Enter a job title and a job description between 50 and 30,000 characters.');
      const files = inputFiles(request);
      if (!files.length) throw new HttpError(400, 'RESUMES_REQUIRED', 'Select at least one PDF or DOCX resume.');
      if (files.length > MAX_BATCH) throw new HttpError(400, 'TOO_MANY_RESUMES', `A screening session can include at most ${MAX_BATCH} resumes.`);
      if (files.some(({ size }) => !size || size > MAX_FILE_SIZE)) throw new HttpError(413, 'INVALID_RESUME_SIZE', 'Each resume must be between 1 byte and 10 MB.');

      const client = clientForToken(auth.accessToken);
      const queueClient = serviceClientFactory();
      const idempotencyKey = request.get('Idempotency-Key');
      if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
        throw new HttpError(400, 'SCREENING_IDEMPOTENCY_KEY_REQUIRED', 'Retry-safe resume submission requires an Idempotency-Key UUID.');
      }

      const existingSession = await client.from('screening_sessions').select('id,status')
        .eq('owner_id', auth.userId).eq('idempotency_key', idempotencyKey).maybeSingle();
      if (existingSession.error) throw screeningDatabaseError('idempotency_lookup', existingSession.error);
      if (existingSession.data) {
        const existingResumes = await client.from('resume_screenings').select('id,original_filename,status')
          .eq('session_id', existingSession.data.id).order('created_at');
        if (existingResumes.error) throw screeningDatabaseError('idempotency_resume_lookup', existingResumes.error);
        response.status(200).json(screeningSubmissionResponseSchema.parse({
          sessionId: existingSession.data.id, status: existingSession.data.status,
          resumes: (existingResumes.data ?? []).map((row) => ({ id: row.id, filename: row.original_filename, status: row.status })),
        }));
        return;
      }

      const fileHashes = new Set<string>();
      for (const file of files) {
        try {
          const bytes = await readFile(file.path);
          const hash = createHash('sha256').update(bytes).digest('hex');
          if (fileHashes.has(hash)) throw new HttpError(400, 'DUPLICATE_RESUME_FILE', 'The upload contains the same resume file more than once. Remove duplicates and submit again.');
          fileHashes.add(hash);
        } catch (cause) {
          if (cause instanceof HttpError) throw cause;
          // The individual failed temp-file read is recorded during the processing loop below.
        }
      }
      const requirements = await processor.requirements(parsed.data.jobTitle, parsed.data.jobDescription);
      const sessionResult = await client.from('screening_sessions').insert({
        owner_id: auth.userId, job_title: parsed.data.jobTitle, job_description: parsed.data.jobDescription,
        normalized_requirements: requirements, rubric_version: 'resume-job-match-1.0.0', status: 'processing', idempotency_key: idempotencyKey,
      }).select('id').single();
      if (sessionResult.error || !sessionResult.data) {
        if (sessionResult.error?.code === '23505') {
          const prior = await client.from('screening_sessions').select('id,status').eq('owner_id', auth.userId).eq('idempotency_key', idempotencyKey).maybeSingle();
          if (prior.data && !prior.error) {
            const priorResumes = await client.from('resume_screenings').select('id,original_filename,status').eq('session_id', prior.data.id).order('created_at');
            if (priorResumes.error) throw screeningDatabaseError('idempotency_resume_lookup', priorResumes.error);
            response.status(200).json(screeningSubmissionResponseSchema.parse({
              sessionId: prior.data.id, status: prior.data.status,
              resumes: (priorResumes.data ?? []).map((row) => ({ id: row.id, filename: row.original_filename, status: row.status })),
            }));
            return;
          }
        }
        throw screeningDatabaseError('session_insert', sessionResult.error);
      }
      const sessionId = sessionResult.data.id as string;
      const results: Array<{ id: string; filename: string; status: 'queued' | 'failed' }> = [];
      const queued: Array<{ resume_id: string; owner_id: string; attempt: number }> = [];

      for (const file of files) {
        const id = randomUUID();
        const filename = safeFilename(file.originalname);
        const storagePath = `${auth.userId}/${sessionId}/${id}`;
        const databaseMimeType = ['application/pdf', DOCX].includes(file.mimetype) ? file.mimetype : 'application/octet-stream';
        let buffer: Buffer | undefined;
        let hash: string | undefined;
        let rowCreated = false;
        let storedFile = false;
        try {
          buffer = await readFile(file.path);
          hash = createHash('sha256').update(buffer).digest('hex');
          assertFile(file, buffer);
          const uploaded = await client.storage.from('private-resumes').upload(storagePath, buffer, { contentType: file.mimetype, upsert: false });
          if (uploaded.error) throw new HttpError(503, 'PRIVATE_UPLOAD_FAILED', 'Private resume storage is unavailable. Confirm the private-resumes bucket and Storage RLS policy are installed.');
          storedFile = true;
          const inserted = await client.from('resume_screenings').insert({
            id, session_id: sessionId, owner_id: auth.userId, storage_path: storagePath,
            original_filename: filename, mime_type: databaseMimeType, file_size: file.size, sha256: hash, status: 'queued',
          });
          if (inserted.error) {
            throw screeningDatabaseError('resume_insert', inserted.error);
          }
          rowCreated = true;
          queued.push({ resume_id: id, owner_id: auth.userId, attempt: 0 });
          results.push({ id, filename, status: 'queued' });
        } catch (cause) {
          const failure = cause instanceof HttpError ? cause : new HttpError(422, 'RESUME_PROCESSING_FAILED', 'This resume could not be extracted or evaluated.');
          if (failure.statusCode >= 500) console.warn('Resume upload failed; continuing batch', { code: failure.code });
          if (storedFile && !rowCreated) await client.storage.from('private-resumes').remove([storagePath]);
          if (!rowCreated) {
            const failedRow = await client.from('resume_screenings').insert({
              id, session_id: sessionId, owner_id: auth.userId, storage_path: storagePath,
              original_filename: filename, mime_type: databaseMimeType, file_size: file.size, sha256: hash ?? null,
              status: 'failed', safe_error_code: failure.code, safe_error_message: failure.message, processed_at: new Date().toISOString(),
            });
            if (failedRow.error) console.error('Resume failure status could not be persisted', { code: failedRow.error.code ?? 'database_error' });
          }
          results.push({ id, filename, status: 'failed' });
        }
      }
      if (queued.length) {
        const queuedRows = await queueClient.from('screening_jobs').insert(queued);
        if (queuedRows.error) {
          const message = 'The evaluation queue could not accept this resume. Retry this screening.';
          console.error('Resume screening queue insert failed', { code: queuedRows.error.code ?? 'database_error' });
          for (const item of queued) {
            await client.from('resume_screenings').update({ status: 'failed', safe_error_code: 'SCREENING_QUEUE_UNAVAILABLE', safe_error_message: message, processed_at: new Date().toISOString() }).eq('id', item.resume_id).eq('owner_id', auth.userId);
          }
          for (let index = 0; index < results.length; index++) {
            if (queued.some((item) => item.resume_id === results[index].id)) results[index].status = 'failed';
          }
          queued.length = 0;
        }
      }
      const sessionStatus = queued.length ? 'processing' : 'failed';
      const updated = await client.from('screening_sessions').update({ status: sessionStatus, updated_at: new Date().toISOString() }).eq('id', sessionId).eq('owner_id', auth.userId);
      if (updated.error) throw screeningDatabaseError('session_update', updated.error);
      response.status(201).json(screeningSubmissionResponseSchema.parse({
        sessionId, status: sessionStatus,
        resumes: results,
      }));
    }),
    get: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to view screening results.');
      const rawSessionId = request.params.id;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new HttpError(400, 'INVALID_SCREENING_ID', 'The screening ID is invalid.');
      response.json(await loadDetails(auth, sessionId));
    }),
    ranking: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to view screening rankings.');
      const rawSessionId = request.params.id;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new HttpError(400, 'INVALID_SCREENING_ID', 'The screening ID is invalid.');
      const details = await loadDetails(auth, sessionId);
      response.json(screeningRankingResponseSchema.parse({ sessionId, jobTitle: details.jobTitle, ranking: buildScreeningRanking(details) }));
    }),
    retry: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to retry a resume evaluation.');
      const rawSessionId = request.params.id;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      const rawResumeId = request.params.resumeId;
      const resumeId = Array.isArray(rawResumeId) ? rawResumeId[0] : rawResumeId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resumeId)) {
        throw new HttpError(400, 'INVALID_SCREENING_ID', 'The screening or resume ID is invalid.');
      }
      const details = await loadDetails(auth, sessionId);
      const resume = details.resumes.find((item) => item.id === resumeId);
      if (!resume) throw new HttpError(404, 'SCREENING_RESUME_NOT_FOUND', 'Resume not found in this screening.');
      if (resume.status !== 'failed') throw new HttpError(409, 'SCREENING_RESUME_NOT_FAILED', 'Only failed resumes can be retried.');
      if (!resume.errorCode || !screeningRetryableErrorCodes.includes(resume.errorCode as typeof screeningRetryableErrorCodes[number])) {
        throw new HttpError(409, 'SCREENING_RESUME_NOT_RETRYABLE', 'This resume failure is not transient. Fix the file or configuration before uploading it again.');
      }
      if ((resume.retryCount ?? 0) >= 3) throw new HttpError(409, 'SCREENING_RETRY_LIMIT_REACHED', 'This resume has reached its retry limit.');
      const result = await serviceClientFactory().rpc('retry_screening_job', { p_resume_id: resumeId });
      if (result.error) throw screeningDatabaseError('screening_retry_enqueue', result.error);
      if (result.data !== true) throw new HttpError(409, 'SCREENING_RETRY_LIMIT_REACHED', 'This resume has reached its retry limit or is already queued.');
      const update = await clientForToken(auth.accessToken).from('screening_sessions').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', sessionId).eq('owner_id', auth.userId);
      if (update.error) throw screeningDatabaseError('screening_retry_session_update', update.error);
      response.json(screeningRetryResponseSchema.parse({ resumeId, status: 'queued' }));
    }),
    compare: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to compare screening results.');
      const rawSessionId = request.params.id;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new HttpError(400, 'INVALID_SCREENING_ID', 'The screening ID is invalid.');
      const parsed = screeningComparisonRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_COMPARISON_SELECTION', 'Select at least two different resumes from this screening.');
      const details = await loadDetails(auth, sessionId);
      const candidates = selectedCompleted(details, parsed.data.resumeIds);
      response.json(screeningComparisonResponseSchema.parse({
        sessionId, jobTitle: details.jobTitle, candidates, ranking: buildScreeningRanking(details),
      }));
    }),
    report: asyncHandler(async (request, response) => {
      const auth = request.auth;
      if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to generate a screening report.');
      const rawSessionId = request.params.id;
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) throw new HttpError(400, 'INVALID_SCREENING_ID', 'The screening ID is invalid.');
      const parsed = screeningComparisonRequestSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_REPORT_SELECTION', 'Select at least two different resumes from this screening.');
      const details = await loadDetails(auth, sessionId);
      selectedCompleted(details, parsed.data.resumeIds);
      response.json(screeningReportResponseSchema.parse({ generatedAt: new Date().toISOString(), selectedResumeIds: parsed.data.resumeIds, details, ranking: buildScreeningRanking(details) }));
    }),
  };
}

