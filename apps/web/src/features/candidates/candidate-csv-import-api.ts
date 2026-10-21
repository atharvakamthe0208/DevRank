import { candidateImportPreviewResponseSchema, type CandidateImportPreviewResponse, type CandidateImportRows } from '@devrank/contracts';
import { apiRequest } from '../../lib/api/client';

export async function requestCandidateImportPreview(
  rows: CandidateImportRows['rows'],
  accessToken: string,
): Promise<CandidateImportPreviewResponse> {
  const response = await apiRequest<unknown>('/candidates/bulk-import/preview', {
    method: 'POST',
    body: JSON.stringify({ rows }),
  }, accessToken);
  const validated = candidateImportPreviewResponseSchema.safeParse(response);
  if (!validated.success || validated.data.rows.length !== rows.length) {
    throw new Error('The server returned an incomplete import preview. Try again.');
  }
  return validated.data;
}
