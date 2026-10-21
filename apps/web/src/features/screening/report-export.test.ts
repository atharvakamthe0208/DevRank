import { describe, expect, it } from 'vitest';
import type { ScreeningReportResponse } from '@devrank/contracts';
import { screeningReportCsv } from './report-export';

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
      generatedAt: '2026-10-18T09:30:00.000Z', selectedResumeIds: ['a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d'],
      ranking: { ranked: [{ resumeId: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', rank: 1, score: 82 }], unranked: [], rankingCriteria: 'Saved score.' },
      details: { sessionId: '146ec40d-88c1-4575-8c08-e28601b26b4d', jobTitle: 'Engineer', status: 'completed', resumes: [
        { id: 'a7e7b1b7-61d9-48b9-bd7d-31b8b52bd83d', filename: '=cmd.pdf', status: 'completed', candidate: { name: 'Alex' }, evaluation: scored },
      ] },
    };
    const csv = screeningReportCsv(report);
    expect(csv).toContain('"Filename","Candidate name"');
    expect(csv).toContain("\"'=cmd.pdf\"");
    expect(csv).toContain('"1","82"');
    expect(csv).not.toContain('"0"');
  });
});
