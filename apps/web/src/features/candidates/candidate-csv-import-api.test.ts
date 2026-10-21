import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../lib/api/client';
import { requestCandidateImportPreview } from './candidate-csv-import-api';

vi.mock('../../lib/api/client', () => ({ apiRequest: vi.fn() }));

describe('candidate CSV duplicate preview request', () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it('posts mapped rows with the recruiter token and validates the full response', async () => {
    const rows = [
      { rowNumber: 2, candidate: { name: 'Ari Stone', email: 'ari@example.com' } },
      { rowNumber: 3, candidate: { name: 'Bea Cruz' } },
    ];
    const response = { rows: [
      { rowNumber: 2, status: 'ready', potentialDuplicate: false, candidateId: null },
      { rowNumber: 3, status: 'duplicate', potentialDuplicate: true, candidateId: '00000000-0000-4000-8000-000000000001' },
    ] };
    vi.mocked(apiRequest).mockResolvedValue(response);

    await expect(requestCandidateImportPreview(rows, 'recruiter-token')).resolves.toEqual(response);
    expect(apiRequest).toHaveBeenCalledWith('/candidates/bulk-import/preview', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }, 'recruiter-token');
  });

  it('rejects an incomplete response so the dialog can show an error and retry', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ rows: [] });

    await expect(requestCandidateImportPreview([
      { rowNumber: 2, candidate: { name: 'Ari Stone' } },
    ], 'recruiter-token')).rejects.toThrow(/incomplete import preview/i);
  });
});
