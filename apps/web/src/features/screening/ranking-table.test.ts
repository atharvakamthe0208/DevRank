import { describe, expect, it } from 'vitest';
import type { ScreeningComparisonResponse, ScreeningDetailsResponse, ScreeningScore } from '@devrank/contracts';
import { filterAndSortScreeningResumes, scoreBand, scorePresentation } from './ranking-table';

const details: ScreeningDetailsResponse = {
  sessionId: '146ec40d-88c1-4575-8c08-e28601b26b4d', jobTitle: 'Engineer', status: 'partial', resumes: [
    { id: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', filename: 'zeta-long-resume-name.pdf', status: 'completed', candidate: { name: 'Zeta' }, evaluation: null },
    { id: 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e', filename: 'alpha.pdf', status: 'completed', candidate: { name: 'Alpha' }, evaluation: null },
    { id: 'c9f9d3d9-83fb-4adb-bf9f-53dad74dfa5f', filename: 'failed.pdf', status: 'failed', candidate: null, evaluation: null, error: 'Failed to process.' },
  ],
};
const ranking: ScreeningComparisonResponse['ranking'] = {
  ranked: [
    { resumeId: details.resumes[0].id, rank: 1, score: 92 },
    { resumeId: details.resumes[1].id, rank: 2, score: 84 },
  ],
  unranked: [{ resumeId: details.resumes[2].id, filename: 'failed.pdf', status: 'failed', reason: 'Failed to process.' }],
  rankingCriteria: 'Persisted deterministic score.',
};

describe('screening ranking table data', () => {
  it('defaults to descending backend rank and keeps unscored or failed resumes separate', () => {
    const result = filterAndSortScreeningResumes(details, ranking, '');
    expect(result.scored.map(({ filename }) => filename)).toEqual(['zeta-long-resume-name.pdf', 'alpha.pdf']);
    expect(result.unscored.map(({ status }) => status)).toEqual(['failed']);
    expect(result.rankById.get(details.resumes[0].id)).toEqual({ resumeId: details.resumes[0].id, rank: 1, score: 92 });
  });

  it('filters by identified name or filename without changing backend ranking order', () => {
    expect(filterAndSortScreeningResumes(details, ranking, 'ZETA-LONG').scored.map(({ id }) => id)).toEqual([details.resumes[0].id]);
    expect(filterAndSortScreeningResumes(details, ranking, '').scored.map(({ candidate }) => candidate?.name)).toEqual(['Zeta', 'Alpha']);
  });

  it('preserves tied ranks and places unscored rows after all saved scored rows', () => {
    const tied = { ...ranking, ranked: [
      { resumeId: details.resumes[0].id, rank: 1, score: 92 },
      { resumeId: details.resumes[1].id, rank: 1, score: 92 },
    ] };
    const result = filterAndSortScreeningResumes(details, tied, '');
    expect(result.scored.map((resume) => result.rankById.get(resume.id)?.rank)).toEqual([1, 1]);
    expect(result.unscored.map((resume) => resume.id)).toEqual([details.resumes[2].id]);
  });

  it('uses restrained presentation-only score bands', () => {
    expect([scoreBand(49), scoreBand(50), scoreBand(74), scoreBand(75), scoreBand(100)]).toEqual(['low', 'medium', 'medium', 'high', 'high']);
  });

  it('labels preliminary scores without changing status or assigning rank', () => {
    const resume = { ...details.resumes[2], preliminaryEvaluation: {
      rubricVersion: 'resume-document-match-1.0.0' as const, score: 47, evidenceCoverage: 25,
      criteria: [{ id: 'req-1', categoryId: 'required_technical_skills' as const, description: 'TypeScript', importance: 'required' as const,
        status: 'supported' as const, matchedTerms: ['typescript'], matchPercentage: 100, evidenceExcerpt: 'TypeScript services' }],
    } };
    expect(resume.status).toBe('failed');
    expect(scorePresentation(resume)).toEqual({ score: 47, label: 'Preliminary match', preliminary: true });
    expect(filterAndSortScreeningResumes({ ...details, resumes: [resume] }, { ...ranking, ranked: [], unranked: [] }, '').rankById.has(resume.id)).toBe(false);
  });

  it('always prefers a validated score when both validated and preliminary results exist', () => {
    const validated: ScreeningScore = { rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match', status: 'complete', score: 88,
      evidenceCoverage: 100, categories: [], requirements: [] } as unknown as ScreeningScore;
    const resume = { ...details.resumes[0], evaluation: validated, preliminaryEvaluation: {
      rubricVersion: 'resume-document-match-1.0.0' as const, score: 41, evidenceCoverage: 20,
      criteria: [{ id: 'req-1', categoryId: 'required_technical_skills' as const, description: 'TypeScript', importance: 'required' as const,
        status: 'supported' as const, matchedTerms: ['typescript'], matchPercentage: 50, evidenceExcerpt: 'TypeScript services' }],
    } };
    expect(scorePresentation(resume)).toEqual({ score: 88, label: 'Validated score', preliminary: false });
  });

  it.each([1, 4, 5, 10, 20])('keeps preliminary-only rows unranked in a mixed %i-resume batch', (count) => {
    const resumes: ScreeningDetailsResponse['resumes'] = Array.from({ length: count }, (_, index) => ({
      ...details.resumes[0],
      id: `f0000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
      status: 'completed' as const,
      evaluation: null,
      preliminaryEvaluation: { rubricVersion: 'resume-document-match-1.0.0' as const, score: 70 - index, evidenceCoverage: 50,
        criteria: [{ id: 'req-1', categoryId: 'required_technical_skills' as const, description: 'TypeScript', importance: 'required' as const,
          status: 'supported' as const, matchedTerms: ['typescript'], matchPercentage: 50, evidenceExcerpt: 'TypeScript services' }] },
    }));
    const validatedId = resumes[0].id;
    const result = filterAndSortScreeningResumes({ ...details, resumes }, { ...ranking,
      ranked: [{ resumeId: validatedId, rank: 1, score: 91 }],
      unranked: resumes.slice(1).map((resume) => ({ resumeId: resume.id, filename: resume.filename, status: resume.status, reason: 'Preliminary only.' })),
    }, '');
    expect(result.scored.map((resume) => resume.id)).toEqual([validatedId]);
    expect(result.unscored).toHaveLength(count - 1);
    expect(result.unscored.every((resume) => resume.preliminaryEvaluation !== null && resume.status === 'completed')).toBe(true);
  });
});
