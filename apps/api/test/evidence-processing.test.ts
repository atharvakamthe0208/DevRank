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

  it('does not map legacy generic assessment types into the active GitHub + LeetCode rubric', () => {
    const mapping = loadEvidenceCategoryMapping();
    expect(evidenceCategoryMappingSchema.safeParse(mapping).success).toBe(true);
    for (const evidenceType of Object.keys(mapping) as Array<keyof typeof mapping>) {
      const item = rawEvidenceSchema.parse(rawEvidence({ evidenceType, normalizedValue: 50, originalValue: undefined }));
      const result = mapEvidenceCategory(item, mapping);
      expect(result).toMatchObject({ mapped: false, reason: expect.stringContaining('no configured category mapping') });
    }
    expect(scoringCategories.map(({ id }) => id)).toEqual(['project_portfolio', 'technical_skills', 'development_activity', 'collaboration', 'current_year_contributions', 'problem_solving_dsa']);
  });

  it('reports unmapped types and category conflicts instead of guessing', () => {
    const mapping = loadEvidenceCategoryMapping();
    const other = mapEvidenceCategory(rawEvidenceSchema.parse(rawEvidence({ evidenceType: 'other' })), mapping);
    expect(other).toMatchObject({ mapped: false, reason: expect.stringContaining('no configured category mapping') });
    const conflict = mapEvidenceCategory(rawEvidenceSchema.parse(rawEvidence({ evidenceType: 'coding_assessment', categoryId: 'technical_skills' })), { ...mapping, coding_assessment: 'problem_solving_dsa' });
    expect(conflict).toMatchObject({ mapped: false, reason: expect.stringContaining('conflicts with configured category') });
  });

  it('does not turn a historical structured interview into an active v4 collaboration score', () => {
    const interview = rawEvidence({ evidenceId: 'interview-unscored', evidenceType: 'structured_interview', normalizedValue: 94 });
    const result = processCandidateEvidence({
      candidateId: 'candidate-interview-only',
      targetRole: 'software_developer',
      evidence: [interview],
    });
    expect(result.unmappedEvidence).toEqual([expect.objectContaining({ evidenceId: 'interview-unscored' })]);
    expect(result.evaluation.evidence).toEqual([]);
    expect(result.evaluation.categoryScores.every(({ status, score }) => status === 'insufficient_evidence' && score === undefined)).toBe(true);
    expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
    expect(result.evaluation.overallScore).toBeUndefined();
  });

  it('keeps generic historical assessment data out of the active v4 evaluation result', () => {
    const result = processCandidateEvidence(completeRawCandidate(), { normalizationRules: testNormalizationRules });
    expect(result.rejectedEvidence).toEqual([]);
    expect(result.unmappedEvidence).toHaveLength(6);
    expect(result.unnormalizedEvidence).toEqual([]);
    expect(result.evaluation.categoryScores.map(({ categoryId }) => categoryId)).toEqual(scoringCategories.map(({ id }) => id));
    expect(result.evaluation.categoryScores.every(({ score }) => score === undefined)).toBe(true);
    expect(result.evaluation.overallScore).toBeUndefined();
    expect(result.evaluation.evidence).toEqual([]);
    expect(evaluationResponseSchema.safeParse(result.evaluation).success).toBe(true);
  });

  it('keeps historical synthetic fixtures from satisfying the active provider-specific rubric', () => {
    for (const input of candidates) {
      const result = processCandidateEvidence(input);
      expect(result.rejectedEvidence).toEqual([]);
      expect(result.evaluation.scoringVersion).toBe('4.0.1');
      expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
      expect(result.evaluation.overallScore).toBeUndefined();
      expect(result.unmappedEvidence.length).toBeGreaterThan(0);
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
    expect(result.unmappedEvidence).toHaveLength(8);
    expect(result.unmappedEvidence.some(({ evidenceId }) => evidenceId === 'unmapped')).toBe(true);
    expect(result.unnormalizedEvidence).toContainEqual(expect.objectContaining({ evidenceId: 'no-rule', reason: expect.stringContaining('No normalization rule') }));
    expect(result.evaluation.evaluationStatus).toBe('insufficient_evidence');
    expect(result.evaluation.overallScore).toBeUndefined();
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'invalid')).toBe(false);
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'unmapped')).toBe(false);
    expect(result.evaluation.evidence.some(({ evidenceId }) => evidenceId === 'no-rule')).toBe(false);
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
