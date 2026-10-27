import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { unifiedCandidateReportSchema } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { UnifiedCandidateReportView } from './UnifiedCandidateReportPage';

const longSavedValue = 'saved-value-' + 'x'.repeat(220);
const report = unifiedCandidateReportSchema.parse({
  generatedAt: '2026-10-14T12:00:00.000Z',
  candidate: { id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Taylor Example', email: 'taylor@example.com', createdAt: '2026-10-13T12:00:00.000Z', updatedAt: '2026-10-13T12:00:00.000Z' },
  job: { roleId: 'software_developer', roleLabel: 'software developer', description: 'Build accessible product experiences.' },
  platformEvaluation: { status: 'insufficient_evidence', evaluatedAt: '2026-10-14T12:00:00.000Z', overallIndex: null, rubricNotice: 'Missing source data remains unscored.', strengths: ['Saved strength'], improvementAreas: ['Saved improvement'] },
  assessment: null,
  sources: {
    github: {
      status: 'partial', provenance: 'github_api', capturedAt: '2026-10-14T11:00:00.000Z',
      values: { publicRepositoryCount: 3, repositoriesTruncated: false, savedAuditValue: longSavedValue },
      findings: [
        { categoryId: 'project_portfolio', displayName: 'Project Portfolio', weight: 20, source: 'github', status: 'scored', score: 62, weightedPoints: 12.4, metrics: { publicRepositoryCount: 3 }, formula: 'Normalized public repository count, capped at 100; quantity proxy only.' },
        { categoryId: 'technical_skills', displayName: 'Technical Skills', weight: 20, source: 'github', status: 'scored', score: 60, weightedPoints: 12, metrics: { distinctRepositoryLanguages: 3 }, formula: 'Normalized distinct repository language count.' },
        { categoryId: 'development_activity', displayName: 'Development Activity', weight: 15, source: 'github', status: 'partial', metrics: {}, formula: 'Uses available commit activity evidence.' },
        { categoryId: 'collaboration', displayName: 'Collaboration', weight: 10, source: 'github', status: 'unavailable', metrics: {}, formula: 'Uses attributable review and collaboration evidence.' },
        { categoryId: 'current_year_contributions', displayName: 'Current-Year Contributions', weight: 10, source: 'github', status: 'scored', score: 45, weightedPoints: 4.5, metrics: { totalContributions: 12 }, formula: 'Normalized current-year contribution evidence.' },
      ],
      limitations: ['Identity is not verified.', 'Snapshot age has no approved freshness threshold.', 'The public-only token scope is an operator configuration requirement.'],
    },
    leetcode: {
      status: 'available', provenance: 'alfa_leetcode_api', capturedAt: '2026-10-14T11:30:00.000Z',
      values: { statistics: { problemsSolved: 8 } },
      findings: [{ categoryId: 'problem_solving_dsa', displayName: 'DSA & Problem-Solving', weight: 25, source: 'leetcode', status: 'unavailable', metrics: {}, formula: 'Bounded solved-volume index; not a competency score.' }],
      limitations: ['Unofficial data source.'],
    },
  },
  resume: { id: 'a1328d63-3e22-448f-b719-1a76ecbaea0d', status: 'available', message: 'resume.pdf · Taylor Example', jobTitle: 'Backend Engineer', jobDescription: 'Build APIs', evaluatedAt: '2026-10-14T10:00:00.000Z', validatedScore: null, preliminaryScore: 67, statusLabel: 'insufficient_evidence', evidence: ['Built an API service'], limitations: ['Preliminary result is not validated.'] },
  linkableResumes: [],
});

function render(reportData: typeof report) {
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(UnifiedCandidateReportView, { report: reportData })));
}

