import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  candidateInputSchema, categoryScoreSchema, confidenceSchema, evaluationResponseSchema,
  evidenceSchema, legacyEvaluationResponseV1Schema, roleWeightConfigurationSchema, roleWeightsSchema, scoreSchema, scoringCategories,
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
    schemaVersion: '2.0.0', scoringVersion: '2.0.0', candidateId: candidate.candidateId, targetRole: candidate.targetRole,
    ...(overallScore !== undefined ? { overallScore } : {}), categoryScores, roleWeightsUsed: parsedWeights,
    evidence, ...(missingEvidence.length === 0 ? { confidence: 0.8 } : {}), strengths: [], skillGaps: [], recommendations: [], missingEvidence,
    calculationExplanation: 'Weighted sum of available normalized category scores; overall score is omitted until all five categories have evidence.',
    evaluationStatus: insufficient || missingEvidence.length > 0 ? 'insufficient_evidence' as const : 'completed' as const,
    aiExplanation: { summary: 'Synthetic contract example.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.' as const,
  };
}

describe('shared candidate evaluation contracts', () => {
  it('defines exactly five scoring categories and excludes communication_skills', () => {
    expect(scoringCategories).toHaveLength(5);
    expect(scoringCategories.some(({ id }) => id === 'communication_skills')).toBe(false);
    expect(evidenceSchema.safeParse({ evidenceId: 'interview', evidenceType: 'structured_interview', source: 'test', description: 'Interview', normalizedValue: 80, verificationStatus: 'unverified', categoryId: 'communication_skills', availability: 'available' }).success).toBe(false);
  });
  it('validates all role weights as nonnegative and totaling 100%', () => {
    const config = roleWeightConfigurationSchema.parse(roleWeights);
    expect(Object.keys(config.roles)).toHaveLength(3);
    for (const weights of Object.values(config.roles)) expect(Math.round(Object.values(weights).reduce((sum, value) => sum + value, 0) * 100) / 100).toBe(100);
  });
  it('rejects invalid totals and negative weights', () => {
    expect(roleWeightsSchema.safeParse({ technical_skills: 10, problem_solving_dsa: 10, relevant_project_experience: 10, practical_assessment_performance: 10, learning_adaptability: 10 }).success).toBe(false);
    expect(roleWeightsSchema.safeParse({ technical_skills: -1, problem_solving_dsa: 25.25, relevant_project_experience: 25.25, practical_assessment_performance: 25.25, learning_adaptability: 25.25 }).success).toBe(false);
    expect(roleWeightsSchema.safeParse({ technical_skills: 20, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 20, learning_adaptability: 20, communication_skills: 0 }).success).toBe(false);
  });
  it('enforces score and confidence ranges', () => {
    for (const value of [-0.1, 100.1, Number.NaN]) expect(scoreSchema.safeParse(value).success).toBe(false);
    for (const value of [-0.01, 1.01, Number.NaN]) expect(confidenceSchema.safeParse(value).success).toBe(false);
  });
  it('represents missing evidence without a fabricated normalized score', () => {
    const missing = { evidenceId: 'missing', evidenceType: 'project', source: 'Not collected', description: 'No sample supplied', verificationStatus: 'unverified', categoryId: 'relevant_project_experience', availability: 'missing' };
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
      expect(actual.scoringVersion).toBe(outcome.scoringVersion);
      expect(actual.evaluationStatus).toBe(outcome.evaluationStatus);
      expect(actual.overallScore).toBe(outcome.overallScore);
      expect(Object.fromEntries(actual.categoryScores.filter((item) => item.score !== undefined).map((item) => [item.categoryId, item.score]))).toEqual(outcome.categoryScores);
      expect(actual.missingEvidence).toEqual(outcome.missingEvidence ?? []);
    }
  });

  it('keeps historical v1 evaluation snapshots readable without accepting their category in active scoring', () => {
    const candidate = candidates[0] as Record<string, any>;
    const current = responseFor(candidate) as Record<string, any>;
    const interview = {
      evidenceId: 'legacy-interview', evidenceType: 'structured_interview', source: 'Historical snapshot',
      description: 'Historical interview rubric', normalizedValue: 80, verificationStatus: 'unverified',
      categoryId: 'communication_skills', availability: 'available',
    };
    const historical = {
      ...current,
      schemaVersion: '1.0.0', scoringVersion: '1.0.0',
      overallScore: 78.1,
      categoryScores: [
        ...current.categoryScores,
        { categoryId: 'communication_skills', displayName: 'Communication Skills', score: 80, status: 'scored', evidenceRefs: ['legacy-interview'], explanation: 'Historical snapshot.' },
      ],
      roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
      evidence: [...current.evidence, interview],
    };
    expect(legacyEvaluationResponseV1Schema.safeParse(historical).success).toBe(true);
    expect(evaluationResponseSchema.safeParse(historical).success).toBe(false);
  });
});
