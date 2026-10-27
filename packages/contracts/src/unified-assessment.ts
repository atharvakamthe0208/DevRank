import { z } from 'zod';
import { roleIdSchema, roleWeightsSchema, scoreSchema, scoringCategories } from './scoring.js';
import { finalRubric } from './proposed-rubric.js';

export const unifiedAssessmentScoringVersion = 'unified-1.0.0' as const;
/** Bump when source-evidence eligibility changes so Assess All can persist a corrected snapshot. */
export const unifiedAssessmentInputVersion = 'unified-input-1.1.0' as const;
export const unifiedAssessmentWeights = { resume: 40, github: 45, leetcode: 15 } as const;

export const unifiedAssessmentComponentSchema = z.object({
  score: scoreSchema.nullable(),
  status: z.enum(['validated', 'preliminary', 'insufficient_evidence', 'policy_only', 'not_evaluated', 'failed']),
  sourceId: z.string().uuid().nullable(),
  sourceLabel: z.string().nullable(),
}).strict();

export const unifiedAssessmentSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  roleId: roleIdSchema,
  roleLabel: z.string().min(1),
  generatedAt: z.string().datetime({ offset: true }),
  scoringVersion: z.literal(unifiedAssessmentScoringVersion),
  status: z.enum(['completed', 'insufficient_evidence']),
  overallScore: scoreSchema.nullable(),
  weights: z.object({ resume: z.literal(40), github: scoreSchema, leetcode: scoreSchema }).strict().superRefine((weights, context) => {
    if (Math.abs(weights.resume + weights.github + weights.leetcode - 100) > 1e-8) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unified component weights must total 100.' });
  }),
  components: z.object({ resume: unifiedAssessmentComponentSchema, github: unifiedAssessmentComponentSchema, leetcode: unifiedAssessmentComponentSchema }).strict(),
  sourceReferences: z.object({
    platformEvaluationId: z.string().uuid().nullable(),
    resumeScreeningId: z.string().uuid().nullable(),
    githubSnapshotIds: z.array(z.string()),
    leetcodeSnapshotIds: z.array(z.string()),
  }).strict(),
  evidenceCompleteness: z.number().min(0).max(100),
  missingComponents: z.array(z.enum(['resume', 'github', 'leetcode'])),
  strengths: z.array(z.string()),
  improvementAreas: z.array(z.string()),
  limitations: z.array(z.string()),
  explanation: z.string().min(1),
}).strict().superRefine((assessment, context) => {
  if ((assessment.status === 'completed') !== (assessment.overallScore !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['overallScore'], message: 'Only completed assessments have a combined score.' });
  }
  if (assessment.missingComponents.length === 0 && assessment.status !== 'completed') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['missingComponents'], message: 'A complete assessment must have no missing components.' });
  }
  if (assessment.status === 'completed' && (assessment.missingComponents.length > 0
    || (['resume', 'github', 'leetcode'] as const).some((key) => assessment.components[key].status !== 'validated' || assessment.components[key].score === null))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['components'], message: 'A final score requires three validated components and no missing components.' });
  }
  for (const key of ['resume', 'github', 'leetcode'] as const) {
    if (assessment.components[key].status === 'validated' && assessment.components[key].score === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['components', key, 'score'], message: 'A validated component requires an observed score.' });
    }
    if (assessment.components[key].status === 'policy_only' && assessment.components[key].score !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['components', key, 'score'], message: 'A policy-only component is not an observed score.' });
    }
  }
});

export const unifiedAssessmentCreateRequestSchema = z.object({
  roleId: roleIdSchema,
  resumeId: z.string().uuid().nullable(),
}).strict();

export const unifiedReportQuerySchema = z.object({ roleId: roleIdSchema.optional() }).strict();
export const unifiedAssessmentRankingQuerySchema = z.object({ roleId: roleIdSchema }).strict();
export const unifiedAssessmentRankingResponseSchema = z.object({
  roleId: roleIdSchema,
  items: z.array(z.object({
    candidateName: z.string(),
    githubUsername: z.string().nullable(),
    leetcodeUsername: z.string().nullable(),
    /** Current linked validated resume score for display; does not alter the saved assessment calculation. */
    resumeScore: scoreSchema.nullable().optional(),
    rank: z.number().int().positive().nullable(),
    assessment: unifiedAssessmentSchema,
  }).strict()),
  total: z.number().int().nonnegative(),
  ranked: z.number().int().nonnegative(),
}).strict();

