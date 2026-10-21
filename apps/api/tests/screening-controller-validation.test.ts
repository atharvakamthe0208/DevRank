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
});

