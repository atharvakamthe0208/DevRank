import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createScreeningController, screeningDatabaseError } from '../src/controllers/screening-controller.js';
import type { ScreeningProcessor } from '../src/modules/screening/processor.js';

const approved = { userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', email: 'r@example.com', emailConfirmed: true, accessToken: 'jwt', profile: { id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', display_name: null, role: 'recruiter' as const, approval_status: 'approved' as const } };
const processor = { requirements: vi.fn(), assess: vi.fn() } as unknown as ScreeningProcessor;
const clientFactory = vi.fn(() => { throw new Error('Database must not be reached for invalid input'); }) as never;
const handler = createScreeningController(clientFactory, processor).submit;

async function getError(overrides: Partial<Request> = {}) {
  const request = { auth: approved, body: { jobTitle: 'Engineer', jobDescription: 'A sufficiently descriptive role for engineering production services and teams.' }, files: [], ...overrides } as Request;
  const response = {} as Response;
  return new Promise<unknown>((resolve) => handler(request, response, ((error?: unknown) => resolve(error)) as NextFunction));
}

describe('resume screening request validation', () => {
  it('returns the persisted candidate ID with screening details for safe assessment refresh', async () => {
    const sessionQuery = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { id: 'c3a5f5f0-fd65-4c13-9378-5a4377dcd1e2', job_title: 'Software Developer', status: 'completed' }, error: null })) };
    sessionQuery.select.mockReturnValue(sessionQuery); sessionQuery.eq.mockReturnValue(sessionQuery);
    const resumeQuery = { select: vi.fn(), eq: vi.fn(), order: vi.fn(async () => ({ data: [{ id: 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2', candidate_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', original_filename: 'candidate.pdf', status: 'completed', extracted_data: null, evaluation: null, preliminary_evaluation: null, safe_error_code: null, retry_count: 0, safe_error_message: null }], error: null })) };
    resumeQuery.select.mockReturnValue(resumeQuery); resumeQuery.eq.mockReturnValue(resumeQuery);
    const client = { from: vi.fn((table: string) => table === 'screening_sessions' ? sessionQuery : resumeQuery) };
    const controller = createScreeningController(vi.fn(() => client) as never, processor);
    const response = { json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;
    controller.get({ auth: approved, params: { id: 'c3a5f5f0-fd65-4c13-9378-5a4377dcd1e2' } } as unknown as Request, response, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    expect(resumeQuery.select).toHaveBeenCalledWith('id,candidate_id,original_filename,status,extracted_data,evaluation,preliminary_evaluation,safe_error_code,retry_count,safe_error_message');
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ resumes: [expect.objectContaining({ candidateId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })] }));
  });

  it('maps missing-table, outdated-column, and RLS failures to actionable safe errors', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(screeningDatabaseError('session_insert', { code: 'PGRST205', message: "Could not find the table 'public.screening_sessions' in the schema cache" }))
      .toMatchObject({ code: 'SCREENING_SCHEMA_MISSING', statusCode: 503 });
    expect(screeningDatabaseError('resume_insert', { code: 'PGRST204', message: 'Column missing' }))
      .toMatchObject({ code: 'SCREENING_SCHEMA_OUTDATED', statusCode: 503 });
    expect(screeningDatabaseError('session_insert', { code: '42501', message: 'RLS denied' }))
      .toMatchObject({ code: 'SCREENING_PERMISSION_DENIED', statusCode: 403 });
    expect(log).toHaveBeenCalledTimes(3);
    log.mockRestore();
  });

  it('rejects a missing job title or description before database access', async () => {
    expect(await getError({ body: { jobDescription: 'A sufficiently descriptive role for engineering production services and teams.' } })).toMatchObject({ code: 'INVALID_SCREENING_REQUEST', statusCode: 400 });
    expect(await getError({ body: { jobTitle: 'Engineer' } })).toMatchObject({ code: 'INVALID_SCREENING_REQUEST', statusCode: 400 });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects empty, excessive, and oversized resume batches', async () => {
    expect(await getError()).toMatchObject({ code: 'RESUMES_REQUIRED', statusCode: 400 });
    const files = Array.from({ length: 21 }, () => ({ size: 100, mimetype: 'application/pdf' }));
    expect(await getError({ files } as Partial<Request>)).toMatchObject({ code: 'TOO_MANY_RESUMES', statusCode: 400 });
    expect(await getError({ files: [{ size: 10 * 1024 * 1024 + 1, mimetype: 'application/pdf' }] } as Partial<Request>)).toMatchObject({ code: 'INVALID_RESUME_SIZE', statusCode: 413 });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects requests without the authenticated recruiter context', async () => {
    expect(await getError({ auth: undefined } as Partial<Request>)).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('rejects candidate mappings that do not match the uploaded resume count', async () => {
    const files = [{ size: 120, mimetype: 'application/pdf' }];
    expect(await getError({ files, body: { jobTitle: 'Engineer', jobDescription: 'A sufficiently descriptive role for engineering production services and teams.', candidateIds: '["e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2","c3a5f5f0-fd65-4c13-9378-5a4377dcd1e2"]' } } as Partial<Request>))
      .toMatchObject({ code: 'INVALID_SCREENING_CANDIDATES', statusCode: 400 });
  });

  it('rejects duplicate candidate mappings and mappings that contain no candidate ID', async () => {
    const files = [{ size: 120, mimetype: 'application/pdf' }, { size: 120, mimetype: 'application/pdf' }];
    const duplicate = await getError({ files, body: { jobTitle: 'Engineer', jobDescription: 'A sufficiently descriptive role for engineering production services and teams.', candidateIds: ['e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2', 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2'] } } as Partial<Request>);
    expect(duplicate).toMatchObject({ code: 'INVALID_SCREENING_REQUEST', statusCode: 400 });
    const empty = await getError({ files, body: { jobTitle: 'Engineer', jobDescription: 'A sufficiently descriptive role for engineering production services and teams.', candidateIds: [null, null] } } as Partial<Request>);
    expect(empty).toMatchObject({ code: 'INVALID_SCREENING_REQUEST', statusCode: 400 });
  });

  it('rejects screening associations to candidates outside the authenticated recruiter workspace', async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.is.mockReturnValue(chain);
    chain.in.mockResolvedValue({ data: [], error: null });
    const ownerClient = { from: vi.fn(() => chain) };
    const ownerClientFactory = vi.fn(() => ownerClient) as never;
    const controller = createScreeningController(ownerClientFactory, processor);
    const request = { auth: approved, body: { jobTitle: 'Engineer', jobDescription: 'A sufficiently descriptive role for engineering production services and teams.', candidateIds: ['e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2'] }, files: [{ size: 120, mimetype: 'application/pdf' }] } as unknown as Request;
    const error = await new Promise<unknown>((resolve) => controller.submit(request, {} as Response, ((cause?: unknown) => resolve(cause)) as NextFunction));
    expect(error).toMatchObject({ code: 'SCREENING_CANDIDATE_NOT_FOUND', statusCode: 404 });
    expect(chain.in).toHaveBeenCalledWith('id', ['e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2']);
  });
});

