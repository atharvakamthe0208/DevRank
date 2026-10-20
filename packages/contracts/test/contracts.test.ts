import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateInputSchema, categoryScoreSchema, confidenceSchema, evaluationResponseSchema,
  evidenceSchema, legacyEvaluationResponseV1Schema, previousEvaluationResponseV2Schema, roleWeightConfigurationSchema, roleWeightsSchema, scoreSchema, scoringCategories,
  persistedEvaluationReadSchema,
  proposedRubric,
  proposedRubricSchema,
  finalRubric,
  finalRubricSchema,
  previousEvaluationResponseV3Schema,
} from '../src/index.js';

const roleWeights = JSON.parse(readFileSync(new URL('../../../config/role-weights.json', import.meta.url), 'utf8')) as unknown;
const candidates = JSON.parse(readFileSync(new URL('../../../fixtures/dummy-candidates.json', import.meta.url), 'utf8')) as unknown[];
const expected = JSON.parse(readFileSync(new URL('../../../fixtures/expected-evaluations.json', import.meta.url), 'utf8')) as Array<{ candidateId: string; targetRole: string; evaluationStatus: string; overallScore?: number; categoryScores: Record<string, number>; missingEvidence?: string[] }>;

function responseFor(candidate: Record<string, any>, insufficient = false) {
  const parsedWeights = roleWeightConfigurationSchema.parse(roleWeights).roles[candidate.targetRole];
  const evidence = candidate.evidence as Array<Record<string, any>>;
  const categoryScores = scoringCategories.map((category) => {
    const item = evidence.find((entry) => entry.categoryId === category.id && entry.availability === 'available' && entry.normalizedValue !== undefined);
    return item
      ? { categoryId: category.id, displayName: category.displayName, score: item.normalizedValue, confidence: 0.8, status: 'scored' as const, evidenceRefs: [item.evidenceId], explanation: `Synthetic evidence supports ${category.displayName}.` }
      : { categoryId: category.id, displayName: category.displayName, status: 'insufficient_evidence' as const, evidenceRefs: [], explanation: `No evidence supplied for ${category.displayName}.` };
  });
  const missingEvidence = categoryScores.filter((item) => item.status === 'insufficient_evidence').map((item) => item.categoryId);
  const overallScore = missingEvidence.length === 0
    ? Number((categoryScores.reduce((sum, item) => sum + (item.score ?? 0) * parsedWeights[item.categoryId], 0) / 100).toFixed(2))
    : undefined;
  return {
    schemaVersion: '4.0.0', scoringVersion: '4.0.0', candidateId: candidate.candidateId, targetRole: candidate.targetRole,
    ...(overallScore !== undefined ? { overallScore } : {}), categoryScores, roleWeightsUsed: parsedWeights,
    evidence, ...(missingEvidence.length === 0 ? { confidence: 0.8 } : {}), strengths: [], skillGaps: [], recommendations: [], missingEvidence,
    calculationExplanation: 'Weighted sum of normalized category scores; overall score is omitted until all six categories have evidence.',
    evaluationStatus: insufficient || missingEvidence.length > 0 ? 'insufficient_evidence' as const : 'completed' as const,
    aiExplanation: { summary: 'Synthetic contract example.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.' as const,
  };
}

describe('shared candidate evaluation contracts', () => {
  it('defines the canonical six active GitHub and LeetCode categories', () => {
    expect(scoringCategories.map(({ id }) => id)).toEqual(['project_portfolio', 'technical_skills', 'development_activity', 'collaboration', 'current_year_contributions', 'problem_solving_dsa']);
    expect(evidenceSchema.safeParse({ evidenceId: 'github', evidenceType: 'portfolio', source: 'GitHub', description: 'Repository evidence', normalizedValue: 80, verificationStatus: 'unverified', categoryId: 'project_portfolio', availability: 'available' }).success).toBe(true);
  });
  it('activates the reviewed GitHub/LeetCode taxonomy for v4 while retaining the earlier proposal metadata', () => {
    expect(proposedRubric.status).toBe('proposed');
    expect(proposedRubric.timezone).toBe('UTC');
    expect(proposedRubric.categories.map(({ id, displayName, proposedWeight, source }) => [id, displayName, proposedWeight, source])).toEqual([
      ['project_portfolio', 'Project Portfolio', 20, 'github'],
      ['technical_skills', 'Technical Skills', 20, 'github'],
      ['development_activity', 'Development Activity', 15, 'github'],
      ['collaboration', 'Collaboration', 10, 'github'],
      ['current_year_contributions', 'Current-Year Contributions', 10, 'github'],
      ['problem_solving_dsa', 'DSA & Problem-Solving', 25, 'leetcode'],
    ]);
    expect(proposedRubricSchema.safeParse({ ...proposedRubric, status: 'active' }).success).toBe(false);
    expect(proposedRubricSchema.safeParse({ ...proposedRubric, categories: [proposedRubric.categories[0], ...proposedRubric.categories.slice(0, 5)] }).success).toBe(false);
    expect(finalRubric.status).toBe('active');
    expect(finalRubric.id).toBe('github_leetcode_v4');
    expect(finalRubricSchema.safeParse(finalRubric).success).toBe(true);
    expect(finalRubric.categories.map(({ id, weight }) => [id, weight])).toEqual(proposedRubric.categories.map(({ id, proposedWeight }) => [id, proposedWeight]));
    expect(scoringCategories.map(({ id }) => id)).not.toContain('communication_skills');
    expect(scoringCategories.map(({ id }) => id)).toContain('current_year_contributions');
  });
  it('validates all role weights as nonnegative and totaling 100%', () => {
    const config = roleWeightConfigurationSchema.parse(roleWeights);
    expect(Object.keys(config.roles)).toHaveLength(3);
    for (const weights of Object.values(config.roles)) expect(Math.round(Object.values(weights).reduce((sum, value) => sum + value, 0) * 100) / 100).toBe(100);
  });
  it('rejects invalid totals and negative weights', () => {
    expect(roleWeightsSchema.safeParse({ technical_skills: 10, problem_solving_dsa: 10, relevant_project_experience: 10, practical_assessment_performance: 10, communication_skills: 10, learning_adaptability: 10 }).success).toBe(false);
    expect(roleWeightsSchema.safeParse({ technical_skills: -1, problem_solving_dsa: 20.2, relevant_project_experience: 20.2, practical_assessment_performance: 20.2, communication_skills: 20.2, learning_adaptability: 20.2 }).success).toBe(false);
    expect(roleWeightsSchema.safeParse({ technical_skills: 20, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 20, learning_adaptability: 20 }).success).toBe(false);
  });
  it('enforces score and confidence ranges', () => {
    for (const value of [-0.1, 100.1, Number.NaN]) expect(scoreSchema.safeParse(value).success).toBe(false);
    for (const value of [-0.01, 1.01, Number.NaN]) expect(confidenceSchema.safeParse(value).success).toBe(false);
  });
  it('represents missing evidence without a fabricated normalized score', () => {
    const missing = { evidenceId: 'missing', evidenceType: 'portfolio', source: 'Not collected', description: 'No platform snapshot supplied', verificationStatus: 'unverified', categoryId: 'project_portfolio', availability: 'missing' };
    expect(evidenceSchema.safeParse(missing).success).toBe(true);
    expect(evidenceSchema.safeParse({ ...missing, normalizedValue: 0 }).success).toBe(false);
  });
  it('accepts candidate inputs and valid completed evaluation responses', () => {
    const candidate = candidates[0] as Record<string, any>;
    expect(candidateInputSchema.safeParse(candidate).success).toBe(true);
    expect(evaluationResponseSchema.safeParse(responseFor(candidate)).success).toBe(true);
    expect(categoryScoreSchema.safeParse({ categoryId: 'technical_skills', displayName: 'Technical Skills', status: 'insufficient_evidence', score: 0, evidenceRefs: [], explanation: 'Missing.' }).success).toBe(false);
  });
  it('accepts legacy responses without scoringVersion and validates the optional version format', () => {
    const candidate = candidates[0] as Record<string, any>;
    const response = responseFor(candidate);
    const { scoringVersion: _version, ...legacyResponse } = response;
    expect(evaluationResponseSchema.safeParse(legacyResponse).success).toBe(true);
    expect(evaluationResponseSchema.safeParse({ ...response, scoringVersion: 'not-a-version' }).success).toBe(false);
  });
  it('rejects malformed outputs and keeps insufficient evaluations scoreless', () => {
    const incomplete = responseFor(candidates[4] as Record<string, any>);
    expect(incomplete.evaluationStatus).toBe('insufficient_evidence');
    expect(evaluationResponseSchema.safeParse(incomplete).success).toBe(true);
    expect(evaluationResponseSchema.safeParse({ ...incomplete, overallScore: 0 }).success).toBe(false);
    expect(evaluationResponseSchema.safeParse({ ...incomplete, categoryScores: [] }).success).toBe(false);
  });
  it('loads and validates all deterministic synthetic fixtures against expected outcomes', () => {
    expect(candidates).toHaveLength(5);
    expect(expected).toHaveLength(5);
    for (const candidate of candidates) expect(candidateInputSchema.safeParse(candidate).success).toBe(true);
    for (const outcome of expected) {
      const candidate = candidates.find((item) => (item as Record<string, any>).candidateId === outcome.candidateId) as Record<string, any>;
      const actual = responseFor(candidate);
      expect(actual.targetRole).toBe(outcome.targetRole);
      expect(actual.scoringVersion).toBe('4.0.0');
      expect(actual.evaluationStatus).toBe(outcome.evaluationStatus);
      expect(Object.fromEntries(actual.categoryScores.filter((item) => item.score !== undefined).map((item) => [item.categoryId, item.score]))).toEqual(outcome.categoryScores);
      if (actual.overallScore !== undefined) expect(actual.overallScore).toBe(Number((actual.categoryScores.reduce((sum, item) => sum + (item.score ?? 0) * actual.roleWeightsUsed[item.categoryId], 0) / 100).toFixed(2)));
      expect([...actual.missingEvidence].sort()).toEqual([...(outcome.missingEvidence ?? [])].sort());
    }
  });

  it('keeps historical v1 and previous v2 snapshots readable without recalculation', () => {
    const oldIds = ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'communication_skills', 'learning_adaptability'];
    const oldWeights = { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 };
    const historical = {
      schemaVersion: '1.0.0', scoringVersion: '1.0.0', candidateId: 'candidate-a', targetRole: 'software_developer',
      categoryScores: oldIds.map((categoryId) => ({ categoryId, displayName: categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical result.' })),
      roleWeightsUsed: oldWeights, evidence: [], strengths: [], skillGaps: [], recommendations: [], missingEvidence: oldIds,
      calculationExplanation: 'Historical score omitted.', evaluationStatus: 'insufficient_evidence',
      aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    };
    expect(legacyEvaluationResponseV1Schema.safeParse(historical).success).toBe(true);
    expect(evaluationResponseSchema.safeParse(historical).success).toBe(false);
    const { scoringVersion: _legacyVersion, ...legacyWithoutVersion } = historical;
    expect(persistedEvaluationReadSchema.safeParse({
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
      roleProfileId: null, targetRole: historical.targetRole, status: historical.evaluationStatus,
      createdAt: '2026-10-12T00:00:00.000Z', result: legacyWithoutVersion,
    }).success).toBe(true);

    const v2Ids = oldIds.filter((id) => id !== 'communication_skills');
    const previousV2 = {
      schemaVersion: '2.0.0', scoringVersion: '2.0.0', candidateId: 'candidate-a', targetRole: 'software_developer',
      categoryScores: v2Ids.map((categoryId) => ({ categoryId, displayName: categoryId, status: 'insufficient_evidence', evidenceRefs: [], explanation: 'Historical result.' })),
      evidence: [], roleWeightsUsed: { technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22, practical_assessment_performance: 16.67, learning_adaptability: 11.11 },
      strengths: [], skillGaps: [], recommendations: [], missingEvidence: v2Ids, calculationExplanation: 'Historical score omitted.',
      evaluationStatus: 'insufficient_evidence', aiExplanation: { summary: '', strengths: [], skillGaps: [], recommendations: [] },
      decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
    };
    expect(previousEvaluationResponseV2Schema.safeParse(previousV2).success).toBe(true);
    expect(persistedEvaluationReadSchema.safeParse({
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
      roleProfileId: null, targetRole: previousV2.targetRole, status: previousV2.evaluationStatus,
      createdAt: '2026-10-12T00:00:00.000Z', result: previousV2,
    }).success).toBe(true);

    const v3 = { ...historical, schemaVersion: '3.0.0', scoringVersion: '3.0.0' };
    expect(previousEvaluationResponseV3Schema.safeParse(v3).success).toBe(true);
    expect(persistedEvaluationReadSchema.safeParse({
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId: 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c',
      roleProfileId: null, targetRole: 'software_developer', status: 'insufficient_evidence',
      createdAt: '2026-10-12T00:00:00.000Z', result: v3,
    }).success).toBe(true);
  });
});
