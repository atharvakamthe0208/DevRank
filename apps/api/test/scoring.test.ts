import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluationResponseSchema, roleWeightConfigurationSchema, scoringCategories } from '@devrank/contracts';
import { loadRoleWeightConfiguration, scoreCandidate, ScoringValidationError } from '../src/modules/scoring/index.js';

const candidates = JSON.parse(readFileSync(new URL('../../../fixtures/dummy-candidates.json', import.meta.url), 'utf8')) as Array<Record<string, any>>;
const expected = JSON.parse(readFileSync(new URL('../../../fixtures/expected-evaluations.json', import.meta.url), 'utf8')) as Array<Record<string, any>>;
const sharedWeights = loadRoleWeightConfiguration();

function candidate(index = 0): Record<string, any> {
  return structuredClone(candidates[index]);
}

function allCategoriesWithScore(score: number, role = 'software_developer') {
  const input = candidate(0);
  input.targetRole = role;
  input.evidence = scoringCategories.map(({ id }, index) => ({
    evidenceId: `boundary-${index}`,
    evidenceType: 'other',
    source: 'Synthetic boundary test',
    description: 'Deterministic test evidence',
    normalizedValue: score,
    verificationStatus: 'unverified',
    categoryId: id,
    availability: 'available',
  }));
  return input;
}

