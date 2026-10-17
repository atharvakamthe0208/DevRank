import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFinalEvaluationReport, evaluationRunResponseSchema, parseProposedPlatformEvidence, scoringCategories, type EvaluationRunResponse } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { EvaluationRunResult } from './EvaluationPage';

const candidateId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roleWeightsUsed = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

function runResult(withLeetCodeEvidence = true): EvaluationRunResponse {
  const platformEvidence = withLeetCodeEvidence ? [{
    evidenceId: 'saved-leetcode-row',
    candidateId,
    source: 'leetcode' as const,
    evidenceType: 'solved_statistics' as const,
    availability: 'available' as const,
    observedAt: '2026-10-17T10:00:00.000Z',
    normalizedValue: { statistics: { problemsSolved: 208, easySolved: 100, mediumSolved: 92, hardSolved: 16 } },
    verificationStatus: 'unverified' as const,
    provenance: 'alfa_leetcode_api' as const,
    freshness: 'unassessed' as const,
    limitations: ['Provider statistics are informational and do not verify identity.'],
    categoryMappings: [{ rubricId: 'github_leetcode_v4' as const, categoryId: 'problem_solving_dsa' as const, relation: 'supporting' as const }],
  }] : [];
  return evaluationRunResponseSchema.parse({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    status: 'insufficient_evidence',
    candidate: { id: candidateId, name: 'Candidate Example' },
    role: { id: 'software_developer', displayName: 'Software Developer', weights: roleWeightsUsed },
    evaluatedAt: '2026-10-17T10:00:00.000Z',
    evaluation: {
      schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId, targetRole: 'software_developer',
      categoryScores: scoringCategories.map(({ id, displayName }) => ({ categoryId: id, displayName, ...(withLeetCodeEvidence && id === 'problem_solving_dsa' ? { score: 100, status: 'scored' as const, evidenceRefs: ['index:dsa'] } : { status: 'insufficient_evidence' as const, evidenceRefs: [] }), explanation: withLeetCodeEvidence && id === 'problem_solving_dsa' ? 'LeetCode v4 difficulty-weighted solved-volume index.' : 'No sufficient source evidence was supplied.' })),
      roleWeightsUsed, evidence: withLeetCodeEvidence ? [{ evidenceId: 'index:dsa', evidenceType: 'coding_assessment', source: 'alfa_leetcode_api', description: 'Saved LeetCode difficulty-weighted index.', normalizedValue: 100, verificationStatus: 'unverified', categoryId: 'problem_solving_dsa', availability: 'available' }] : [], platformEvidence, finalReport: buildFinalEvaluationReport(parseProposedPlatformEvidence(platformEvidence)), strengths: [], skillGaps: [], recommendations: [],
      missingEvidence: scoringCategories.filter(({ id }) => !withLeetCodeEvidence || id !== 'problem_solving_dsa').map(({ id }) => id),
      calculationExplanation: 'No overall active score is calculated until all categories have sufficient source evidence.',
      evaluationStatus: 'insufficient_evidence',
      aiExplanation: { summary: 'Evidence is insufficient.', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    },
    evidenceLimitations: ['Active evaluation evidence is incomplete.'],
  });
}

describe('evaluation run result', () => {
  it('shows the finalized v4 category result from the saved snapshot', () => {
    const html = renderToStaticMarkup(createElement(EvaluationRunResult, {
      result: runResult(), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    }));

    expect(html).toContain('Final GitHub + LeetCode rubric · v4');
    expect(html).not.toContain('Communication Skills');
    expect(html).toContain('DSA &amp; Problem-Solving');
    expect(html).toContain('100 / 100');
    expect(html).toContain('332');
    expect(html).toContain('100 / 100');
    expect(html).toContain('LeetCode v4 difficulty-weighted solved-volume index');
    expect(html).toContain('Overall score');
    expect(html).toContain('Insufficient evidence');
    expect(html).not.toContain('out of 100</small>');
  });

  it('keeps final rubric categories unscored when the run has no saved platform evidence', () => {
    const html = renderToStaticMarkup(createElement(EvaluationRunResult, {
      result: runResult(false), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    }));

    expect(html).toContain('Final GitHub + LeetCode rubric · v4');
    expect(html).toContain('Not scored');
    expect(html).not.toContain('Communication Skills');
    expect(html).toContain('Insufficient evidence');
  });
});
