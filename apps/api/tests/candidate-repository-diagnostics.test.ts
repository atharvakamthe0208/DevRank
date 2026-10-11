import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSupabaseClient } = vi.hoisted(() => ({ mockGetSupabaseClient: vi.fn() }));
vi.mock('../src/config/supabase.js', () => ({ getSupabaseClient: mockGetSupabaseClient }));

import { candidateRepository } from '../src/repositories/candidate-repository.js';
import { HttpError } from '../src/middleware/http-error.js';
import type { AuthContext } from '../src/types/auth.js';

const auth: AuthContext = {
  userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26',
  email: 'recruiter@example.com',
  emailConfirmed: true,
  profile: {
    id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26',
    display_name: 'Recruiter',
    role: 'recruiter',
    approval_status: 'approved',
  },
  accessToken: 'DO_NOT_LOG_ACCESS_TOKEN',
};

function configureInsert(single: () => Promise<unknown>) {
  const query = {
    insert: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(single),
  };
  mockGetSupabaseClient.mockReturnValue({ from: vi.fn(() => query) });
  return query;
}

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
    full_name: 'Candidate Value Must Not Be Logged',
    email: 'private@example.com',
    github_username: null,
    leetcode_username: null,
    hackerrank_username: null,
    created_at: '2026-10-11T12:00:00.123456+00:00',
    updated_at: '2026-10-11T12:00:00.123456+00:00',
    ...overrides,
  };
}

function configureList(response: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async () => response),
  };
  mockGetSupabaseClient.mockReturnValue({ from: vi.fn(() => query) });
  return query;
}

describe('candidate repository failure diagnostics', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('identifies a returned Supabase/PostgREST error and logs only safe structured fields', async () => {
    const providerError = Object.assign(new Error('DO_NOT_LOG_DATABASE_MESSAGE'), {
      name: 'PostgrestError',
      code: 'PGRST204',
      status: 400,
      details: 'DO_NOT_LOG_DETAILS',
    });
    configureInsert(async () => ({ data: null, error: providerError }));

    await expect(candidateRepository.create(auth, { name: 'DO_NOT_LOG_CANDIDATE_DATA' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });

    expect(log).toHaveBeenCalledWith('Candidate database operation failed', {
      operation: 'create the candidate',
      failureSource: 'supabase_response',
      errorName: 'PostgrestError',
      category: 'schema',
      code: 'PGRST204',
      httpStatus: 400,
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/DO_NOT_LOG|DO_NOT_LOG_ACCESS_TOKEN/);
  });

  it('identifies a thrown exception separately without logging its message or request data', async () => {
    configureInsert(async () => { throw new TypeError('DO_NOT_LOG_EXCEPTION_MESSAGE'); });

    await expect(candidateRepository.create(auth, { name: 'DO_NOT_LOG_CANDIDATE_DATA' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' } satisfies Partial<HttpError>);

    expect(log).toHaveBeenCalledWith('Candidate database operation failed', {
      operation: 'create the candidate',
      failureSource: 'thrown_exception',
      errorName: 'TypeError',
      category: 'connection_or_unknown',
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/DO_NOT_LOG/);
  });

  it('creates a candidate from PostgREST timestamptz values with a numeric offset', async () => {
    configureInsert(async () => ({ data: candidateRow(), error: null }));

    await expect(candidateRepository.create(auth, { name: 'Candidate' })).resolves.toMatchObject({
      id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
      createdAt: '2026-10-11T12:00:00.123456+00:00',
      updatedAt: '2026-10-11T12:00:00.123456+00:00',
    });
    expect(log).not.toHaveBeenCalled();
  });

  it('lists candidates from PostgREST timestamptz values with a numeric offset', async () => {
    configureList({ data: [candidateRow()], error: null, count: 1 });

    await expect(candidateRepository.list(auth, { page: 1, pageSize: 20 })).resolves.toMatchObject({
      total: 1,
      items: [{
        id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
        createdAt: '2026-10-11T12:00:00.123456+00:00',
        updatedAt: '2026-10-11T12:00:00.123456+00:00',
      }],
    });
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['create', 'list'] as const)('logs safe Zod paths and returns a non-database error for invalid %s rows', async (operation) => {
    const malformedRow = candidateRow({ created_at: 'not-a-timestamp', updated_at: 'also-not-a-timestamp' });
    if (operation === 'create') configureInsert(async () => ({ data: malformedRow, error: null }));
    else configureList({ data: [malformedRow], error: null, count: 1 });

    const result = operation === 'create'
      ? candidateRepository.create(auth, { name: 'Candidate' })
      : candidateRepository.list(auth, { page: 1, pageSize: 20 });
    await expect(result).rejects.toMatchObject({
      statusCode: 500,
      code: 'INVALID_DATABASE_RESPONSE',
      message: 'Candidate data could not be processed',
    });

    expect(log).toHaveBeenCalledWith('Candidate database row validation failed', {
      schema: 'candidateSchema',
      issues: [
        { path: 'createdAt', code: 'invalid_string' },
        { path: 'updatedAt', code: 'invalid_string' },
      ],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Candidate Value Must Not Be Logged|private@example\.com|not-a-timestamp/);
  });
});
