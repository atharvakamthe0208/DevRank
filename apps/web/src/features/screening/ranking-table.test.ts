import { describe, expect, it } from 'vitest';
import type { ScreeningComparisonResponse, ScreeningDetailsResponse } from '@devrank/contracts';
import { filterAndSortScreeningResumes, scoreBand } from './ranking-table';

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
});
