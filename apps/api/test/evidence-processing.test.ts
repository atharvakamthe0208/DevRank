import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluationResponseSchema, scoringCategories } from '@devrank/contracts';
import {
  evidenceCategoryMappingSchema,
  loadEvidenceCategoryMapping,
  mapEvidenceCategory,
  normalizeEvidence,
  processCandidateEvidence,
  rawEvidenceSchema,
  validateEvidenceItems,
} from '../src/modules/evidence-processing/index.js';

const candidates = JSON.parse(readFileSync(new URL('../../../fixtures/dummy-candidates.json', import.meta.url), 'utf8')) as Array<Record<string, any>>;
const expected = JSON.parse(readFileSync(new URL('../../../fixtures/expected-evaluations.json', import.meta.url), 'utf8')) as Array<Record<string, any>>;

function rawEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceId: 'raw-tech-001',
    evidenceType: 'technical_screen',
    source: 'Synthetic raw assessment',
    description: 'Synthetic technical rubric result',
    originalValue: '4/5',
    verificationStatus: 'unverified',
    availability: 'available',
    ...overrides,
  };
}

function completeRawCandidate(): Record<string, any> {
  return {
    candidateId: 'synthetic-raw-complete',
    targetRole: 'software_developer',
    evidence: [
      rawEvidence({ evidenceId: 'raw-tech', evidenceType: 'technical_screen', originalValue: '4/5' }),
      rawEvidence({ evidenceId: 'raw-dsa', evidenceType: 'coding_assessment', originalValue: '3/4' }),
      rawEvidence({ evidenceId: 'raw-project', evidenceType: 'project', originalValue: 78 }),
      rawEvidence({ evidenceId: 'raw-practical', evidenceType: 'work_sample', originalValue: 82 }),
      rawEvidence({ evidenceId: 'raw-communication', evidenceType: 'structured_interview', originalValue: 80 }),
      rawEvidence({ evidenceId: 'raw-learning', evidenceType: 'learning_record', originalValue: 72 }),
    ],
  };
}

const testNormalizationRules = {
  technical_screen: (value: string | number | boolean) => {
    const [points, maximum] = String(value).split('/').map(Number);
    return points / maximum * 100;
  },
  coding_assessment: (value: string | number | boolean) => {
    const [points, maximum] = String(value).split('/').map(Number);
    return points / maximum * 100;
  },
  project: (value: string | number | boolean) => Number(value),
  work_sample: (value: string | number | boolean) => Number(value),
  structured_interview: (value: string | number | boolean) => Number(value),
  learning_record: (value: string | number | boolean) => Number(value),
};

