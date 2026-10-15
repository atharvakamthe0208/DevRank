import { describe, expect, it } from 'vitest';
import { candidateRankingSchema, scoringCategories } from '@devrank/contracts';
import { processCandidateEvidence } from '../src/modules/evidence-processing/index.js';
import { loadRoleWeightConfiguration, scoreCandidate } from '../src/modules/scoring/index.js';

const weights = loadRoleWeightConfiguration();

function completeInput(candidateId: string, values: number[], evidencePrefix = candidateId): Record<string, any> {
  return {
    candidateId,
    targetRole: 'software_developer',
    evidence: scoringCategories.map(({ id }, index) => ({
      evidenceId: `${evidencePrefix}-${index}`,
      evidenceType: ['technical_screen', 'coding_assessment', 'project', 'work_sample', 'learning_record'][index],
      source: 'Synthetic Day 6 QA fixture',
      description: `Synthetic ${id} result`,
      normalizedValue: values[index],
      verificationStatus: 'unverified',
      categoryId: id,
      availability: 'available',
    })),
  };
}

function equalWeights() {
  return {
    ...weights,
    roles: {
      ...weights.roles,
      software_developer: Object.fromEntries(scoringCategories.map(({ id }) => [id, 20])),
    },
  };
}

describe('Day 6 scoring and ranking QA', () => {
  it('preserves equal overall scores for two candidates without inventing a score tie-break', () => {
    const first = scoreCandidate(completeInput('candidate-1', [80, 80, 80, 80, 80]));
    const secondInput = completeInput('candidate-2', [80, 80, 80, 80, 80]);
    secondInput.evidence.push({
      ...secondInput.evidence[0], evidenceId: 'candidate-2-extra-unavailable', availability: 'missing', normalizedValue: undefined,
    });
    const second = scoreCandidate(secondInput);
    expect(first.overallScore).toBe(80);
    expect(second.overallScore).toBe(80);
    expect(first.evidence.length).not.toBe(second.evidence.length);
  });

  it('preserves three-way overall ties even when category scores differ', () => {
    const config = equalWeights();
    const outcomes = [
      scoreCandidate(completeInput('candidate-a', [100, 50, 50, 50, 50]), config),
      scoreCandidate(completeInput('candidate-b', [50, 62.5, 62.5, 62.5, 62.5]), config),
      scoreCandidate(completeInput('candidate-c', [60, 60, 60, 60, 60]), config),
    ];
    expect(outcomes.map(({ overallScore }) => overallScore)).toEqual([60, 60, 60]);
    expect(outcomes[0].categoryScores.map(({ score }) => score)).not.toEqual(outcomes[1].categoryScores.map(({ score }) => score));
  });

  it('does not alter equal numeric results when candidate input order is permuted', () => {
    const inputs = [
      completeInput('candidate-a', [70, 70, 70, 70, 70]),
      completeInput('candidate-b', [70, 70, 70, 70, 70]),
      completeInput('candidate-c', [70, 70, 70, 70, 70]),
    ];
    const scoreById = (values: typeof inputs) => Object.fromEntries(values.map((input) => [input.candidateId, scoreCandidate(input).overallScore]));
    expect(scoreById(inputs)).toEqual(scoreById([...inputs].reverse()));
    expect(new Set(Object.values(scoreById(inputs)))).toEqual(new Set([70]));
  });

  it('rounds scores at the established two-decimal boundary without creating artificial rank separation', () => {
    const a = scoreCandidate(completeInput('round-a', [80.004, 80.004, 80.004, 80.004, 80.004]));
    const b = scoreCandidate(completeInput('round-b', [80, 80, 80, 80, 80]));
    expect(a.categoryScores.map(({ score }) => score)).toEqual([80, 80, 80, 80, 80]);
    expect(a.overallScore).toBe(b.overallScore);
  });

  it('represents tied rank values without requiring a fabricated ordinal distinction', () => {
    const tied = [
      { candidateId: '00000000-0000-4000-8000-000000000001', rank: 1, score: 80, evaluationId: '10000000-0000-4000-8000-000000000001', evaluatedAt: '2026-10-14T00:00:00.000Z' },
      { candidateId: '00000000-0000-4000-8000-000000000002', rank: 1, score: 80, evaluationId: '10000000-0000-4000-8000-000000000002', evaluatedAt: '2026-10-14T00:00:00.000Z' },
    ];
    expect(tied.map((item) => candidateRankingSchema.parse(item).rank)).toEqual([1, 1]);
  });

  it('reports one or multiple missing categories and never renormalizes weights into an overall score', () => {
    for (const missingCount of [1, 3, 5]) {
      const input = completeInput(`missing-${missingCount}`, [90, 80, 70, 60, 50]);
      input.evidence = input.evidence.slice(0, 5 - missingCount);
      const result = scoreCandidate(input);
      expect(result.evaluationStatus).toBe('insufficient_evidence');
      expect(result.overallScore).toBeUndefined();
      expect(result.missingEvidence).toHaveLength(missingCount);
      expect(result.roleWeightsUsed).toEqual(weights.roles.software_developer);
    }
  });

  it('ignores unavailable and unnormalized evidence while retaining usable category scores', () => {
    const input = completeInput('mixed-availability', [90, 80, 70, 60, 50]);
    input.evidence[0].availability = 'missing';
    input.evidence[0].normalizedValue = undefined;
    input.evidence[1].normalizedValue = undefined;
    input.evidence[1].originalValue = 'not normalized';
    const result = scoreCandidate(input);
    expect(result.evaluationStatus).toBe('insufficient_evidence');
    expect(result.overallScore).toBeUndefined();
    expect(result.missingEvidence).toEqual(['technical_skills', 'problem_solving_dsa']);
    expect(result.categoryScores.find(({ categoryId }) => categoryId === 'relevant_project_experience')?.score).toBe(70);
  });

  it('validates and scores the usable part of evidence while reporting rejected and unavailable sources', () => {
    const complete = completeInput('pipeline-candidate', [91, 81, 71, 61, 51]);
    const result = processCandidateEvidence({
      ...complete,
      evidence: [
        ...complete.evidence,
        { ...complete.evidence[0], evidenceId: 'bad-score', normalizedValue: 101 },
        { ...complete.evidence[1], evidenceId: 'source-unavailable', availability: 'missing', normalizedValue: undefined },
      ],
    });
    expect(result.rejectedEvidence.map(({ evidenceId }) => evidenceId)).toContain('bad-score');
    expect(result.evaluation.evaluationStatus).toBe('completed');
    expect(result.evaluation.overallScore).toBeDefined();
    expect(result.evaluation.categoryScores.find(({ categoryId }) => categoryId === 'technical_skills')?.score).toBe(91);
  });
});