describe('unified candidate report view', () => {
  it('shows a compact recruiter summary first and keeps evidence details expandable with PDF action', () => {
    const html = render(report);
    expect(html).toContain('Taylor Example');
    expect(html).toContain('taylor@example.com');
    expect(html).toContain('software developer');
    expect(html).toContain('Build accessible product experiences.');
    expect(html).toContain('ROLE CONTEXT');
    expect(html).toContain('FINAL CANDIDATE SUMMARY');
    expect(html).toContain('Final score');
    expect(html).toContain('Incomplete');
    expect(html).toContain('Evidence completion');
    expect(html).toContain('Strengths');
    expect(html).toContain('Development areas');
    expect(html).toContain('Detailed evaluation, resume evidence, and methodology');
    expect(html).toContain('class="unified-more-report unified-report-panel"');
    expect(html).toContain('Generate final assessment');
    expect(html).toContain('class="unified-report-context unified-report-panel"');
    expect(html).toContain('Candidate profile');
    expect(html).toContain('GitHub');
    expect(html).toContain('LeetCode');
    expect(html).toContain('Project Portfolio');
    expect(html).toContain('Technical Skills');
    expect(html).toContain('Development Activity');
    expect(html).toContain('Collaboration');
    expect(html).toContain('Current-Year Contributions');
    expect(html).toContain('Weight 20%');
    expect(html).toContain('Normalized public repository count, capped at 100');
    expect(html).toContain('Normalized public repository count, capped at 100; quantity proxy only.');
    expect((html.match(/class="unified-score-card"/g) ?? [])).toHaveLength(6);
    expect(html).toContain('Distinct Repository Languages');
    expect(html).toContain('unified-status-unavailable');
    expect(html).toContain('DSA &amp; Problem-Solving');
    expect(html).toContain('aria-valuenow=\"62\"');
    expect(html).toContain('No score assigned');
    expect((html.match(/role="progressbar"/g) ?? [])).toHaveLength(3);
    expect(html).toContain('Missing evidence');
    expect(html).toContain('Overall index withheld');
    expect(html).toContain('Missing or partial evidence remains unscored');
    expect(html).not.toContain('Overall index 67');
    expect(html).toContain('Preliminary match:');
    expect(html).toContain('67/100');
    expect(html).toContain('Download / Print PDF');
    expect(html).toContain('Evidence &amp; methodology');
    expect(html).toContain('Data reliability and freshness');
    expect(html).toContain('Evidence coverage');
    expect(html).toContain('GitHub repository coverage');
    expect(html).toContain('3 public repositories reported');
    expect(html).toContain('Scoring methodology');
    expect(html).toContain('Interpretation and limitations');
    expect(html).toContain('The public-only token scope is an operator configuration requirement.');
    expect(html).toContain(longSavedValue);
    expect(html).toContain('Identity is not verified.');
  });

  it('preserves explicit resume selection and provides the screening empty-state route', () => {
    const unlinkedReport = unifiedCandidateReportSchema.parse({
      ...report,
      resume: { ...report.resume, id: null, status: 'unlinked', message: 'No resume has been linked.' },
      linkableResumes: [{ id: '5a44e5c8-9c01-4d7c-a9d3-df34dd9a8c84', filename: 'resume.pdf', candidateName: 'Taylor Example', jobTitle: 'Backend Engineer', status: 'completed', scoreLabel: 'Validated', score: 76 }],
    });
    const withOptions = render(unlinkedReport);
    expect(withOptions).toContain('Attach a saved resume result');
    expect(withOptions).toContain('Choose a saved result');
    expect(withOptions).toContain('Attach result');

    const noResults = unifiedCandidateReportSchema.parse({ ...unlinkedReport, linkableResumes: [] });
    const emptyState = render(noResults);
    expect(emptyState).toContain('No unlinked screening results are available');
    expect(emptyState).toContain('href=\"/screening\"');
    expect(emptyState).toContain('Open Resume Screening');
  });

  it('keeps the linked score and detailed resume evidence without showing the replacement control', () => {
    const replaceable = unifiedCandidateReportSchema.parse({
      ...report,
      resume: { ...report.resume, id: 'a1328d63-3e22-448f-b719-1a76ecbaea0d', validatedScore: 82, preliminaryScore: null, statusLabel: 'complete' },
      linkableResumes: [{ id: '5a44e5c8-9c01-4d7c-a9d3-df34dd9a8c84', filename: 'new-resume.pdf', candidateName: 'Taylor Example', jobTitle: 'Backend Engineer', status: 'completed', scoreLabel: 'Validated', score: 91 }],
    });
    const html = render(replaceable);
    expect(html).toContain('Validated resume score: <strong>82/100</strong>');
    expect(html).not.toContain('Replace linked result');
    expect(html).not.toContain('Replace linked result with a completed saved resume');
  });

  it('labels component proportions as weights separately from the candidate score', () => {
    const data = unifiedCandidateReportSchema.parse({ ...report, assessment: {
      id: '1fa1c1bb-3c20-4b5c-ab53-437d8c616d28', candidateId: report.candidate.id, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
      scoringVersion: 'unified-1.0.0', status: 'insufficient_evidence', overallScore: null, weights: { resume: 40, github: 45, leetcode: 15 },
      components: {
        resume: { score: null, status: 'not_evaluated', sourceId: null, sourceLabel: null },
        github: { score: 0, status: 'validated', sourceId: null, sourceLabel: null },
        leetcode: { score: null, status: 'policy_only', sourceId: null, sourceLabel: null },
      },
      sourceReferences: { platformEvaluationId: null, resumeScreeningId: null, githubSnapshotIds: [], leetcodeSnapshotIds: [] }, evidenceCompleteness: 33,
      missingComponents: ['resume', 'leetcode'], strengths: [], improvementAreas: [], limitations: ['The linked resume evaluation targets a different job title and was excluded for this role.'], explanation: 'Only observed validated components contribute.',
    } });
    const html = render(data);
    expect(html).toContain('Resume · weight 40%');
    expect(html).toContain('Unavailable');
    expect(html).toContain('0/100');
    expect(html).toContain('Only observed validated components contribute.');
    expect(html).toContain('targets a different job title');
    expect(html).not.toContain('Resume · 40%');
  });
});