describe('evidence validation, normalization, mapping, and scoring integration', () => {
  it('validates required fields, enum values, data types, score ranges, and strict unsupported fields', () => {
    expect(rawEvidenceSchema.safeParse(rawEvidence()).success).toBe(true);
    for (const invalid of [
      null,
      { evidenceId: 'missing-source', evidenceType: 'project', description: 'x', verificationStatus: 'unverified', availability: 'available' },
      rawEvidence({ evidenceType: 'unknown_type' }),
      rawEvidence({ verificationStatus: 'approved' }),
      rawEvidence({ evidenceId: '' }),
      rawEvidence({ source: '' }),
      rawEvidence({ description: '' }),
      rawEvidence({ originalValue: '' }),
      rawEvidence({ originalValue: null }),
      rawEvidence({ normalizedValue: null }),
      rawEvidence({ normalizedValue: -1 }),
      rawEvidence({ normalizedValue: 100.01 }),
      rawEvidence({ normalizedValue: '80' }),
      rawEvidence({ categoryId: null }),
      rawEvidence({ confidence: 0.8 }),
      rawEvidence({ availability: 'missing', normalizedValue: 0 }),
    ]) expect(rawEvidenceSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects duplicate IDs consistently by rejecting every occurrence', () => {
    const first = rawEvidence({ evidenceId: 'duplicate' });
    const second = rawEvidence({ evidenceId: 'duplicate', evidenceType: 'project' });
    const result = validateEvidenceItems([first, second, rawEvidence({ evidenceId: 'unique' })]);
    expect(result.validEvidence.map(({ evidenceId }) => evidenceId)).toEqual(['unique']);
    expect(result.rejectedEvidence).toHaveLength(2);
    expect(result.rejectedEvidence.every(({ errors }) => errors[0].includes('all occurrences'))).toBe(true);
  });

  it('does not fabricate a normalized value when no rule exists and preserves the original value', () => {
    const parsed = rawEvidenceSchema.parse(rawEvidence());
    const result = normalizeEvidence(parsed);
    expect(result.normalized).toBe(false);
    expect(result.reason).toContain('No normalization rule is configured');
    expect(result.evidence.originalValue).toBe('4/5');
    expect(result.evidence.normalizedValue).toBeUndefined();
  });

  it('applies an explicit deterministic rule to raw input and preserves raw and normalized fields separately', () => {
    const parsed = rawEvidenceSchema.parse(rawEvidence());
    const result = normalizeEvidence(parsed, testNormalizationRules);
    expect(result.normalized).toBe(true);
    expect(result.evidence.originalValue).toBe('4/5');
    expect(result.evidence.normalizedValue).toBe(80);
    expect(normalizeEvidence(parsed, testNormalizationRules)).toEqual(result);
  });

  it('passes already-normalized values through without applying a second transformation', () => {
    const parsed = rawEvidenceSchema.parse(rawEvidence({ normalizedValue: 64 }));
    const rules = { technical_screen: () => { throw new Error('must not run'); } };
    const result = normalizeEvidence(parsed, rules);
    expect(result).toEqual({ evidence: parsed, normalized: true });
    expect(result.evidence.normalizedValue).toBe(64);
  });

  it('rejects invalid custom normalization results with a clear error', () => {
    const parsed = rawEvidenceSchema.parse(rawEvidence());
    expect(() => normalizeEvidence(parsed, { technical_screen: () => 101 })).toThrow(/invalid normalizedValue/i);
    expect(() => normalizeEvidence(parsed, { technical_screen: () => Number.NaN })).toThrow(/invalid normalizedValue/i);
  });

  it('loads the explicit type-to-category mapping and maps each supported type to the shared category ID', () => {
    const mapping = loadEvidenceCategoryMapping();
    expect(evidenceCategoryMappingSchema.safeParse(mapping).success).toBe(true);
    const expectedByType = {
      technical_screen: 'technical_skills',
      coding_assessment: 'problem_solving_dsa',
      project: 'relevant_project_experience',
      work_sample: 'practical_assessment_performance',
      structured_interview: 'communication_skills',
      learning_record: 'learning_adaptability',
      portfolio: 'relevant_project_experience',
    };
    for (const [evidenceType, categoryId] of Object.entries(expectedByType)) {
      const item = rawEvidenceSchema.parse(rawEvidence({ evidenceType, normalizedValue: 50, originalValue: undefined }));
      const result = mapEvidenceCategory(item, mapping);
      expect(result.mapped).toBe(true);
      if (result.mapped) expect(result.evidence.categoryId).toBe(categoryId);
    }
    expect(Object.values(expectedByType)).toEqual(expect.arrayContaining(scoringCategories.map(({ id }) => id)));
    const interview = mapEvidenceCategory(rawEvidenceSchema.parse(rawEvidence({ evidenceType: 'structured_interview', normalizedValue: 80 })), mapping);
    expect(interview).toMatchObject({ mapped: true, evidence: { categoryId: 'communication_skills' } });
  });

  it('reports unmapped types and category conflicts instead of guessing', () => {
    const mapping = loadEvidenceCategoryMapping();
    const other = mapEvidenceCategory(rawEvidenceSchema.parse(rawEvidence({ evidenceType: 'other' })), mapping);
    expect(other).toMatchObject({ mapped: false, reason: expect.stringContaining('no configured category mapping') });
    const conflict = mapEvidenceCategory(rawEvidenceSchema.parse(rawEvidence({ evidenceType: 'coding_assessment', categoryId: 'technical_skills' })), mapping);
    expect(conflict).toMatchObject({ mapped: false, reason: expect.stringContaining('conflicts with configured category') });
  });

  it('maps structured interview evidence to communication without inventing other category scores', () => {
    const interview = rawEvidence({ evidenceId: 'interview-unscored', evidenceType: 'structured_interview', normalizedValue: 94 });
    const result = processCandidateEvidence({
      candidateId: 'candidate-interview-only',
      targetRole: 'software_developer',
      evidence: [interview],
    });
    expect(result.unmappedEvidence).toEqual([]);
    expect(result.evaluation.evidence).toEqual([expect.objectContaining({ evidenceId: 'interview-unscored', categoryId: 'communication_skills' })]);
    expect(result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'communication_skills')?.score).toBe(94);
    expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
    expect(result.evaluation.overallScore).toBeUndefined();
  });

  it('processes complete raw data through normalization, mapping, Day 2 scoring, and the Day 1 response schema', () => {
    const result = processCandidateEvidence(completeRawCandidate(), { normalizationRules: testNormalizationRules });
    expect(result.rejectedEvidence).toEqual([]);
    expect(result.unmappedEvidence).toEqual([]);
    expect(result.unnormalizedEvidence).toEqual([]);
    expect(result.evaluation.categoryScores.map(({ categoryId }) => categoryId)).toEqual(scoringCategories.map(({ id }) => id));
    expect(result.evaluation.categoryScores.map(({ score }) => score)).toEqual([80, 75, 78, 82, 80, 72]);
    expect(result.evaluation.overallScore).toBeDefined();
    expect(result.evaluation.evidence.map(({ evidenceId }) => evidenceId)).toEqual(['raw-tech', 'raw-dsa', 'raw-project', 'raw-practical', 'raw-communication', 'raw-learning']);
    expect(result.evaluation.evidence[0]).toMatchObject({ originalValue: '4/5', normalizedValue: 80, categoryId: 'technical_skills' });
    expect(evaluationResponseSchema.safeParse(result.evaluation).success).toBe(true);
  });

  it('matches Day 2 fixture outputs for already-normalized complete and partial candidates', () => {
    for (const expectedResult of expected) {
      const input = candidates.find(({ candidateId }) => candidateId === expectedResult.candidateId)!;
      const result = processCandidateEvidence(input);
      expect(result.evaluation.scoringVersion).toBe(expectedResult.scoringVersion);
      expect(result.evaluation.evaluationStatus).toBe(expectedResult.evaluationStatus);
      expect(result.evaluation.overallScore).toBe(expectedResult.overallScore);
      expect(result.evaluation.missingEvidence).toEqual(expectedResult.missingEvidence ?? []);
      expect(result.rejectedEvidence).toEqual([]);
      expect(result.unmappedEvidence).toEqual([]);
    }
  });

  it('retains valid evidence when a different item is invalid, unnormalized, or unmapped', () => {
    const candidate = completeRawCandidate();
    candidate.evidence.splice(1, 0, rawEvidence({ evidenceId: 'invalid', normalizedValue: -5 }));
    candidate.evidence.splice(3, 0, rawEvidence({ evidenceId: 'unmapped', evidenceType: 'other', normalizedValue: 55 }));
    candidate.evidence.splice(5, 0, rawEvidence({ evidenceId: 'no-rule', evidenceType: 'portfolio', originalValue: 3 }));
    const result = processCandidateEvidence(candidate, { normalizationRules: testNormalizationRules });
    expect(result.rejectedEvidence).toHaveLength(1);
    expect(result.rejectedEvidence[0]).toMatchObject({ evidenceId: 'invalid', index: 1 });
    expect(result.unmappedEvidence).toHaveLength(1);
    expect(result.unmappedEvidence[0].evidenceId).toBe('unmapped');
    expect(result.unnormalizedEvidence).toContainEqual(expect.objectContaining({ evidenceId: 'no-rule', reason: expect.stringContaining('No normalization rule') }));
    expect(result.evaluation.evaluationStatus).toBe('completed');
    expect(result.evaluation.overallScore).toBe(78.1);
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'invalid')).toBe(false);
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'unmapped')).toBe(false);
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'no-rule')).toBe(true);
  });

  it('returns explicit insufficient evidence for one, several, or all missing categories and empty input', () => {
    const oneMissing = structuredClone(candidates[0]);
    oneMissing.evidence = oneMissing.evidence.filter((item: Record<string, any>) => item.categoryId !== 'technical_skills');
    const severalMissing = structuredClone(candidates[4]);
    severalMissing.evidence = severalMissing.evidence.slice(0, 2);
    for (const input of [oneMissing, severalMissing, candidates[4], { candidateId: 'empty', targetRole: 'software_developer', evidence: [] }]) {
      const result = processCandidateEvidence(input);
      expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
      expect(result.evaluation.overallScore).toBeUndefined();
    }
  });

  it('fails a malformed candidate envelope or invalid mapping configuration, but keeps evidence errors item-local', () => {
    expect(() => processCandidateEvidence({ candidateId: '', targetRole: 'software_developer', evidence: [] })).toThrow(/invalid candidate envelope/i);
    expect(() => processCandidateEvidence({ candidateId: 'ok', targetRole: 'software_developer', evidence: {} })).toThrow(/evidence: expected array/i);
    expect(() => processCandidateEvidence(completeRawCandidate(), { categoryMapping: { technical_screen: 123 } })).toThrow(/invalid evidence category mapping/i);
  });

  it('produces identical normalized and mapped pipeline results for identical input and rules', () => {
    const input = completeRawCandidate();
    const first = processCandidateEvidence(input, { normalizationRules: testNormalizationRules });
    const second = processCandidateEvidence(input, { normalizationRules: testNormalizationRules });
    expect(second).toEqual(first);
  });

  it('rejects invalid confidence fields because confidence is not part of the evidence contract', () => {
    const result = validateEvidenceItems([rawEvidence({ confidence: 1.1 })]);
    expect(result.validEvidence).toEqual([]);
    expect(result.rejectedEvidence[0].errors.join(' ')).toContain('Unrecognized key(s)');
  });
});
