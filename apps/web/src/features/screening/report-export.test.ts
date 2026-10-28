import { describe, expect, it } from 'vitest';
import type { ScreeningReportResponse } from '@devrank/contracts';
import { screeningReportCsv, sortScreeningReportResumes } from './report-export';

const scored = {
  rubricVersion: 'resume-job-match-1.0.0' as const, scoreType: 'resume_job_match' as const, status: 'complete' as const, score: 82, evidenceCoverage: 100, requirements: [],
  categories: [
    { categoryId: 'required_technical_skills' as const, weight: 35, score: 82, weightedContribution: 28.7, evaluableWeight: 35, status: 'scored' as const, requirementIds: [] },
    { categoryId: 'relevant_experience' as const, weight: 25, score: 82, weightedContribution: 20.5, evaluableWeight: 25, status: 'scored' as const, requirementIds: [] },
    { categoryId: 'projects_practical_evidence' as const, weight: 20, score: 82, weightedContribution: 16.4, evaluableWeight: 20, status: 'scored' as const, requirementIds: [] },
    { categoryId: 'education_certifications' as const, weight: 10, score: 82, weightedContribution: 8.2, evaluableWeight: 10, status: 'scored' as const, requirementIds: [] },
    { categoryId: 'additional_requirements' as const, weight: 10, score: 82, weightedContribution: 8.2, evaluableWeight: 10, status: 'scored' as const, requirementIds: [] },
  ],
};

describe('screening CSV export', () => {
  it('exports only persisted results with rank and scores and escapes spreadsheet formulas', () => {
    const report: ScreeningReportResponse = {
      generatedAt: '2026-10-18T09:30:00.000Z', selectedResumeIds: ['a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e'],
      ranking: { ranked: [{ resumeId: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', rank: 1, score: 82 }], unranked: [{ resumeId: 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e', filename: 'preliminary.pdf', status: 'failed', reason: 'Preliminary only.' }], rankingCriteria: 'Saved score.' },
      details: { sessionId: '146ec40d-88c1-4575-8c08-e28601b26b4d', jobTitle: 'Engineer', status: 'completed', resumes: [
        { id: 'b8e8c2c8-72ea-49ca-ae8e-42c9c63ce94e', filename: 'preliminary.pdf', status: 'failed', candidate: null, evaluation: null,
          preliminaryEvaluation: { rubricVersion: 'resume-document-match-1.0.0', score: 47, evidenceCoverage: 25, criteria: [{ id: 'req-1', categoryId: 'required_technical_skills', description: 'TypeScript', importance: 'required', status: 'supported', matchedTerms: ['typescript'], matchPercentage: 100, evidenceExcerpt: 'TypeScript services' }] } },
        { id: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', filename: '=cmd.pdf', status: 'completed', candidate: { name: 'Alex' }, evaluation: scored },
      ] },
    };
    const csv = screeningReportCsv(report);
    expect(csv).toContain('"Candidate name","Resume","Rank","Score / 100","Resume text excerpts"');
    expect(csv).toContain("\"'=cmd.pdf\"");
    expect(csv).toContain('"1","82"');
    expect(csv).toContain('"Name not identified","preliminary.pdf","","47"');
    expect(csv).not.toMatch(/preliminary match|provisional|insufficient evidence|unverified|supported requirements|missing or unsupported requirements/i);
    expect(csv).not.toContain('Processing status');
    expect(csv).toContain('typescript; TypeScript services');
    expect(csv).not.toContain('"0"');
    const ordered = sortScreeningReportResumes(report);
    expect(ordered.map(({ filename }) => filename)).toEqual(['=cmd.pdf', 'preliminary.pdf']);
  });
});
