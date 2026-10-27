import { describe, expect, it } from 'vitest';
import { screeningCreateSchema, screeningDetailsResponseSchema } from './screening.js';

const candidateId = 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2';

describe('screening request and result contracts', () => {
  it('accepts the documented top-level candidate mapping and rejects nested unsupported fields', () => {
    const base = { jobTitle: 'Engineer', jobDescription: 'Build reliable backend services with a cross-functional production team.' };
    expect(screeningCreateSchema.safeParse({ ...base, candidateIds: [candidateId, 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d'] }).success).toBe(true);
    expect(screeningCreateSchema.safeParse({ ...base, resumes: [{ candidateId }] }).success).toBe(false);
    expect(screeningCreateSchema.safeParse({ ...base, unsupported: true }).success).toBe(false);
  });

  it('accepts persisted nullable candidate associations and rejects unrelated result keys', () => {
    const base = {
      sessionId: '146ec40d-88c1-4575-8c08-e28601b26b4d', jobTitle: 'Engineer', status: 'processing',
      resumes: [
        { id: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', filename: 'one.pdf', status: 'queued', candidate: null, evaluation: null, candidateId },
        { id: 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e', filename: 'two.pdf', status: 'processing', candidate: null, evaluation: null, candidateId: null },
      ],
    };
    expect(screeningDetailsResponseSchema.parse(base).resumes.map(({ candidateId: id }) => id)).toEqual([candidateId, null]);
    expect(screeningDetailsResponseSchema.safeParse({ ...base, resumes: [{ ...base.resumes[0], unexpected: true }] }).success).toBe(false);
  });
});
