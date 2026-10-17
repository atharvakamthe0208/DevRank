import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { candidateSchema, evaluationResponseSchema, persistedEvaluationReadSchema, persistedEvaluationSchema, scoringCategories, type EvaluationResponse, type PersistedEvaluation, type PersistedEvaluationRead } from '@devrank/contracts';
import { describe, expect, it } from 'vitest';
import { EvaluationResults } from './EvaluationResults';
import { LegacyEvaluationResults } from './LegacyEvaluationResults';

const candidate = candidateSchema.parse({ id: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c', name: 'Test Candidate', email: 'test@example.com', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' });
const weights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

function evaluation(complete: boolean): PersistedEvaluation & { result: EvaluationResponse } {
  const evidence = scoringCategories.map((category, index) => ({ evidenceId: `evidence-${index}`, evidenceType: 'technical_screen' as const, source: `Assessment ${index + 1}`, description: `Evidence for ${category.displayName}`, verificationStatus: 'verified' as const, categoryId: category.id, normalizedValue: 80 + index, availability: 'available' as const }));
  const categoryScores = scoringCategories.map((category, index) => ({ categoryId: category.id, displayName: category.displayName, ...(complete || index < 2 ? { score: 80 + index, status: 'scored' as const, evidenceRefs: [`evidence-${index}`] } : { status: 'insufficient_evidence' as const, evidenceRefs: [] }), explanation: complete || index < 2 ? `Score for ${category.displayName}.` : `No normalized evidence for ${category.displayName}.` }));
  const result = evaluationResponseSchema.parse({
    schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId: candidate.id, targetRole: 'software_developer',
    ...(complete ? { overallScore: 83.45 } : {}), categoryScores, roleWeightsUsed: weights,
    evidence: complete ? evidence : evidence.slice(0, 2), confidence: 0.8, strengths: [], skillGaps: [], recommendations: [],
    missingEvidence: complete ? [] : scoringCategories.slice(2).map(({ id }) => id),
    calculationExplanation: complete ? 'Weighted score calculated from all six categories.' : 'No overall score until all categories are available.',
    evaluationStatus: complete ? 'completed' : 'insufficient_evidence',
    aiExplanation: { summary: 'Legacy compatibility summary.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  });
  const persisted = persistedEvaluationSchema.parse({ id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: candidate.id, roleProfileId: 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084', targetRole: 'software_developer', status: result.evaluationStatus, createdAt: '2026-10-14T01:00:00.000Z', result });
  return { ...persisted, result: evaluationResponseSchema.parse(persisted.result) };
}

describe('evaluation result view', () => {
  it('renders all six active v4 categories, scores, progress indicators, and deterministic overall score', () => {
    const saved = evaluation(true);
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result: saved.result } }));
    for (const label of ['Project Portfolio', 'Technical Skills', 'Development Activity', 'Collaboration', 'Current-Year Contributions', 'DSA &amp; Problem-Solving']) expect(html).toContain(label);
    expect(html).toContain('83.45');
    expect(html).toContain('Active GitHub + LeetCode evaluation');
    expect(html).toContain('Final v4 GitHub + LeetCode rubric');
    expect(html.match(/<progress/g)).toHaveLength(6);
    expect(html).not.toContain('AI evidence summary');
    expect(html).toContain('Project Portfolio');
    expect(html).toContain('data-category="project_portfolio"');
    expect(html).not.toContain('Communication Skills');
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

  it('labels proposal-only platform context without adding categories or scores', () => {
    const saved = evaluation(true);
    const result = evaluationResponseSchema.parse({ ...saved.result, platformEvidence: [{
      evidenceId: 'github-row:current-year', candidateId: candidate.id, source: 'github', evidenceType: 'current_year_contributions',
      availability: 'partial', observedAt: '2026-10-14T12:00:00.000Z', normalizedValue: { year: 2026, timezone: 'UTC', totalContributions: 44 },
      verificationStatus: 'unverified', provenance: 'github_api', freshness: 'unassessed',
      limitations: ['Contribution volume does not establish engineering competence.'],
      categoryMappings: [{ rubricId: 'github_leetcode_v4', categoryId: 'current_year_contributions', relation: 'supporting' }],
    }] });
    const html = renderToStaticMarkup(createElement(EvaluationResults, { candidate, evaluation: { ...saved, result } }));
    expect(html).toContain('Current-Year Contributions');
    expect(html).toContain('Current-Year Contributions; no additional score is inferred');
    expect(html).toContain('44');
    expect(html).toContain('Current-Year Contributions');
    expect(html).toContain('44');
    expect(html).toContain('Overall score');
    expect(html.match(/<progress/g)).toHaveLength(6);
    expect(html).toContain('83.45');
  });

  it('renders validated v1 history with all six original categories and no recalculated score', () => {
    const categories = ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'] as const;
    const historical: PersistedEvaluationRead = {
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: candidate.id, roleProfileId: null,
      targetRole: 'software_developer', status: 'completed', createdAt: '2026-10-12T00:00:00.000Z',
      result: {
        schemaVersion: '1.0.0', candidateId: candidate.id, targetRole: 'software_developer',
        categoryScores: categories.map((categoryId) => ({ categoryId, displayName: categoryId === 'communication_skills' ? 'Communication Skills' : categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical evidence was insufficient.' })),
        roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
        evidence: [], strengths: [], skillGaps: [], recommendations: [], missingEvidence: [...categories],
        calculationExplanation: 'No overall score was stored.', evaluationStatus: 'insufficient_evidence',
        aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
        decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
      },
    };
    const html = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: historical as Exclude<PersistedEvaluationRead, PersistedEvaluation> }));
    expect(html).toContain('Historical scoring format');
    expect(html).toContain('Communication Skills');
    expect(html).toContain('Not calculated');
    expect(html.match(/class="evaluation-category-card"/g)).toHaveLength(6);
    expect(html).not.toContain('<progress');

    const v3Historical = persistedEvaluationReadSchema.parse({ ...historical, result: { ...historical.result, schemaVersion: '3.0.0', scoringVersion: '3.0.0' } });
    const v3Html = renderToStaticMarkup(createElement(LegacyEvaluationResults, { candidate, evaluation: v3Historical as Exclude<PersistedEvaluationRead, PersistedEvaluation> }));
    expect(v3Html).toContain('HISTORICAL EVALUATION · V3');
    expect(v3Html).toContain('Communication Skills');
    expect(v3Html).not.toContain('Final GitHub + LeetCode evaluation report');
  });
});
