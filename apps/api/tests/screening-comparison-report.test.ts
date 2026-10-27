import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createScreeningController } from '../src/controllers/screening-controller.js';
import type { ScreeningScore } from '@devrank/contracts';

const sessionId = '146ec40d-88c1-4575-8c08-e28601b26b4d';
const ownerId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const ids = ['a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e', 'c9f9d3d9-83fb-4adb-bf9f-53dad74dfa5f'];
const unscoredId = 'd0d0d0d0-0000-4000-8000-000000000000';
const higherScoreId = 'e1e1e1e1-1111-4111-8111-111111111111';
const noScoreId = 'f2f2f2f2-2222-4222-8222-222222222222';
const associatedCandidateId = 'e5a5f5f0-fd65-4c13-9378-5a4377dcd1e2';
const preliminary = { rubricVersion: 'resume-document-match-1.0.0' as const, score: 62, evidenceCoverage: 40, criteria: [{
  id: 'req-tech', categoryId: 'required_technical_skills' as const, description: 'TypeScript and API design', importance: 'required' as const,
  status: 'supported' as const, matchedTerms: ['typescript'], matchPercentage: 50, evidenceExcerpt: 'Built TypeScript services',
}] };
const auth = { userId: ownerId, email: 'recruiter@example.test', emailConfirmed: true, accessToken: 'jwt', profile: { id: ownerId, display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const } };
const selectedResumeColumns = vi.fn();
const score = (value: number): ScreeningScore => ({
  rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: value, evidenceCoverage: 100,
  categories: [
    { categoryId: 'required_technical_skills', weight: 35, score: value, weightedContribution: value * .35, evaluableWeight: 35, status: 'scored', requirementIds: [] },
    { categoryId: 'relevant_experience', weight: 25, score: value, weightedContribution: value * .25, evaluableWeight: 25, status: 'scored', requirementIds: [] },
    { categoryId: 'projects_practical_evidence', weight: 20, score: value, weightedContribution: value * .2, evaluableWeight: 20, status: 'scored', requirementIds: [] },
    { categoryId: 'education_certifications', weight: 10, score: value, weightedContribution: value * .1, evaluableWeight: 10, status: 'scored', requirementIds: [] },
    { categoryId: 'additional_requirements', weight: 10, score: value, weightedContribution: value * .1, evaluableWeight: 10, status: 'scored', requirementIds: [] },
  ], requirements: [],
});
const dbRows = [
  { id: ids[0], candidate_id: associatedCandidateId, original_filename: 'alpha.pdf', status: 'completed', extracted_data: { candidate: { name: 'Alpha' } }, evaluation: score(80), safe_error_message: null },
  { id: ids[1], original_filename: 'beta.pdf', status: 'completed', extracted_data: { candidate: { name: 'Beta' } }, evaluation: score(80), safe_error_message: null },
  { id: ids[2], original_filename: 'failed.pdf', status: 'failed', extracted_data: null, evaluation: null, safe_error_message: 'Could not extract text.' },
  { id: unscoredId, original_filename: 'partial.pdf', status: 'completed', extracted_data: { candidate: { name: 'Partial' } }, evaluation: null, preliminary_evaluation: preliminary, safe_error_message: null },
  { id: higherScoreId, original_filename: 'higher.pdf', status: 'completed', extracted_data: { candidate: { name: 'Higher' } }, evaluation: score(91), safe_error_message: null },
  { id: noScoreId, original_filename: 'no-score.pdf', status: 'completed', extracted_data: { candidate: { name: 'No Score' } }, evaluation: null, preliminary_evaluation: null, safe_error_message: null },
];
const clientFactory = vi.fn(() => ({
  from: (table: string) => ({
    select: (columns: string) => table === 'screening_sessions'
      ? { eq: () => ({ single: async () => ({ data: { id: sessionId, job_title: 'Engineer', status: 'partial' }, error: null }) }) }
      : (selectedResumeColumns(columns), { eq: () => ({ order: async () => ({ data: dbRows, error: null }) }) }),
  }),
})) as never;

async function invoke(name: 'get' | 'compare' | 'report' | 'ranking', idsToSelect: string[] = []) {
  let finish!: (value: { data?: unknown; error?: unknown }) => void;
  const completion = new Promise<{ data?: unknown; error?: unknown }>((resolve) => { finish = resolve; });
  const response = { json: vi.fn((value: unknown) => { finish({ data: value }); }) } as unknown as Response;
  const next = ((error?: unknown) => { finish({ error }); }) as NextFunction;
  const handler = createScreeningController(clientFactory)[name];
  await handler({ auth, params: { id: sessionId }, body: { resumeIds: idsToSelect } } as unknown as Request, response, next);
  const result = await completion;
  if (result.error) throw result.error;
  return result.data as Record<string, unknown>;
}