export type UnifiedAssessment = z.infer<typeof unifiedAssessmentSchema>;
export type UnifiedAssessmentRankingResponse = z.infer<typeof unifiedAssessmentRankingResponseSchema>;

export function rankUnifiedAssessments(rows: Array<{ candidateName: string; githubUsername?: string | null; leetcodeUsername?: string | null; assessment: UnifiedAssessment }>) {
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (!latest.has(row.assessment.candidateId)) latest.set(row.assessment.candidateId, row);
  const sorted = [...latest.values()].sort((left, right) => {
    const leftScore = left.assessment.overallScore;
    const rightScore = right.assessment.overallScore;
    if (leftScore !== null && rightScore === null) return -1;
    if (leftScore === null && rightScore !== null) return 1;
    if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return rightScore - leftScore;
    return left.candidateName.localeCompare(right.candidateName) || left.assessment.candidateId.localeCompare(right.assessment.candidateId);
  });
  let nextRank = 0;
  const items = sorted.map(({ candidateName, githubUsername = null, leetcodeUsername = null, assessment }) => ({ candidateName, githubUsername, leetcodeUsername, rank: assessment.overallScore === null ? null : ++nextRank, assessment }));
  return { items, ranked: nextRank };
}

export type UnifiedAssessmentInputs = {
  id: string;
  candidateId: string;
  roleId: z.infer<typeof roleIdSchema>;
  roleLabel: string;
  generatedAt: string;
  platformEvaluation: { id: string; candidateId: string; roleId: string; result: {
    scoringVersion?: string;
    targetRole?: string;
    categoryScores: Array<{ categoryId: string; score?: number; status: string; scoreBasis?: string; evidenceRefs?: string[] }>;
    roleWeightsUsed: Record<string, number>;
    evidence?: Array<{ evidenceId: string; categoryId: string; source?: string; availability?: string; normalizedValue?: number }>;
    platformEvidence?: Array<{ evidenceId: string; source: string }>;
    strengths: string[];
    skillGaps: string[];
  } } | null;
  resume: { id: string; status: string; jobTitle: string; evaluation: { status?: string; score?: number } | null; preliminaryScore: number | null } | null;
  resumeRoleMismatch?: boolean;
};

const githubCategoryIds = scoringCategories.map(({ id }) => id).filter((id) => id !== 'problem_solving_dsa');

function unifiedWeights(roleWeights: Record<string, number> | undefined) {
  const defaults = Object.fromEntries(finalRubric.categories.map(({ id, weight }) => [id, weight]));
  const activeWeights = roleWeightsSchema.parse(roleWeights ?? defaults);
  const githubCategoryWeight = githubCategoryIds.reduce((sum, id) => sum + activeWeights[id], 0);
  return { resume: 40 as const, github: 60 * githubCategoryWeight / 100, leetcode: 60 * activeWeights.problem_solving_dsa / 100 };
}

const compatibleResumeTitles: Record<z.infer<typeof roleIdSchema>, ReadonlySet<string>> = {
  software_developer: new Set(['software developer', 'software engineer', 'software development', 'full stack developer', 'full stack engineer', 'full stack software developer', 'frontend developer', 'frontend engineer', 'front end developer', 'front end engineer', 'backend developer', 'backend engineer', 'back end developer', 'back end engineer', 'web developer', 'application developer']),
  ai_ml_engineer: new Set(['ai engineer', 'ai ml engineer', 'artificial intelligence engineer', 'machine learning engineer', 'ml engineer']),
  data_analyst: new Set(['data analyst', 'business data analyst', 'business intelligence analyst', 'bi analyst']),
};

