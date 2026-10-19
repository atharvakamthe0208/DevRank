import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { aiAnalysisResponseSchema, buildFinalEvaluationReport, evaluationResponseSchema, evaluationRunResponseSchema, parseProposedPlatformEvidence, persistedEvaluationSchema, scoringCategories, type AiAnalysisResponse, type EvaluationRunResponse } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { AiAnalysisSummary, EvaluationRunResult } from './EvaluationPage';
import { AiAnalysisReportView } from './AiAnalysisReportPage';

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

function completedAnalysis(): AiAnalysisResponse {
  const run = runResult();
  const evidence = scoringCategories.map(({ id, displayName }) => ({ evidenceId: `evidence-${id}`, evidenceType: 'technical_screen' as const, source: 'Saved assessment', description: `Saved source evidence for ${displayName}.`, verificationStatus: 'verified' as const, categoryId: id, normalizedValue: 70, availability: 'available' as const }));
  const result = evaluationResponseSchema.parse({
    ...run.evaluation,
    overallScore: 78,
    evaluationStatus: 'completed',
    missingEvidence: [],
    finalReport: undefined,
    evidence,
    categoryScores: run.evaluation.categoryScores.map((item) => ({ ...item, score: 70, status: 'scored', evidenceRefs: [`evidence-${item.categoryId}`] })),
  });
  const evaluation = persistedEvaluationSchema.parse({ id: run.id, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'completed', createdAt: run.evaluatedAt, result });
  return aiAnalysisResponseSchema.parse({ status: 'completed', evaluation, analysis: {
    summary: 'The saved evidence shows experience across the listed source categories.', summaryEvidenceReferences: ['evidence-project_portfolio'],
    strengths: [1, 2, 3, 4].map((n) => ({ text: `Strength ${n} grounded in saved evidence.`, evidenceReferences: ['evidence-project_portfolio'] })),
    weaknesses: [{ text: 'The history is incomplete.', evidenceReferences: ['evidence-project_portfolio'] }],
    roleRelevance: 'The evidence relates to the selected role.', roleRelevanceEvidenceReferences: ['evidence-project_portfolio'],
    recommendations: [{ text: 'Review the cited source detail.', evidenceReferences: ['evidence-project_portfolio'] }],
  } });
}

describe('evaluation run result', () => {
  it('shows the finalized v4 category result from the saved snapshot', () => {
    const html = renderToStaticMarkup(createElement(EvaluationRunResult, {
      result: runResult(), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    }));

    expect(html).toContain('Evaluation report');
    expect(html).not.toContain('Final GitHub + LeetCode evaluation report');
    expect(html).not.toContain('Communication Skills');
    expect(html).toContain('DSA &amp; Problem-Solving');
    expect(html).toContain('100 / 100');
    expect(html).toContain('Overall score');
    expect(html).toContain('Insufficient evidence');
    expect(html).not.toContain('out of 100</small>');
    expect(html).toContain('Problems solved');
    expect(html).toContain('LeetCode statistics provider');
    expect(html).not.toContain('alfa_leetcode_api');
    expect(html).not.toContain('{&quot;statistics&quot;');
  });

  it('keeps final rubric categories unscored when the run has no saved platform evidence', () => {
    const html = renderToStaticMarkup(createElement(EvaluationRunResult, {
      result: runResult(false), analysis: null, analysisLoading: false, analysisError: '', onAnalyze: () => undefined,
    }));

    expect(html).toContain('Evaluation report');
    expect(html).not.toContain('Final GitHub + LeetCode evaluation report');
    expect(html).toContain('Not scored');
    expect(html).not.toContain('Communication Skills');
    expect(html).toContain('Insufficient evidence');
  });

  it('shows a concise cited summary with a route to the detailed report', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisSummary, { response: completedAnalysis() })));
    expect(html).toContain('Executive summary');
    expect(html).toContain('Evidence-backed strengths');
    expect(html).toContain('Evidence gaps');
    expect(html).toContain('Strength 3 grounded in saved evidence.');
    expect(html).not.toContain('Strength 4 grounded in saved evidence.');
    expect(html).toContain('Read full AI report');
    expect(html).toContain('/evaluations/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/analysis');
    expect(html).toContain('Supporting references (1)');
  });

  it('shows a neutral insufficient-evidence summary and keeps the full report link', () => {
    const run = runResult(false);
    const evaluation = persistedEvaluationSchema.parse({ id: run.id, candidateId, roleProfileId: null, targetRole: 'software_developer', status: 'insufficient_evidence', createdAt: run.evaluatedAt, result: run.evaluation });
    const response = aiAnalysisResponseSchema.parse({ status: 'insufficient_evidence', evaluation, analysis: null });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisSummary, { response })));
    expect(html).toContain('AI analysis is unavailable');
    expect(html).toContain('Open evaluation report');
    expect(html).not.toContain('0 / 100');
  });

  it('keeps the AI explanation separate from the saved report and avoids repeating category results', () => {
    const response = completedAnalysis();
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, { response, candidateName: 'Candidate Example' })));
    expect(html).toContain('SAVED EVALUATION');
    expect(html).toContain('78 / 100');
    expect(html).not.toContain('Category results');
    expect(html).toContain('View six category results');
    expect(html).toContain('AI SUMMARY');
    expect(html).toContain('Role relevance');
    expect(html).toContain('Strength 1 grounded in saved evidence.');
    expect(html).toContain('The history is incomplete.');
    expect(html).toContain('AI text below is explanatory only. It does not calculate or change scores.');
    expect(html).toContain('Supporting references (1)');
    expect(html).not.toContain('<details class="ai-report-observation" open');
  });

  it('keeps the saved deterministic result visible when the on-demand AI explanation fails', () => {
    const response = completedAnalysis();
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(AiAnalysisReportView, {
      evaluation: response.evaluation, candidateName: 'Candidate Example', analysisError: 'AI analysis is temporarily unavailable.',
    })));
    expect(html).toContain('78 / 100');
    expect(html).toContain('AI analysis is temporarily unavailable.');
    expect(html).toContain('View six category results');
    expect(html).toContain('Try again');
  });
});
