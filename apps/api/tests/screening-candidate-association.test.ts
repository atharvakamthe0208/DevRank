import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createScreeningController } from '../src/controllers/screening-controller.js';
import type { ScreeningProcessor } from '../src/modules/screening/processor.js';

const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const sessionId = 'c3a5f5f0-fd65-4c13-9378-5a4377dcd1e2';

describe('screening result candidate association', () => {
  it('blocks a second screening for an already linked candidate and returns an owner-scoped reuse target', async () => {
    const candidateQuery = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn() };
    candidateQuery.select.mockReturnValue(candidateQuery); candidateQuery.eq.mockReturnValue(candidateQuery); candidateQuery.is.mockReturnValue(candidateQuery);
    candidateQuery.in.mockResolvedValue({ data: [{ id: candidateId }], error: null });
    const sessionQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn() };
    sessionQuery.select.mockReturnValue(sessionQuery); sessionQuery.eq.mockReturnValue(sessionQuery);
    sessionQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    sessionQuery.insert.mockImplementation(() => { throw new Error('Duplicate candidate must not create a session'); });
    const resumeQuery = { select: vi.fn(), eq: vi.fn(), in: vi.fn() };
    resumeQuery.select.mockReturnValue(resumeQuery); resumeQuery.eq.mockReturnValue(resumeQuery);
    resumeQuery.in.mockResolvedValue({ data: [{ candidate_id: candidateId }], error: null });
    const client = { from: vi.fn((table: string) => table === 'candidates' ? candidateQuery : table === 'screening_sessions' ? sessionQuery : resumeQuery) };
    const controller = createScreeningController(
      vi.fn(() => client) as never,
      { requirements: vi.fn(), assess: vi.fn() } as unknown as ScreeningProcessor,
      vi.fn(() => ({ from: vi.fn() })) as never,
    );
    const request = {
      auth: { userId: ownerId, email: 'recruiter@example.com', emailConfirmed: true, accessToken: 'jwt', profile: { id: ownerId, display_name: null, role: 'recruiter', approval_status: 'approved' } },
      body: { jobTitle: 'Engineer', jobDescription: 'Build reliable backend services and collaborate on production systems.', candidateIds: JSON.stringify([candidateId]) },
      files: [{ size: 100, mimetype: 'application/pdf', originalname: 'new-resume.pdf' }],
      get: (name: string) => name === 'Idempotency-Key' ? '11111111-1111-4111-8111-111111111111' : undefined,
    } as unknown as Request;
    const error = await new Promise<unknown>((resolve) => controller.submit(request, {} as Response, ((cause?: unknown) => resolve(cause)) as NextFunction));
    expect(error).toMatchObject({
      statusCode: 409, code: 'CANDIDATE_RESUME_ALREADY_LINKED',
      details: { candidateIds: [candidateId] },
    });
    expect(candidateQuery.in).toHaveBeenCalledWith('id', [candidateId]);
    expect(candidateQuery.eq).toHaveBeenCalledWith('owner_id', ownerId);
    expect(candidateQuery.is).toHaveBeenCalledWith('archived_at', null);
    expect(resumeQuery.in).toHaveBeenCalledWith('candidate_id', [candidateId]);
    expect(sessionQuery.insert).not.toHaveBeenCalled();
  });

  it('persists the exact owner-validated candidate ID alongside the uploaded resume', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devrank-association-test-'));
    try {
      const path = join(directory, 'resume.tmp');
      const bytes = Buffer.from('%PDF-1.7 verified resume bytes');
      const unlinkedPath = join(directory, 'unlinked.tmp');
      const unlinkedBytes = Buffer.from('%PDF-1.7 another verified resume');
      await writeFile(path, bytes);
      await writeFile(unlinkedPath, unlinkedBytes);
      const insertedResumeRows: Array<Record<string, unknown>> = [];
      const candidateQuery = {
        select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(),
      };
      candidateQuery.select.mockReturnValue(candidateQuery); candidateQuery.eq.mockReturnValue(candidateQuery); candidateQuery.is.mockReturnValue(candidateQuery);
      candidateQuery.in.mockResolvedValue({ data: [{ id: candidateId }], error: null });

      const updateQuery = { eq: vi.fn(), then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve) };
      updateQuery.eq.mockReturnValue(updateQuery);
      const sessionQuery = {
        select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn(),
      };
      sessionQuery.select.mockReturnValue(sessionQuery); sessionQuery.eq.mockReturnValue(sessionQuery);
      sessionQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
      sessionQuery.insert.mockImplementation(() => ({ select: () => ({ single: async () => ({ data: { id: sessionId }, error: null }) }) }));
      sessionQuery.update.mockReturnValue(updateQuery);

      const resumeQuery = {
        select: vi.fn(), eq: vi.fn(), in: vi.fn(), insert: vi.fn(),
      };
      resumeQuery.select.mockReturnValue(resumeQuery); resumeQuery.eq.mockReturnValue(resumeQuery);
      resumeQuery.in.mockResolvedValue({ data: [], error: null });
      resumeQuery.insert.mockImplementation((row: Record<string, unknown>) => { insertedResumeRows.push(row); return Promise.resolve({ error: null }); });

      const userClient = {
        from: vi.fn((table: string) => table === 'candidates' ? candidateQuery : table === 'screening_sessions' ? sessionQuery : resumeQuery),
        storage: { from: vi.fn(() => ({ upload: vi.fn().mockResolvedValue({ error: null }), remove: vi.fn().mockResolvedValue({ error: null }) })) },
      };
      const serviceClient = { from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }) })) };
      const clientFactory = vi.fn(() => userClient) as never;
      const serviceClientFactory = vi.fn(() => serviceClient) as never;
      const processor = { requirements: vi.fn().mockResolvedValue([{ id: 'req-1', categoryId: 'required_technical_skills', description: 'Node.js experience', importance: 'required' }]), assess: vi.fn() } as unknown as ScreeningProcessor;
      const controller = createScreeningController(clientFactory, processor, serviceClientFactory);
      const request = {
        auth: { userId: ownerId, email: 'recruiter@example.com', emailConfirmed: true, accessToken: 'jwt', profile: { id: ownerId, display_name: null, role: 'recruiter', approval_status: 'approved' } },
        body: { jobTitle: 'Engineer', jobDescription: 'Build reliable backend services and collaborate on production systems.', candidateIds: JSON.stringify([candidateId, null]) },
        files: [
          { path, size: bytes.length, mimetype: 'application/pdf', originalname: 'Taylor_Stone.pdf' },
          { path: unlinkedPath, size: unlinkedBytes.length, mimetype: 'application/pdf', originalname: 'unlinked.pdf' },
        ],
        get: (name: string) => name === 'Idempotency-Key' ? '11111111-1111-4111-8111-111111111111' : undefined,
      } as unknown as Request;
      const responseResult = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        let status = 200;
        const response = { status: (value: number) => { status = value; return response; }, json: (body: unknown) => resolve({ status, body }) };
        controller.submit(request, response as unknown as Response, ((error?: unknown) => error ? reject(error) : undefined) as NextFunction);
      });

      expect(responseResult.status).toBe(201);
      expect(insertedResumeRows).toHaveLength(2);
      expect(insertedResumeRows[0]).toMatchObject({ owner_id: ownerId, candidate_id: candidateId, status: 'queued' });
      expect(insertedResumeRows[1]).toMatchObject({ owner_id: ownerId, candidate_id: null, status: 'queued' });
      expect(insertedResumeRows[0].id).toMatch(/^[0-9a-f-]{36}$/i);
      const responseBody = responseResult.body as { resumes: Array<{ id: string; status: string }> };
      expect(responseResult.body).toMatchObject({ sessionId, resumes: [{ status: 'queued' }, { status: 'queued' }] });
      expect(responseBody.resumes).toHaveLength(2);
      expect(responseBody.resumes[0].id).toBe(insertedResumeRows[0].id);
      expect(responseBody.resumes[1].id).toBe(insertedResumeRows[1].id);
      expect(candidateQuery.in).toHaveBeenCalledWith('id', [candidateId]);
      expect(candidateQuery.eq).toHaveBeenCalledWith('owner_id', ownerId);
      expect(candidateQuery.is).toHaveBeenCalledWith('archived_at', null);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
