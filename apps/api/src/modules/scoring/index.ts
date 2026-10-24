import { readFileSync } from 'node:fs';
import {
  candidateInputSchema,
  evaluationResponseSchema,
  roleWeightConfigurationSchema,
  schemaVersion,
  scoringVersion as currentScoringVersion,
  scoringCategories,
  type CandidateInput,
  type EvaluationResponse,
  type RoleWeightConfiguration,
  type ScoringCategory,
} from '@devrank/contracts';

const roleWeightsUrl = new URL('../../../../../config/role-weights.json', import.meta.url);
export const SUPPORTED_SCORING_VERSIONS = [currentScoringVersion] as const;

export class ScoringValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringValidationError';
  }
}

export interface ScoringPolicyOptions {
  /** Categories whose absent optional source has an explicitly defined zero policy. */
  zeroScoreCategories?: readonly ('problem_solving_dsa')[];
  /** Clear explanations for genuinely unavailable categories with known source state. */
  missingEvidenceExplanations?: Partial<Record<ScoringCategory, string>>;
}

/** Load and validate the one shared role-weight configuration. */
export function loadRoleWeightConfiguration(requestedVersion?: string): RoleWeightConfiguration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(roleWeightsUrl, 'utf8')) as unknown;
  } catch (error) {
    throw new ScoringValidationError(`Could not load role-weight configuration: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  const validation = roleWeightConfigurationSchema.safeParse(parsed);
  if (!validation.success) {
    throw new ScoringValidationError(`Invalid role-weight configuration: ${validation.error.issues.map(({ message }) => message).join('; ')}`);
  }
  const selectedVersion = requestedVersion ?? validation.data.scoringVersion;
  if (!SUPPORTED_SCORING_VERSIONS.includes(selectedVersion as typeof SUPPORTED_SCORING_VERSIONS[number])) {
    throw new ScoringValidationError(`Unsupported scoring version "${selectedVersion}". Supported versions: ${SUPPORTED_SCORING_VERSIONS.join(', ')}.`);
  }
  if (selectedVersion !== validation.data.scoringVersion) {
    throw new ScoringValidationError(`Scoring version "${selectedVersion}" is not present in the role-weight configuration (configured: "${validation.data.scoringVersion}").`);
  }
  return validation.data;
}

function roundToHundredth(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Deterministic normalized-evidence scorer. It never calls an AI or external service. */
export function scoreCandidate(
  input: unknown,
  configuration: unknown = loadRoleWeightConfiguration(),
  requestedVersion?: string,
  policy: ScoringPolicyOptions = {},
): EvaluationResponse {
  const candidateResult = candidateInputSchema.safeParse(input);
  if (!candidateResult.success) {
    throw new ScoringValidationError(`Invalid candidate input: ${candidateResult.error.issues.map(({ path, message }) => `${path.join('.') || 'input'}: ${message}`).join('; ')}`);
  }
  const configResult = roleWeightConfigurationSchema.safeParse(configuration);
  if (!configResult.success) {
    throw new ScoringValidationError(`Invalid role-weight configuration: ${configResult.error.issues.map(({ path, message }) => `${path.join('.') || 'configuration'}: ${message}`).join('; ')}`);
  }

  const selectedVersion = requestedVersion ?? configResult.data.scoringVersion;
  if (!SUPPORTED_SCORING_VERSIONS.includes(selectedVersion as typeof SUPPORTED_SCORING_VERSIONS[number])) {
    throw new ScoringValidationError(`Unsupported scoring version "${selectedVersion}". Supported versions: ${SUPPORTED_SCORING_VERSIONS.join(', ')}.`);
  }
  if (selectedVersion !== configResult.data.scoringVersion) {
    throw new ScoringValidationError(`Requested scoring version "${selectedVersion}" does not match the supplied configuration version "${configResult.data.scoringVersion}".`);
  }

  const candidate: CandidateInput = candidateResult.data;
  const weights = configResult.data.roles[candidate.targetRole];
  if (!weights) throw new ScoringValidationError(`No role weights configured for role "${candidate.targetRole}".`);

  const evidenceIds = candidate.evidence.map(({ evidenceId }) => evidenceId);
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new ScoringValidationError('Evidence IDs must be unique within a candidate evaluation.');
  }

  const explicitZeroCategories = new Set(policy.zeroScoreCategories ?? []);
  const categoryScores = scoringCategories.map((category) => {
    const categoryEvidence = candidate.evidence.filter((item) => item.categoryId === category.id);
    const scoredEvidence = categoryEvidence.filter((item) => item.availability === 'available' && item.normalizedValue !== undefined);

    if (scoredEvidence.length === 0) {
      if (category.id === 'problem_solving_dsa' && explicitZeroCategories.has(category.id)) {
        return {
          categoryId: category.id,
          displayName: category.displayName,
          score: 0,
          status: 'scored' as const,
          scoreBasis: 'optional_missing_zero' as const,
          evidenceRefs: [],
          explanation: 'No LeetCode username or saved profile was provided. The active optional-evidence policy assigns this DSA index a zero; no supporting activity or evidence is inferred.',
        };
      }
      return {
        categoryId: category.id,
        displayName: category.displayName,
        status: 'insufficient_evidence' as const,
        evidenceRefs: [],
        explanation: policy.missingEvidenceExplanations?.[category.id] ?? (categoryEvidence.length === 0
          ? 'No evidence was supplied; no category score is assigned.'
          : 'No available evidence had a normalized score; no category score is assigned.'),
      };
    }

    const normalizedValues = scoredEvidence.map(({ normalizedValue }) => normalizedValue!).sort((left, right) => left - right);
    const mean = normalizedValues.reduce((total, value) => total + value, 0) / normalizedValues.length;
    return {
      categoryId: category.id,
      displayName: category.displayName,
      score: roundToHundredth(mean),
      status: 'scored' as const,
      evidenceRefs: scoredEvidence.map(({ evidenceId }) => evidenceId),
      explanation: `Arithmetic mean of ${scoredEvidence.length} available normalized evidence value(s), rounded to two decimal places.`,
    };
  });

  const missingEvidence = categoryScores.filter(({ status }) => status === 'insufficient_evidence').map(({ categoryId }) => categoryId);
  const complete = missingEvidence.length === 0;
  const overallScore = complete
    ? roundToHundredth(categoryScores.reduce((total, category) => total + (category.score ?? 0) * weights[category.categoryId], 0) / 100)
    : undefined;
  const result: EvaluationResponse = {
    schemaVersion,
    scoringVersion: selectedVersion,
    candidateId: candidate.candidateId,
    targetRole: candidate.targetRole,
    ...(overallScore === undefined ? {} : { overallScore }),
    categoryScores,
    roleWeightsUsed: weights,
    evidence: candidate.evidence,
    strengths: [],
    skillGaps: missingEvidence.map((categoryId) => `Evidence is missing for ${scoringCategories.find(({ id }) => id === categoryId)!.displayName}.`),
    recommendations: complete ? [] : ['Collect valid normalized evidence for each missing category before calculating an overall score.'],
    missingEvidence,
    calculationExplanation: complete
      ? 'Each category score is the arithmetic mean of its available normalized evidence, rounded to two decimal places. Where the active policy defines it, an absent optional LeetCode profile contributes a DSA zero without an evidence reference. Overall score is the weighted sum of the six category scores divided by 100, rounded to two decimal places.'
      : 'Category scores are reported where normalized evidence is available. An active optional-missing policy may score the absent LeetCode profile as DSA zero; the overall score remains omitted until all required categories are scoreable.',
    evaluationStatus: complete ? 'completed' : 'insufficient_evidence',
    aiExplanation: {
      summary: 'No AI-generated explanation was produced by deterministic scoring.',
      strengths: [],
      skillGaps: [],
      recommendations: [],
    },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  };

  const responseResult = evaluationResponseSchema.safeParse(result);
  if (!responseResult.success) {
    throw new ScoringValidationError(`Scoring produced an invalid evaluation response: ${responseResult.error.issues.map(({ path, message }) => `${path.join('.') || 'response'}: ${message}`).join('; ')}`);
  }
  return responseResult.data;
}
