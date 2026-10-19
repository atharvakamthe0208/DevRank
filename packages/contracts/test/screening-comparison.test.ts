import { describe, expect, it } from 'vitest';
import { screeningComparisonRequestSchema, screeningComparisonResponseSchema, screeningReportResponseSchema } from '../src/index.js';

const first = 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d';
const second = 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e';
const sessionId = '146ec40d-88c1-4575-8c08-e28601b26b4d';

describe('screening comparison and report contracts', () => {
  it('requires at least two unique resume IDs', () => {
    expect(screeningComparisonRequestSchema.safeParse({ resumeIds: [first] }).success).toBe(false);
    expect(screeningComparisonRequestSchema.safeParse({ resumeIds: [first, first] }).success).toBe(false);
    expect(screeningComparisonRequestSchema.safeParse({ resumeIds: [first, second] }).success).toBe(true);
  });

  it('validates same-context ranked/unranked results and report snapshots', () => {
    const ranking = { ranked: [{ resumeId: first, rank: 1, score: 78 }], unranked: [{ resumeId: second, filename: 'two.pdf', status: 'completed', reason: 'No deterministic overall score is available.' }], rankingCriteria: 'Saved score only.' };
    const base = { sessionId, jobTitle: 'Engineer', candidates: [
      { id: first, filename: 'one.pdf', status: 'completed', candidate: { name: 'Candidate One' }, evaluation: null },
      { id: second, filename: 'two.pdf', status: 'completed', candidate: null, evaluation: null },
    ], ranking };
    expect(screeningComparisonResponseSchema.safeParse(base).success).toBe(true);
    expect(screeningComparisonResponseSchema.safeParse({ ...base, ranking: { ...ranking, ranked: [{ resumeId: first, rank: 1, score: 101 }] } }).success).toBe(false);
    expect(screeningReportResponseSchema.safeParse({ generatedAt: '2026-10-18T09:30:00.000Z', selectedResumeIds: [first, second], details: {
      sessionId, jobTitle: 'Engineer', status: 'partial', resumes: [
        { id: first, filename: 'one.pdf', status: 'completed', candidate: { name: 'Candidate One' }, evaluation: null },
        { id: second, filename: 'two.pdf', status: 'failed', candidate: null, evaluation: null, error: 'Could not extract text.' },
      ],
    }, ranking }).success).toBe(true);
  });
});