/** Exact title aliases plus known seniority prefixes only; arbitrary titles remain incompatible. */
export function isResumeRoleCompatible(roleId: z.infer<typeof roleIdSchema>, jobTitle: string): boolean {
  const normalized = jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/^(?:senior|sr|principal|staff|lead|junior|jr|associate|mid level)\s+/, '');
  return compatibleResumeTitles[roleId].has(normalized);
}

export function calculateUnifiedAssessment(input: UnifiedAssessmentInputs): UnifiedAssessment {
  const evaluation = input.platformEvaluation;
  const checkedRoleWeights = evaluation ? roleWeightsSchema.safeParse(evaluation.result.roleWeightsUsed) : null;
  const isMatchingEvaluation = evaluation?.candidateId === input.candidateId && evaluation.roleId === input.roleId
    && evaluation.result.targetRole === input.roleId && evaluation.result.scoringVersion === '4.0.1' && checkedRoleWeights?.success === true;
  const result = isMatchingEvaluation ? evaluation.result : null;
  const weights = unifiedWeights(isMatchingEvaluation ? evaluation.result.roleWeightsUsed : undefined);
  const categoryById = new Map((result?.categoryScores ?? []).map((item) => [item.categoryId, item]));
  const evidenceById = new Map((result?.evidence ?? []).map((item) => [item.evidenceId, item]));
  const hasObservedReferences = (item: { categoryId: string; evidenceRefs?: string[] } | undefined) => Boolean(
    item?.evidenceRefs?.length && item.evidenceRefs.every((id) => {
      const evidence = evidenceById.get(id);
      const expectedSource = item.categoryId === 'problem_solving_dsa' ? 'leetcode' : 'github';
      const source = evidence?.source?.trim().toLowerCase();
      const sourceMatches = source === expectedSource || source?.startsWith(`${expectedSource} · `) === true;
      const expectedProvenances = expectedSource === 'github' ? ['github_api'] : ['alfa_leetcode_api', 'candidate_provided'];
      const provenanceMatches = source === expectedSource || expectedProvenances.some((provenance) => source === `${expectedSource} · ${provenance}`);
      return evidence?.categoryId === item.categoryId && sourceMatches && provenanceMatches
        && evidence.availability === 'available' && typeof evidence.normalizedValue === 'number';
    }),
  );
  const githubCategories = githubCategoryIds.map((id) => categoryById.get(id));
  const githubWeights = githubCategoryIds.map((id) => result?.roleWeightsUsed[id] ?? 0);
  const githubWeightTotal = githubWeights.reduce((sum, weight) => sum + weight, 0);
  const githubComplete = Boolean(result && githubCategories.every((item) => item?.status === 'scored' && typeof item.score === 'number' && hasObservedReferences(item)) && githubWeightTotal > 0);
  const githubScore = githubComplete
    ? Math.round((githubCategories.reduce((sum, item, index) => sum + (item?.score ?? 0) * githubWeights[index]!, 0) / githubWeightTotal + Number.EPSILON) * 100) / 100
    : null;
  const leetcodeCategory = categoryById.get('problem_solving_dsa');
  const leetcodePolicyOnly = leetcodeCategory?.scoreBasis === 'optional_missing_zero';
  const leetcodeComplete = leetcodeCategory?.status === 'scored' && typeof leetcodeCategory.score === 'number' && !leetcodePolicyOnly && hasObservedReferences(leetcodeCategory);
  const resumeComplete = input.resume?.status === 'completed' && input.resume.evaluation?.status === 'complete' && typeof input.resume.evaluation.score === 'number';

  const components: UnifiedAssessment['components'] = {
    resume: {
      score: input.resumeRoleMismatch ? null
        : input.resume?.status === 'completed' && input.resume.evaluation?.status === 'complete' && typeof input.resume.evaluation.score === 'number'
          ? input.resume.evaluation.score
          : input.resume?.status === 'completed' && input.resume.evaluation?.status === 'provisional' && typeof input.resume.evaluation.score === 'number'
            ? input.resume.evaluation.score : input.resume?.preliminaryScore ?? null,
      status: !input.resume ? 'not_evaluated' : input.resume.status === 'failed' ? 'failed'
        : input.resumeRoleMismatch ? 'insufficient_evidence'
          : resumeComplete ? 'validated' : input.resume.preliminaryScore !== null ? 'preliminary' : 'insufficient_evidence',
      sourceId: input.resume?.id ?? null,
      sourceLabel: input.resume?.jobTitle ?? null,
    },
    github: {
      score: githubScore,
      status: !result ? 'not_evaluated' : githubComplete ? 'validated' : 'insufficient_evidence',
      sourceId: isMatchingEvaluation ? evaluation.id : null,
      sourceLabel: result?.scoringVersion ?? null,
    },
    leetcode: {
      score: leetcodeComplete ? leetcodeCategory.score! : null,
      status: !result ? 'not_evaluated' : leetcodePolicyOnly ? 'policy_only' : leetcodeComplete ? 'validated' : 'insufficient_evidence',
      sourceId: isMatchingEvaluation ? evaluation.id : null,
      sourceLabel: result?.scoringVersion ?? null,
    },
  };
  const missingComponents: Array<'resume' | 'github' | 'leetcode'> = [];
  for (const key of ['resume', 'github', 'leetcode'] as const) if (components[key].status !== 'validated') missingComponents.push(key);
  const evidenceCompleteness = Math.round((3 - missingComponents.length) / 3 * 100);
  const overallScore = missingComponents.length === 0
    ? Math.round(((components.resume.score! * weights.resume / 100 + components.github.score! * weights.github / 100 + components.leetcode.score! * weights.leetcode / 100) + Number.EPSILON) * 100) / 100
    : null;
  const sourceEvidence = result?.platformEvidence ?? [];
  const limitations = [
    `Unified score version unified-1.0.0 uses 40% resume and allocates the remaining 60% between the five GitHub categories and LeetCode DSA in proportion to the selected role's saved v4 weights (${weights.github}% GitHub, ${weights.leetcode}% LeetCode); it is decision support, not hiring suitability.`,
    'GitHub and LeetCode inputs are public provider snapshots and do not verify account ownership or engineering quality.',
    ...(components.resume.status === 'preliminary' ? ['The preliminary resume match is shown for context and excluded from the final score.'] : []),
    ...(input.resumeRoleMismatch ? ['The linked resume evaluation targets a different job title and was excluded from this role assessment.'] : []),
    ...(leetcodePolicyOnly ? ['The v4 DSA zero reflects the optional-profile policy, not observed LeetCode evidence, so it is excluded from the unified score.'] : []),
  ];
  const assessment = {
    id: input.id,
    candidateId: input.candidateId,
    roleId: input.roleId,
    roleLabel: input.roleLabel,
    generatedAt: input.generatedAt,
    scoringVersion: unifiedAssessmentScoringVersion,
    status: overallScore === null ? 'insufficient_evidence' as const : 'completed' as const,
    overallScore,
    weights,
    components,
    sourceReferences: {
      platformEvaluationId: isMatchingEvaluation ? evaluation.id : null,
      resumeScreeningId: input.resume?.id ?? null,
      githubSnapshotIds: sourceEvidence.filter(({ source }) => source.toLowerCase().includes('github')).map(({ evidenceId }) => evidenceId),
      leetcodeSnapshotIds: sourceEvidence.filter(({ source }) => source.toLowerCase().includes('leetcode')).map(({ evidenceId }) => evidenceId),
    },
    evidenceCompleteness,
    missingComponents,
    strengths: result?.strengths ?? [],
    improvementAreas: result?.skillGaps ?? [],
    limitations,
    explanation: overallScore === null
      ? 'No combined score is calculated until validated resume, complete GitHub category, and observed LeetCode DSA scores are all available for the same candidate and selected role.'
      : `Combined score = resume ${components.resume.score} × ${weights.resume}% + GitHub ${components.github.score} × ${weights.github}% + LeetCode ${components.leetcode.score} × ${weights.leetcode}%, rounded to two decimals.`,
  };
  return unifiedAssessmentSchema.parse(assessment);
}
