import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluationResponseSchema, finalEvaluationReportSchema, finalRubric, roleWeightConfigurationSchema, scoringCategories } from '@devrank/contracts';
import { loadRoleWeightConfiguration, scoreCandidate, ScoringValidationError, SUPPORTED_SCORING_VERSIONS } from '../src/modules/scoring/index.js';

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
      const expectedScore = Object.keys(outcome.categoryScores).length === 6
        ? Number((Object.entries(outcome.categoryScores).reduce((sum, [categoryId, score]) => sum + score * sharedWeights.roles[input.targetRole][categoryId], 0) / 100).toFixed(2))
        : undefined;
      expect(output.overallScore).toBe(expectedScore);
      expect(Object.fromEntries(output.categoryScores.filter(({ score }) => score !== undefined).map(({ categoryId, score }) => [categoryId, score]))).toEqual(outcome.categoryScores);
      expect([...output.missingEvidence].sort()).toEqual([...(outcome.missingEvidence ?? [])].sort());
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
    const categories = Object.fromEntries(output.categoryScores.map(({ categoryId, score }) => [categoryId, score]));
    const expectedScore = Number((Object.entries(categories).reduce((sum, [id, score]) => sum + (score ?? 0) * sharedWeights.roles.software_developer[id], 0) / 100).toFixed(2));
    expect(output.overallScore).toBe(expectedScore);
  });

  it('uses configurable weights for each supported role', () => {
    const input = candidate(1);
    const defaultScore = scoreCandidate(input).overallScore;
    input.targetRole = 'software_developer';
    expect(scoreCandidate(input).overallScore).toBe(defaultScore);
    input.targetRole = 'data_analyst';
    expect(scoreCandidate(input).overallScore).toBe(defaultScore);

    const differentCandidate = candidate();
    const commonScore = scoreCandidate(differentCandidate).overallScore;
    differentCandidate.targetRole = 'ai_ml_engineer';
    expect(scoreCandidate(differentCandidate).overallScore).toBe(commonScore);
  });

  it('returns the same result for identical inputs and configuration', () => {
    const input = candidate(1);
    const first = scoreCandidate(input, sharedWeights);
    const second = scoreCandidate(input, sharedWeights);
    const third = scoreCandidate(input, sharedWeights);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('records the supported scoring version and the matching configuration on every result', () => {
    const config = loadRoleWeightConfiguration('4.0.0');
    expect(SUPPORTED_SCORING_VERSIONS).toEqual(['4.0.0']);
    expect(config.scoringVersion).toBe('4.0.0');
    expect(config.roles).toEqual({
      software_developer: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      ai_ml_engineer: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
      data_analyst: { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 },
    });
    expect(scoreCandidate(candidate(), config, '4.0.0').scoringVersion).toBe(config.scoringVersion);
    expect(scoreCandidate(candidate(4), config, '4.0.0').scoringVersion).toBe('4.0.0');
  });

  it('rejects unsupported versions and never applies the current formula under a different identifier', () => {
    expect(() => loadRoleWeightConfiguration('9.9.9')).toThrow(/unsupported scoring version "9.9.9"/i);
    expect(() => loadRoleWeightConfiguration('1.0.0')).toThrow(/unsupported scoring version "1.0.0"/i);
    expect(() => scoreCandidate(candidate(), sharedWeights, '9.9.9')).toThrow(/unsupported scoring version "9.9.9"/i);
    expect(() => scoreCandidate(candidate(), sharedWeights, '2.0.0')).toThrow(/unsupported scoring version "2.0.0"/i);
    expect(() => scoreCandidate(candidate(), { ...sharedWeights, scoringVersion: '3.0.0' })).toThrow(/invalid role-weight configuration/i);
    expect(() => scoreCandidate(candidate(), { ...sharedWeights, scoringVersion: '3.0.0' }, '4.0.0')).toThrow(/invalid role-weight configuration/i);
  });

  it('does not mutate candidate evidence or shared role weights while scoring', () => {
    const input = candidate(1);
    const originalInput = structuredClone(input);
    const originalWeights = structuredClone(sharedWeights);
    scoreCandidate(input, sharedWeights);
    scoreCandidate(input, sharedWeights);
    expect(input).toEqual(originalInput);
    expect(sharedWeights).toEqual(originalWeights);
  });

  it('keeps numeric results stable when evidence items arrive in a different order', () => {
    const input = candidate();
    const original = scoreCandidate(input);
    input.evidence.reverse();
    const reordered = scoreCandidate(input);
    expect(reordered.overallScore).toBe(original.overallScore);
    expect(reordered.categoryScores.map(({ categoryId, score }) => [categoryId, score])).toEqual(original.categoryScores.map(({ categoryId, score }) => [categoryId, score]));
  });

  it('preserves category-level scores but omits the overall score when one or more categories are missing', () => {
    const oneMissingInput = candidate();
    oneMissingInput.evidence = oneMissingInput.evidence.filter((item: Record<string, any>) => item.categoryId !== 'technical_skills');
    const oneMissing = scoreCandidate(oneMissingInput);
    expect(oneMissing.evaluationStatus).toBe('insufficient_evidence');
    expect(oneMissing.overallScore).toBeUndefined();
    expect(oneMissing.missingEvidence).toEqual(['technical_skills']);
    const missingCategoryScore = oneMissing.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills');
    expect(missingCategoryScore?.status).toBe('insufficient_evidence');
    expect(missingCategoryScore?.score).toBeUndefined();
    expect(oneMissing.categoryScores.find(({ categoryId }) => categoryId === 'problem_solving_dsa')?.score).toBe(75);

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

  it('validates a complete report when individually rounded weighted-point displays sum one cent above the aggregate', () => {
    const evaluation = scoreCandidate(allCategoriesWithScore(99.99));
    const categories = finalRubric.categories.map((category) => ({
      categoryId: category.id,
      displayName: category.displayName,
      weight: category.weight,
      source: category.source,
      status: 'scored' as const,
      score: 99.99,
      weightedPoints: Math.round(99.99 * category.weight) / 100,
      metrics: {},
      formula: 'Deterministic regression fixture.',
    }));
    const displayedPointsTotal = categories.reduce((sum, category) => sum + category.weightedPoints, 0);
    expect(displayedPointsTotal).toBe(100);
    expect(evaluation.overallScore).toBe(99.99);

    const report = finalEvaluationReportSchema.parse({
      rubricId: finalRubric.id,
      status: 'complete',
      overallScore: evaluation.overallScore,
      categories,
      notice: 'Regression fixture.',
    });
    expect(report.overallScore).toBe(evaluation.overallScore);
    expect(evaluationResponseSchema.safeParse({ ...evaluation, finalReport: report }).success).toBe(true);
    expect(finalEvaluationReportSchema.safeParse({ ...report, overallScore: displayedPointsTotal }).success).toBe(false);
  });

  it('accepts minimum and maximum valid weight values and validates them before scoring', () => {
    const extremeWeights = {
      schemaVersion: '4.0.0', scoringVersion: '4.0.0', status: 'active',
      roles: {
        software_developer: { project_portfolio: 100, technical_skills: 0, development_activity: 0, collaboration: 0, current_year_contributions: 0, problem_solving_dsa: 0 },
        ai_ml_engineer: { project_portfolio: 0, technical_skills: 0, development_activity: 0, collaboration: 0, current_year_contributions: 0, problem_solving_dsa: 100 },
        data_analyst: { project_portfolio: 0, technical_skills: 0, development_activity: 0, collaboration: 0, current_year_contributions: 0, problem_solving_dsa: 100 },
      },
    };
    expect(roleWeightConfigurationSchema.safeParse(extremeWeights).success).toBe(true);
    expect(scoreCandidate(allCategoriesWithScore(80), extremeWeights).overallScore).toBe(80);
    expect(() => scoreCandidate(candidate(), { ...extremeWeights, roles: { ...extremeWeights.roles, software_developer: { ...extremeWeights.roles.software_developer, technical_skills: -1 } } })).toThrow(ScoringValidationError);
    expect(() => scoreCandidate(candidate(), { ...extremeWeights, roles: { ...extremeWeights.roles, software_developer: { ...extremeWeights.roles.software_developer, technical_skills: 99 } } })).toThrow(/total 100/i);
  });

  it('does not divide by zero or score partially when available categories have zero weight', () => {
    const input = candidate();
    input.evidence = input.evidence.filter((item: Record<string, any>) => item.categoryId !== 'current_year_contributions');
    const config = structuredClone(sharedWeights);
    config.roles.software_developer = { project_portfolio: 0, technical_skills: 0, development_activity: 0, collaboration: 0, current_year_contributions: 100, problem_solving_dsa: 0 };
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
    expect(output.schemaVersion).toBe('4.0.0');
    expect(output.scoringVersion).toBe('4.0.0');
    expect(output.categoryScores.map(({ categoryId }) => categoryId)).toEqual(scoringCategories.map(({ id }) => id));
    expect(output.categoryScores.flatMap(({ categoryId, evidenceRefs }) => evidenceRefs.map((evidenceId) => [categoryId, evidenceId])))
      .toEqual(scoringCategories.flatMap(({ id }) => input.evidence.filter((item: Record<string, any>) => item.categoryId === id).map(({ evidenceId }: Record<string, any>) => [id, evidenceId])));
    expect(output.evidence).toEqual(input.evidence);
    expect(output.aiExplanation.summary).toContain('No AI-generated explanation');
  });

  it('scores the canonical six active GitHub and LeetCode categories', () => {
    expect(scoringCategories.map(({ id }) => id)).toEqual([
      'project_portfolio', 'technical_skills', 'development_activity',
      'collaboration', 'current_year_contributions', 'problem_solving_dsa',
    ]);
    const output = scoreCandidate(candidate());
    expect(output.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')?.status).toBe('scored');
    expect(output.categoryScores.find(({ categoryId }) => categoryId === 'project_portfolio')?.status).toBe('scored');
  });
});
