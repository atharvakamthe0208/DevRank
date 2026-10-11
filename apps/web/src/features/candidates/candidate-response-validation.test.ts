import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseCandidateApiResponse,
  parseCandidateListApiResponse,
} from './candidate-response-validation';

const candidate = {
  id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
  name: 'Private Candidate Name',
  email: 'private@example.com',
  createdAt: '2026-10-11T12:00:00.123456+00:00',
  updatedAt: '2026-10-11T12:00:00.123456+00:00',
};

afterEach(() => vi.restoreAllMocks());

describe('candidate API response validation', () => {
  it('accepts the raw candidate object returned by POST /candidates', () => {
    expect(parseCandidateApiResponse(candidate)).toMatchObject(candidate);
  });

  it('accepts the pagination envelope returned by GET /candidates', () => {
    expect(parseCandidateListApiResponse({ items: [candidate], page: 1, pageSize: 20, total: 1 }))
      .toMatchObject({ items: [candidate], page: 1, pageSize: 20, total: 1 });
  });

  it('logs safe candidate field paths when the POST response itself is malformed', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalidCandidate = { ...candidate, createdAt: 'not-a-timestamp', updatedAt: 'also-not-a-timestamp' };

    expect(parseCandidateApiResponse(invalidCandidate)).toBeUndefined();
    expect(log).toHaveBeenCalledWith('Candidate API response validation failed', {
      schema: 'candidateSchema',
      issues: [
        { path: 'createdAt', code: 'invalid_string' },
        { path: 'updatedAt', code: 'invalid_string' },
      ],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private Candidate Name|private@example\.com|not-a-timestamp/);
    log.mockRestore();
  });

  it('logs schema paths and codes without candidate values when the list envelope is invalid', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const invalidCandidate = { ...candidate, createdAt: 'not-a-timestamp', updatedAt: 'also-not-a-timestamp' };

    expect(parseCandidateListApiResponse({ items: [invalidCandidate], page: 1, pageSize: 20, total: 1 }))
      .toBeUndefined();
    expect(log).toHaveBeenCalledWith('Candidate API response validation failed', {
      schema: 'candidateListResponseSchema',
      issues: [
        { path: 'items.[index].createdAt', code: 'invalid_string' },
        { path: 'items.[index].updatedAt', code: 'invalid_string' },
      ],
    });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/Private Candidate Name|private@example\.com|not-a-timestamp/);
  });
});
