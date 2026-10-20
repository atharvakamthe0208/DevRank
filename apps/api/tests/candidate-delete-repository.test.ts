import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../src/middleware/http-error.js';
import { candidateRepository } from '../src/repositories/candidate-repository.js';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/config/supabase.js', () => ({
  getSupabaseClient: vi.fn(() => ({ rpc })),
}));

const auth = {
  userId: '1d4b1d45-e136-4f50-a46e-8ef29735ec26',
  email: 'recruiter@example.com',
  emailConfirmed: true,
  profile: { id: '1d4b1d45-e136-4f50-a46e-8ef29735ec26', display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const },
  accessToken: 'test-token',
};
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';

describe('candidateRepository.delete', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the owner-scoped atomic database deletion RPC', async () => {
    rpc.mockResolvedValue({ data: true, error: null });

    await expect(candidateRepository.delete(auth, candidateId)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('delete_candidate_and_data', { p_candidate_id: candidateId });
  });

  it('returns not found when the caller cannot see the candidate', async () => {
    rpc.mockResolvedValue({ data: false, error: null });

    await expect(candidateRepository.delete(auth, candidateId)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('maps RPC failures to a sanitized database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private RLS and candidate details' } });
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failure = await candidateRepository.delete(auth, candidateId).catch((error: unknown) => error as HttpError);
      expect(failure).toBeInstanceOf(HttpError);
      expect(failure).toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE' });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private RLS and candidate details');
    } finally {
      diagnostic.mockRestore();
    }
  });
});
