import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  evidenceTypeSchema,
  evidenceVerificationStatusSchema,
  evidenceSchema,
  roleWeightConfigurationSchema,
  roleIdSchema,
  scoreSchema,
  scoringCategories,
  scoringCategorySchema,
  type Evidence,
  type EvaluationResponse,
  type ScoringCategory,
} from '@devrank/contracts';
import { loadRoleWeightConfiguration, scoreCandidate } from '../scoring/index.js';

export type EvidenceType = z.infer<typeof evidenceTypeSchema>;
const originalValueSchema = z.union([z.string().min(1), z.number().finite(), z.boolean()]);

/** Raw normalized-contract evidence, before a category is assigned. */
export const rawEvidenceSchema = z.object({
  evidenceId: z.string().min(1),
  evidenceType: evidenceTypeSchema,
  source: z.string().min(1),
  description: z.string().min(1),
  originalValue: originalValueSchema.optional(),
  normalizedValue: scoreSchema.optional(),
  verificationStatus: evidenceVerificationStatusSchema,
  observedAt: z.string().datetime().optional(),
  categoryId: scoringCategorySchema.optional(),
  availability: z.enum(['available', 'missing']),
}).strict().superRefine((item, context) => {
  if (item.availability === 'missing' && item.normalizedValue !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['normalizedValue'], message: 'Missing evidence cannot have a normalized value.' });
  }
});
export type RawEvidence = z.infer<typeof rawEvidenceSchema>;

export const evidenceCategoryMappingSchema = z.record(evidenceTypeSchema, scoringCategorySchema.nullable());
export type EvidenceCategoryMapping = z.infer<typeof evidenceCategoryMappingSchema>;
const candidateEnvelopeSchema = z.object({
  candidateId: z.string().min(1),
  targetRole: roleIdSchema,
  evidence: z.array(z.unknown()),
}).strict();

export type EvidenceNormalizationRules = Partial<Record<EvidenceType, (originalValue: string | number | boolean) => number>>;
export interface RejectedEvidence {
  index: number;
  evidenceId?: string;
  errors: string[];
}
export interface UnmappedEvidence {
  evidenceId: string;
  evidenceType: EvidenceType;
  reason: string;
}
export interface UnnormalizedEvidence {
  evidenceId: string;
  evidenceType: EvidenceType;
  reason: string;
}
export interface EvidenceValidationResult {
  validEvidence: RawEvidence[];
  rejectedEvidence: RejectedEvidence[];
}
export interface EvidenceProcessingOptions {
  normalizationRules?: EvidenceNormalizationRules;
  categoryMapping?: unknown;
  roleWeights?: unknown;
  scoringVersion?: string;
}
export interface EvidenceProcessingResult {
  evaluation: EvaluationResponse;
  rejectedEvidence: RejectedEvidence[];
  unmappedEvidence: UnmappedEvidence[];
  unnormalizedEvidence: UnnormalizedEvidence[];
}

const mappingUrl = new URL('../../../../../config/evidence-category-mapping.json', import.meta.url);

export class EvidenceProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceProcessingError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map(({ path, message }) => `${path.join('.') || 'evidence'}: ${message}`);
}

/** Validate every item independently. Duplicate IDs reject every item carrying that ID. */
export function validateEvidenceItems(input: unknown): EvidenceValidationResult {
  if (!Array.isArray(input)) throw new EvidenceProcessingError('Candidate evidence must be an array.');

  const ids = input.map((item) => item && typeof item === 'object' && 'evidenceId' in item ? (item as { evidenceId?: unknown }).evidenceId : undefined);
  const counts = new Map<string, number>();
  for (const id of ids) if (typeof id === 'string' && id.length > 0) counts.set(id, (counts.get(id) ?? 0) + 1);

  const validEvidence: RawEvidence[] = [];
  const rejectedEvidence: RejectedEvidence[] = [];
  input.forEach((item, index) => {
    const candidateId = ids[index];
    if (typeof candidateId === 'string' && (counts.get(candidateId) ?? 0) > 1) {
      rejectedEvidence.push({ index, evidenceId: candidateId, errors: [`evidenceId: duplicate ID "${candidateId}"; all occurrences of a duplicate ID are rejected.`] });
      return;
    }
    const parsed = rawEvidenceSchema.safeParse(item);
    if (!parsed.success) {
      rejectedEvidence.push({
        index,
        ...(typeof candidateId === 'string' ? { evidenceId: candidateId } : {}),
        errors: formatIssues(parsed.error),
      });
      return;
    }
    validEvidence.push(parsed.data);
  });
  return { validEvidence, rejectedEvidence };
}

export interface EvidenceNormalizationResult {
  evidence: RawEvidence;
  normalized: boolean;
  reason?: string;
}

