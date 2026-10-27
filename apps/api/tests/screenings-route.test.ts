import { once } from 'node:events';
import type { Server } from 'node:http';
import express, { type RequestHandler } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createScreeningsRouter } from '../src/routes/screenings.js';

const authMiddleware: RequestHandler = (request, response, next) => {
  if (request.get('authorization') !== 'Bearer accepted') { response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }); return; }
  request.auth = { userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', email: 'r@example.com', emailConfirmed: true, accessToken: 'accepted', profile: { id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', display_name: 'Recruiter', role: 'recruiter', approval_status: 'approved' } };
  next();
};

describe('resume screening upload route', () => {
  let server: Server;
  let origin: string;
  const submit = vi.fn((request, response) => response.status(201).json({ uploaded: Array.isArray(request.files) ? request.files.length : 0, jobTitle: request.body.jobTitle }));
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/screenings', createScreeningsRouter(authMiddleware, (_request, _response, next) => next(), { submit, get: vi.fn(), ranking: vi.fn(), retry: vi.fn(), compare: vi.fn(), report: vi.fn() }));
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  it('requires authentication before accepting multipart resume uploads', async () => {
    const response = await fetch(`${origin}/api/screenings`, { method: 'POST' });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(submit).not.toHaveBeenCalled();
  });

  it('accepts multiple PDF fields using the resumes multipart field', async () => {
    const form = new FormData();
    form.set('jobTitle', 'Backend Engineer');
    form.set('jobDescription', 'Build backend systems and collaborate with the team on production services.');
    form.append('resumes', new Blob(['%PDF-1.7 test content'], { type: 'application/pdf' }), 'one.pdf');
    form.append('resumes', new Blob(['%PDF-1.7 test content'], { type: 'application/pdf' }), 'two.pdf');
    const response = await fetch(`${origin}/api/screenings`, { method: 'POST', headers: { Authorization: 'Bearer accepted' }, body: form });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ uploaded: 2, jobTitle: 'Backend Engineer' });
  });

  it('passes an unsupported file through so the controller can fail it without dropping valid siblings', async () => {
    const form = new FormData();
    form.append('resumes', new Blob(['text'], { type: 'text/plain' }), 'resume.txt');
    const response = await fetch(`${origin}/api/screenings`, { method: 'POST', headers: { Authorization: 'Bearer accepted' }, body: form });
    expect(response.status).toBe(201);
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({
      files: [expect.objectContaining({ mimetype: 'text/plain', originalname: 'resume.txt' })],
    }), expect.anything(), expect.anything());
  });

  it('accepts an explicit owner-validated candidate mapping for automatic import screening', async () => {
    const form = new FormData();
    form.set('jobTitle', 'Backend Engineer');
    form.set('jobDescription', 'Build backend systems and collaborate with the team on production services.');
    form.set('candidateIds', JSON.stringify(['e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2']));
    form.append('resumes', new Blob(['%PDF-1.7 candidate resume'], { type: 'application/pdf' }), 'candidate.pdf');
    const response = await fetch(`${origin}/api/screenings`, { method: 'POST', headers: { Authorization: 'Bearer accepted' }, body: form });
    expect(response.status).toBe(201);
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.objectContaining({ candidateIds: '["e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2"]' }) }), expect.anything(), expect.anything());
  });
});

