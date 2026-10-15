import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { candidateSchema, evaluationResponseSchema, persistedEvaluationSchema, scoringCategories, type EvaluationResponse, type PersistedEvaluation } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { EvaluationResults } from './EvaluationResults';

const candidate = candidateSchema.parse({ id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Test Candidate', email: 'test@example.com', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' });
const weights = { technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22, practical_assessment_performance: 16.67, learning_adaptability: 11.11 };

function evaluation(complete: boolean): PersistedEvaluation & { result: EvaluationResponse } {
  const evidence = scoringCategories.map((category, index) => ({ evidenceId: `evidence-${index}`, evidenceType: 'technical_screen' as const, source: `Assessment ${index + 1}`, description: `Evidence for ${category.displayName}`, verificationStatus: 'verified' as const, categoryId: category.id, normalizedValue: 80 + index, availability: 'available' as const }));
  const categoryScores = scoringCategories.map((category, index) => ({ categoryId: category.id, displayName: category.displayName, ...(complete || index < 2 ? { score: 80 + index, status: 'scored' as const, evidenceRefs: [`evidence-${index}`] } : { status: 'insufficient_evidence' as const, evidenceRefs: [] }), explanation: complete || index < 2 ? `Score for ${category.displayName}.` : `No normalized evidence for ${category.displayName}.` }));
  const result = evaluationResponseSchema.parse({
    schemaVersion: '2.0.0', scoringVersion: '2.0.0', candidateId: candidate.id, targetRole: 'software_developer',
    ...(complete ? { overallScore: 83.45 } : {}), categoryScores, roleWeightsUsed: weights,
    evidence: complete ? evidence : evidence.slice(0, 2), confidence: 0.8, strengths: [], skillGaps: [], recommendations: [],
    missingEvidence: complete ? [] : scoringCategories.slice(2).map(({ id }) => id),
    calculationExplanation: complete ? 'Weighted score calculated from all five categories.' : 'No overall score until all categories are available.',
    evaluationStatus: complete ? 'completed' : 'insufficient_evidence',
    aiExplanation: { summary: 'Legacy compatibility summary.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  });
  const persisted = persistedEvaluationSchema.parse({ id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: candidate.id, roleProfileId: 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084', targetRole: 'software_developer', status: result.evaluationStatus, createdAt: '2026-10-14T01:00:00.000Z', result });
  return { ...persisted, result: evaluationResponseSchema.parse(persisted.result) };
}

describe('evaluation result view', () => {
  it('renders all five active categories, real scores, progress indicators, and deterministic overall score', () => {
    const saved = evaluation(true);
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result: saved.result } }));
    for (const label of ['Technical Skills', 'Problem-Solving / DSA', 'Relevant Project Experience', 'Practical Assessment Performance', 'Learning &amp; Adaptability']) expect(html).toContain(label);
    expect(html).toContain('83.45');
    expect(html.match(/<progress/g)).toHaveLength(5);
    expect(html).not.toContain('Communication Skills');
    expect(html).not.toContain('AI evidence summary');
  });

  it('shows missing evidence without a zero score or false overall result', () => {
    const saved = evaluation(false);
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result: saved.result } }));
    expect(html).toContain('Insufficient Evidence');
    expect(html).toContain('Evidence needed');
    expect(html).toContain('Not calculated');
    expect(html.match(/<progress/g)).toHaveLength(2);
    expect(html).toContain('Not scored');
    expect(html).not.toContain('OVERALL SCORE</span><strong class="evaluation-overall-score">0');
  });
});