/** Pass through already-normalized scores. Raw values require an explicit caller-supplied rule. */
export function normalizeEvidence(
  evidence: RawEvidence,
  rules: EvidenceNormalizationRules = {},
): EvidenceNormalizationResult {
  const checked = rawEvidenceSchema.safeParse(evidence);
  if (!checked.success) throw new EvidenceProcessingError(`Invalid evidence ${evidence?.evidenceId ?? '(unknown)'}: ${formatIssues(checked.error).join('; ')}`);
  const item = checked.data;
  if (item.availability === 'missing') return { evidence: item, normalized: false, reason: 'Evidence is explicitly marked missing.' };
  if (item.normalizedValue !== undefined) return { evidence: item, normalized: true };
  if (item.originalValue === undefined) return { evidence: item, normalized: false, reason: 'No raw value or normalized value was supplied.' };

  const rule = rules[item.evidenceType];
  if (!rule) return { evidence: item, normalized: false, reason: `No normalization rule is configured for evidence type "${item.evidenceType}".` };

  let value: unknown;
  try {
    value = rule(item.originalValue);
  } catch (error) {
    throw new EvidenceProcessingError(`Normalization rule for "${item.evidenceType}" failed for evidence "${item.evidenceId}": ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const validScore = scoreSchema.safeParse(value);
  if (!validScore.success) {
    throw new EvidenceProcessingError(`Normalization rule for "${item.evidenceType}" returned an invalid normalizedValue: ${formatIssues(validScore.error).join('; ')}`);
  }
  const normalizedEvidence = rawEvidenceSchema.parse({ ...item, normalizedValue: validScore.data });
  return { evidence: normalizedEvidence, normalized: true };
}

/** Load and validate the explicit type-to-category mapping used by the pipeline. */
export function loadEvidenceCategoryMapping(): EvidenceCategoryMapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mappingUrl, 'utf8')) as unknown;
  } catch (error) {
    throw new EvidenceProcessingError(`Could not load evidence category mapping: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const validated = evidenceCategoryMappingSchema.safeParse(parsed);
  if (!validated.success) throw new EvidenceProcessingError(`Invalid evidence category mapping: ${formatIssues(validated.error).join('; ')}`);
  return validated.data;
}

export type CategoryMappingResult =
  | { mapped: true; evidence: Evidence }
  | { mapped: false; evidenceId: string; evidenceType: EvidenceType; reason: string };

export function mapEvidenceCategory(evidence: RawEvidence, mapping: unknown = loadEvidenceCategoryMapping()): CategoryMappingResult {
  const validatedMapping = evidenceCategoryMappingSchema.safeParse(mapping);
  if (!validatedMapping.success) throw new EvidenceProcessingError(`Invalid evidence category mapping: ${formatIssues(validatedMapping.error).join('; ')}`);
  const target = validatedMapping.data[evidence.evidenceType];
  if (!target) {
    return { mapped: false, evidenceId: evidence.evidenceId, evidenceType: evidence.evidenceType, reason: `Evidence type "${evidence.evidenceType}" has no configured category mapping.` };
  }
  if (evidence.categoryId !== undefined && evidence.categoryId !== target) {
    return { mapped: false, evidenceId: evidence.evidenceId, evidenceType: evidence.evidenceType, reason: `Supplied category "${evidence.categoryId}" conflicts with configured category "${target}".` };
  }
  const parsed = evidenceSchema.safeParse({ ...evidence, categoryId: target });
  if (!parsed.success) throw new EvidenceProcessingError(`Could not map evidence "${evidence.evidenceId}": ${formatIssues(parsed.error).join('; ')}`);
  return { mapped: true, evidence: parsed.data };
}

/** Validate, normalize, map, then invoke the existing Day 2 scorer on retained valid evidence. */
export function processCandidateEvidence(input: unknown, options: EvidenceProcessingOptions = {}): EvidenceProcessingResult {
  const candidate = candidateEnvelopeSchema.safeParse(input);
  if (!candidate.success) throw new EvidenceProcessingError(`Invalid candidate envelope: ${formatIssues(candidate.error).join('; ')}`);
  const mapping = options.categoryMapping ?? loadEvidenceCategoryMapping();
  const mappingCheck = evidenceCategoryMappingSchema.safeParse(mapping);
  if (!mappingCheck.success) throw new EvidenceProcessingError(`Invalid evidence category mapping: ${formatIssues(mappingCheck.error).join('; ')}`);
  if (options.roleWeights !== undefined) {
    const roleWeightCheck = roleWeightConfigurationSchema.safeParse(options.roleWeights);
    if (!roleWeightCheck.success) {
      throw new EvidenceProcessingError(`Invalid role-weight configuration: ${formatIssues(roleWeightCheck.error).join('; ')}`);
    }
  }

  const validation = validateEvidenceItems(candidate.data.evidence);
  const mappedEvidence: Evidence[] = [];
  const rejectedEvidence = [...validation.rejectedEvidence];
  const unmappedEvidence: UnmappedEvidence[] = [];
  const unnormalizedEvidence: UnnormalizedEvidence[] = [];

  validation.validEvidence.forEach((rawEvidence) => {
    let normalization: EvidenceNormalizationResult;
    try {
      normalization = normalizeEvidence(rawEvidence, options.normalizationRules);
    } catch (error) {
      rejectedEvidence.push({
        index: candidate.data.evidence.findIndex((item) => item && typeof item === 'object' && 'evidenceId' in item && item.evidenceId === rawEvidence.evidenceId),
        evidenceId: rawEvidence.evidenceId,
        errors: [error instanceof Error ? error.message : 'Evidence normalization failed.'],
      });
      return;
    }
    if (!normalization.normalized) {
      unnormalizedEvidence.push({ evidenceId: rawEvidence.evidenceId, evidenceType: rawEvidence.evidenceType, reason: normalization.reason ?? 'No normalized value was produced.' });
    }

    const mappingResult = mapEvidenceCategory(normalization.evidence, mappingCheck.data);
    if (!mappingResult.mapped) {
      unmappedEvidence.push(mappingResult);
      return;
    }
    mappedEvidence.push(mappingResult.evidence);
  });

  const scoringConfiguration = options.roleWeights ?? loadRoleWeightConfiguration(options.scoringVersion);
  const evaluation = scoreCandidate({
    candidateId: candidate.data.candidateId,
    targetRole: candidate.data.targetRole,
    evidence: mappedEvidence,
  }, scoringConfiguration, options.scoringVersion);
  return { evaluation, rejectedEvidence, unmappedEvidence, unnormalizedEvidence };
}

export function categoryIds(): ScoringCategory[] {
  return scoringCategories.map(({ id }) => id);
}
