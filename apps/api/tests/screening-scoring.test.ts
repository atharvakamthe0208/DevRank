import { describe, expect, it } from 'vitest';
import { screeningCategories, type RequirementResult } from '@devrank/contracts';
import { scoreResumeJobMatch } from '../src/modules/screening/scoring.js';

function requirement(id: string, categoryIndex: number, status: RequirementResult['status']): RequirementResult {
  const { id: categoryId } = screeningCategories[categoryIndex];
  return { id, categoryId, description: `Job-specific requirement ${id}`, importance: 'required', status,
    evidence: status === 'demonstrated' ? [{ excerpt: 'Implemented a documented deployment pipeline.' }] : [],
    explanation: 'Evaluated against submitted resume evidence.', confidence: 0.8 };
}

describe('resume job-match scorer', () => {
  it('scores job requirements once, with fixed rubric weights and a separately labeled output', () => {
    const results = screeningCategories.map((_, index) => requirement(`req-${index}`, index, 'demonstrated'));
    const result = scoreResumeJobMatch(results);
    expect(result.scoreType).toBe('resume_job_match');
    expect(result.status).toBe('complete');
    expect(result.score).toBe(100);
    expect(result.categories.map(({ weight }) => weight)).toEqual([35, 25, 20, 10, 10]);
    expect(result.categories.reduce((sum, category) => sum + (category.weightedContribution ?? 0), 0)).toBe(100);
  });

  it('normalizes a provisional score over fully evaluable categories and excludes missing evidence', () => {
    const results = [requirement('req-tech', 0, 'demonstrated'), requirement('req-experience', 1, 'insufficient_evidence')];
    const result = scoreResumeJobMatch(results);
    expect(result.status).toBe('provisional');
    expect(result.score).toBe(100);
    expect(result.evidenceCoverage).toBe(58);
    expect(result.categories[1].score).toBeUndefined();
  });

  it('distinguishes an explicitly not-demonstrated requirement from insufficient evidence', () => {
    const result = scoreResumeJobMatch([requirement('req-tech', 0, 'not_demonstrated')]);
    expect(result.status).toBe('complete');
    expect(result.categories[0].score).toBe(0);
  });

  it('rejects duplicate requirement IDs so one criterion cannot count twice', () => {
    const req = requirement('req-1', 0, 'demonstrated');
    expect(() => scoreResumeJobMatch([req, req])).toThrow('Requirement IDs must be unique');
  });

  it('does not produce a score when all evidence is insufficient', () => {
    const result = scoreResumeJobMatch([requirement('req-1', 0, 'insufficient_evidence')]);
    expect(result.status).toBe('insufficient_evidence');
    expect(result.score).toBeUndefined();
    expect(result.evidenceCoverage).toBe(0);
  });
});