describe('screening comparison and report endpoints', () => {
  it('returns the persisted candidate association and verified candidate name through screening details', async () => {
    selectedResumeColumns.mockClear();
    const result = await invoke('get') as { resumes: Array<{ id: string; candidateId: string | null; candidate: { name: string } | null; preliminaryEvaluation: typeof preliminary | null }> };
    expect(result.resumes.find((resume) => resume.id === ids[0])?.candidate).toEqual({ name: 'Alpha' });
    expect(result.resumes.find((resume) => resume.id === ids[0])?.candidateId).toBe(associatedCandidateId);
    expect(selectedResumeColumns).toHaveBeenCalledWith(expect.stringContaining('candidate_id'));
    expect(result.resumes.find((resume) => resume.id === ids[2])?.candidate).toBeNull();
    expect(result.resumes.find((resume) => resume.id === unscoredId)?.preliminaryEvaluation).toEqual(preliminary);
  });

  it('returns all 20 persisted resumes without truncating the results query', async () => {
    const added = Array.from({ length: 14 }, (_, index) => ({
      id: `f0000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
      original_filename: `resume-${index}.pdf`, status: 'failed', extracted_data: null, evaluation: null, safe_error_message: 'Could not process this resume.',
    }));
    dbRows.push(...added);
    try {
      const result = await invoke('get') as { resumes: Array<{ id: string }> };
      expect(result.resumes).toHaveLength(20);
      expect(result.resumes.map(({ id }) => id)).toEqual(expect.arrayContaining(added.map(({ id }) => id)));
    } finally {
      dbRows.splice(dbRows.length - added.length, added.length);
    }
  });

  it('compares selected completed candidates and ranks validated and preliminary saved scores in sequence', async () => {
    const result = await invoke('compare', ids.slice(0, 2)) as { ranking: { ranked: Array<{ resumeId: string; rank: number; score: number }>; unranked: Array<{ resumeId: string; status: string; reason: string }> } };
    expect(result.ranking.ranked).toEqual([
      { resumeId: higherScoreId, rank: 1, score: 91 },
      { resumeId: ids[0], rank: 2, score: 80 },
      { resumeId: ids[1], rank: 3, score: 80 },
      { resumeId: unscoredId, rank: 4, score: 62 },
    ]);
    expect(result.ranking.unranked).toContainEqual(expect.objectContaining({ resumeId: ids[2], status: 'failed' }));
    expect(result.ranking.unranked).toContainEqual(expect.objectContaining({ resumeId: noScoreId, status: 'completed' }));
  });

  it('rejects fewer than two selected resumes and IDs outside this screening', async () => {
    await expect(invoke('compare', [ids[0]])).rejects.toMatchObject({ code: 'INVALID_COMPARISON_SELECTION', statusCode: 400 });
    await expect(invoke('compare', [ids[0], 'a2f2f2f2-2222-4222-8222-222222222222'])).rejects.toMatchObject({ code: 'SCREENING_RESUME_NOT_FOUND', statusCode: 404 });
    await expect(invoke('compare', [ids[0], ids[2]])).rejects.toMatchObject({ code: 'SCREENING_RESUME_NOT_COMPLETED', statusCode: 400 });
  });

  it('returns a report snapshot from persisted screening data and selected IDs', async () => {
    const result = await invoke('report', ids.slice(0, 2)) as { details: { resumes: unknown[] }; selectedResumeIds: string[]; generatedAt: string; ranking: { ranked: unknown[] } };
    expect(result.selectedResumeIds).toEqual(ids.slice(0, 2));
    expect(result.details.resumes).toHaveLength(6);
    expect(result.ranking.ranked).toHaveLength(4);
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
  });

  it('retrieves ranking for the full saved screening before candidates are selected', async () => {
    const result = await invoke('ranking') as { ranking: { ranked: Array<{ resumeId: string; rank: number; score: number }> ; unranked: Array<{ resumeId: string }> } };
    expect(result.ranking.ranked[0]).toEqual({ resumeId: higherScoreId, rank: 1, score: 91 });
    expect(result.ranking.ranked).toContainEqual({ resumeId: unscoredId, rank: 4, score: 62 });
    expect(result.ranking.unranked.map(({ resumeId }) => resumeId)).toEqual([ids[2], noScoreId]);
  });
});
