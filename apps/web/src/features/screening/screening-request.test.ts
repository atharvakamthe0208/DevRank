import { describe, expect, it } from 'vitest';
import { buildScreeningRequest } from './screening-request';

describe('buildScreeningRequest', () => {
  it('keeps each optional candidate mapping aligned with its resume, including null slots', () => {
    const first = new File(['first'], 'first.pdf', { type: 'application/pdf' });
    const second = new File(['second'], 'second.pdf', { type: 'application/pdf' });
    const candidateId = 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
    const body = buildScreeningRequest('Engineer', 'A sufficiently detailed role description for screening candidates.', [
      { file: first, candidateId },
      { file: second },
    ]);

    expect(body.getAll('resumes')).toEqual([first, second]);
    expect(body.get('candidateIds')).toBe(JSON.stringify([candidateId, null]));
  });

  it('omits candidate mappings when every resume is intentionally unlinked', () => {
    const file = new File(['resume'], 'unlinked.pdf', { type: 'application/pdf' });
    const body = buildScreeningRequest('Engineer', 'A sufficiently detailed role description for screening candidates.', [{ file }]);

    expect(body.getAll('resumes')).toEqual([file]);
    expect(body.has('candidateIds')).toBe(false);
  });
});