describe('deterministic candidate scoring', () => {
  it('scores the five shared fixtures and matches expected results', () => {
    expect(candidates).toHaveLength(5);
    for (const outcome of expected) {
      const input = candidates.find(({ candidateId }) => candidateId === outcome.candidateId)!;
      const output = scoreCandidate(input);
      expect(output.evaluationStatus).toBe(outcome.evaluationStatus);
      expect(output.overallScore).toBe(outcome.overallScore);
      expect(Object.fromEntries(output.categoryScores.filter(({ score }) => score !== undefined).map(({ categoryId, score }) => [categoryId, score]))).toEqual(outcome.categoryScores);
      expect(output.missingEvidence).toEqual(outcome.missingEvidence ?? []);
    }
  });

  it('averages multiple normalized values in the same category', () => {
    const input = candidate();
    input.evidence.push({
      ...input.evidence[0], evidenceId: 'c001-tech-second', normalizedValue: 100,
      description: 'Second independent synthetic technical sample',
    });
    const output = scoreCandidate(input);
    const category = output.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')!;
    expect(category.score).toBe(90);
    expect(category.evidenceRefs).toEqual(['c001-tech', 'c001-tech-second']);
    expect(output.overallScore).toBe(80.6);
  });

  it('uses configurable weights for each supported role', () => {
    const input = candidate(1);
    expect(scoreCandidate(input).overallScore).toBe(83.4);
    input.targetRole = 'software_developer';
    expect(scoreCandidate(input).overallScore).toBe(82.7);
    input.targetRole = 'data_analyst';
    expect(scoreCandidate(input).overallScore).toBe(82.9);

    const differentCandidate = candidate();
    expect(scoreCandidate(differentCandidate).overallScore).toBe(78.1);
    differentCandidate.targetRole = 'ai_ml_engineer';
    expect(scoreCandidate(differentCandidate).overallScore).toBe(77.95);
  });

  it('returns the same result for identical inputs and configuration', () => {
    const input = candidate(1);
    const first = scoreCandidate(input, sharedWeights);
    const second = scoreCandidate(input, sharedWeights);
    const third = scoreCandidate(input, sharedWeights);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('preserves category-level scores but omits the overall score when one or more categories are missing', () => {
    const oneMissing = scoreCandidate(candidate(3));
    expect(oneMissing.evaluationStatus).toBe('insufficient_evidence');
    expect(oneMissing.overallScore).toBeUndefined();
    expect(oneMissing.missingEvidence).toEqual(['communication_skills']);
    const communicationScore = oneMissing.categoryScores.find(({ categoryId }) => categoryId === 'communication_skills');
    expect(communicationScore?.status).toBe('insufficient_evidence');
    expect(communicationScore?.score).toBeUndefined();
    expect(oneMissing.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')?.score).toBe(70);

    const allMissing = scoreCandidate(candidate(4));
    expect(allMissing.evaluationStatus).toBe('insufficient_evidence');
    expect(allMissing.overallScore).toBeUndefined();
    expect(allMissing.categoryScores.every(({ status, score }) => status === 'insufficient_evidence' && score === undefined)).toBe(true);
    expect(allMissing.missingEvidence).toHaveLength(6);
  });

  it('keeps available raw evidence without a normalized value unscored', () => {
    const input = candidate();
    input.evidence = input.evidence.map((item: Record<string, any>) => item.categoryId === 'technical_skills' ? { ...item, normalizedValue: undefined, originalValue: '4/5 raw rubric' } : item);
    const output = scoreCandidate(input);
    const technicalScore = output.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills');
    expect(technicalScore?.status).toBe('insufficient_evidence');
    expect(technicalScore?.score).toBeUndefined();
    expect(technicalScore?.evidenceRefs).toEqual([]);
    expect(output.evidence.find(({ evidenceId }: Record<string, any>) => evidenceId === 'c001-tech').originalValue).toBe('4/5 raw rubric');
    expect(output.missingEvidence).toContain('technical_skills');
  });

  it('handles the inclusive zero and 100 score boundaries', () => {
    expect(scoreCandidate(allCategoriesWithScore(0)).overallScore).toBe(0);
    expect(scoreCandidate(allCategoriesWithScore(100)).overallScore).toBe(100);
    expect(scoreCandidate(allCategoriesWithScore(0)).categoryScores.every(({ score }) => score === 0)).toBe(true);
    expect(scoreCandidate(allCategoriesWithScore(100)).categoryScores.every(({ score }) => score === 100)).toBe(true);
  });

  it('accepts minimum and maximum valid weight values and validates them before scoring', () => {
    const extremeWeights = {
      schemaVersion: '1.0.0', preliminary: true,
      roles: {
        software_developer: { technical_skills: 100, problem_solving_dsa: 0, relevant_project_experience: 0, practical_assessment_performance: 0, communication_skills: 0, learning_adaptability: 0 },
        ai_ml_engineer: { technical_skills: 0, problem_solving_dsa: 100, relevant_project_experience: 0, practical_assessment_performance: 0, communication_skills: 0, learning_adaptability: 0 },
        data_analyst: { technical_skills: 0, problem_solving_dsa: 0, relevant_project_experience: 0, practical_assessment_performance: 0, communication_skills: 0, learning_adaptability: 100 },
      },
    };
    expect(roleWeightConfigurationSchema.safeParse(extremeWeights).success).toBe(true);
    expect(scoreCandidate(candidate(), extremeWeights).overallScore).toBe(80);
    expect(() => scoreCandidate(candidate(), { ...extremeWeights, roles: { ...extremeWeights.roles, software_developer: { ...extremeWeights.roles.software_developer, technical_skills: -1 } } })).toThrow(ScoringValidationError);
    expect(() => scoreCandidate(candidate(), { ...extremeWeights, roles: { ...extremeWeights.roles, software_developer: { ...extremeWeights.roles.software_developer, technical_skills: 99 } } })).toThrow(/total 100/i);
  });

  it('does not divide by zero or score partially when available categories have zero weight', () => {
    const input = candidate(3);
    const config = structuredClone(sharedWeights);
    config.roles.software_developer = { technical_skills: 0, problem_solving_dsa: 0, relevant_project_experience: 0, practical_assessment_performance: 0, communication_skills: 100, learning_adaptability: 0 };
    const output = scoreCandidate(input, config);
    expect(output.evaluationStatus).toBe('insufficient_evidence');
    expect(output.overallScore).toBeUndefined();
  });

  it('rejects invalid normalized values, malformed evidence, unknown roles, and duplicate evidence IDs', () => {
    for (const invalidScore of [-1, 101, '80']) {
      const input = candidate();
      input.evidence[0].normalizedValue = invalidScore;
      expect(() => scoreCandidate(input)).toThrow(ScoringValidationError);
    }
    expect(() => scoreCandidate({ candidateId: 'bad', targetRole: 'software_developer', evidence: [{ evidenceId: 'x' }] })).toThrow(/invalid candidate input/i);
    expect(() => scoreCandidate({ ...candidate(), targetRole: 'unknown_role' })).toThrow(/invalid candidate input/i);
    const duplicate = candidate();
    duplicate.evidence[1].evidenceId = duplicate.evidence[0].evidenceId;
    expect(() => scoreCandidate(duplicate)).toThrow(/evidence ids must be unique/i);
  });

  it('rejects unknown roles in configuration, invalid configuration, and empty input without fabricating scores', () => {
    const input = { candidateId: 'synthetic-empty', targetRole: 'software_developer', evidence: [] };
    const emptyResult = scoreCandidate(input);
    expect(emptyResult.evaluationStatus).toBe('insufficient_evidence');
    expect(emptyResult.overallScore).toBeUndefined();
    expect(() => scoreCandidate({ ...input, targetRole: 'unknown_role' })).toThrow(ScoringValidationError);
    expect(() => scoreCandidate(input, {})).toThrow(/invalid role-weight configuration/i);
  });

  it('rounds category and overall scores to two decimal places', () => {
    const input = allCategoriesWithScore(80);
    input.evidence[0].normalizedValue = 80;
    input.evidence.push({ ...input.evidence[0], evidenceId: 'rounding-value', normalizedValue: 80.01 });
    const output = scoreCandidate(input);
    expect(output.categoryScores[0].score).toBe(80.01);
    expect(output.overallScore).toBe(80);
  });

  it('returns the exact versioned Day 1 response shape with evidence references and no AI score authorship', () => {
    const input = candidate();
    const output = scoreCandidate(input);
    expect(evaluationResponseSchema.safeParse(output).success).toBe(true);
    expect(output.schemaVersion).toBe('1.0.0');
    expect(output.categoryScores.map(({ categoryId }) => categoryId)).toEqual(scoringCategories.map(({ id }) => id));
    expect(output.categoryScores.flatMap(({ evidenceRefs }) => evidenceRefs)).toEqual(input.evidence.map(({ evidenceId }: Record<string, any>) => evidenceId));
    expect(output.evidence).toEqual(input.evidence);
    expect(output.aiExplanation.summary).toContain('No AI-generated explanation');
  });
});
