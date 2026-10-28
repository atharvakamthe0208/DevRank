import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createScreeningController } from '../src/controllers/screening-controller.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const sessionId = '146ec40d-88c1-4575-8c08-e28601b26b4d';
const resumeId = 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d';
const auth = { userId: ownerId, email: 'recruiter@example.test', emailConfirmed: true, accessToken: 'jwt', profile: { id: ownerId, display_name: null, role: 'recruiter' as const, approval_status: 'approved' as const } };

describe('screening resume retry lifecycle', () => {
  it('requeues a persisted retryable failure and returns the same session/resume association', async () => {
    const sessionUpdate = { eq: vi.fn().mockResolvedValue({ error: null }) };
    const sessionQuery = {
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: sessionId, job_title: 'Engineer', status: 'partial' }, error: null }) }) }),
      update: vi.fn(() => sessionUpdate),
    };
    sessionUpdate.eq.mockReturnValue(sessionUpdate as never);
    (sessionUpdate as unknown as { then: (resolve: (value: { error: null }) => unknown) => Promise<unknown> }).then = (resolve) => Promise.resolve({ error: null }).then(resolve);
    const resumeQuery = {
      select: () => ({ eq: () => ({ order: async () => ({ data: [{
        id: resumeId, candidate_id: null, original_filename: 'resume.pdf', status: 'failed', extracted_data: null,
        evaluation: null, preliminary_evaluation: null, safe_error_code: 'SCREENING_AI_UNAVAILABLE',
        retry_count: 0, safe_error_message: 'Evaluation provider is temporarily unavailable.',
      }], error: null }) }) }),
    };
    const client = { from: (table: string) => table === 'screening_sessions' ? sessionQuery : resumeQuery };
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const controller = createScreeningController(() => client as never, undefined, (() => ({ rpc })) as never);
    let resolveResponse!: (value: unknown) => void;
    let rejectResponse!: (value: unknown) => void;
    const completed = new Promise<unknown>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const response = { json: vi.fn((value: unknown) => resolveResponse(value)) } as unknown as Response;
    const errorHandler = ((error?: unknown) => rejectResponse(error)) as NextFunction;

    controller.retry({ auth, params: { id: sessionId, resumeId } } as unknown as Request, response, errorHandler);

    await expect(completed).resolves.toEqual({ resumeId, status: 'queued' });
    expect(rpc).toHaveBeenCalledWith('retry_screening_job', { p_resume_id: resumeId });
  });

  it('does not claim queued success when the retry RPC reports no queued job', async () => {
    const sessionQuery = {
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: sessionId, job_title: 'Engineer', status: 'partial' }, error: null }) }) }),
    };
    const resumeQuery = {
      select: () => ({ eq: () => ({ order: async () => ({ data: [{
        id: resumeId, candidate_id: null, original_filename: 'resume.pdf', status: 'failed', extracted_data: null,
        evaluation: null, preliminary_evaluation: null, safe_error_code: 'SCREENING_AI_UNAVAILABLE', retry_count: 1,
        safe_error_message: 'Evaluation provider is temporarily unavailable.',
      }], error: null }) }) }),
    };
    const client = { from: (table: string) => table === 'screening_sessions' ? sessionQuery : resumeQuery };
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const controller = createScreeningController(() => client as never, undefined, (() => ({ rpc })) as never);
    let rejectResponse!: (value: unknown) => void;
    const completed = new Promise<never>((_resolve, reject) => { rejectResponse = reject; });
    controller.retry({ auth, params: { id: sessionId, resumeId } } as unknown as Request, {} as Response, ((error?: unknown) => rejectResponse(error)) as NextFunction);

    await expect(completed).rejects.toMatchObject({ code: 'SCREENING_RETRY_LIMIT_REACHED', statusCode: 409 });
  });
});
