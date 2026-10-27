import { z } from 'zod';
import { roleIdSchema } from './scoring.js';

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

export const screeningRubricVersion = 'resume-job-match-1.0.0' as const;
export const screeningCategories = [
  { id: 'required_technical_skills', label: 'Required technical skills', weight: 35 },
  { id: 'relevant_experience', label: 'Relevant experience', weight: 25 },
  { id: 'projects_practical_evidence', label: 'Projects and practical evidence', weight: 20 },
  { id: 'education_certifications', label: 'Education and certifications', weight: 10 },
  { id: 'additional_requirements', label: 'Additional job requirements', weight: 10 },
] as const;
export const screeningCategoryIdSchema = z.enum(screeningCategories.map(({ id }) => id) as [string, ...string[]]);
export const screeningStatusSchema = z.enum(['uploaded', 'queued', 'processing', 'completed', 'failed']);
export const screeningRetryableErrorCodes = ['SCREENING_AI_RATE_LIMITED', 'SCREENING_AI_UNAVAILABLE', 'SCREENING_AI_INVALID_RESPONSE', 'SCREENING_QUEUE_UNAVAILABLE', 'RESUME_PROCESSING_FAILED'] as const;
export const requirementStatusSchema = z.enum(['demonstrated', 'partially_demonstrated', 'not_demonstrated', 'insufficient_evidence', 'not_applicable']);
export const screeningRequirementSchema = z.object({
  id: z.string().min(1).max(80),
  categoryId: screeningCategoryIdSchema,
  description: z.string().min(1).max(500),
  importance: z.enum(['required', 'preferred']),
});
export const screeningRequirementsSchema = z.array(screeningRequirementSchema).min(1).max(40);
export const requirementResultSchema = screeningRequirementSchema.extend({
  status: requirementStatusSchema,
  evidence: z.array(z.object({ excerpt: z.string().min(1).max(500), section: z.string().max(80).optional() })).max(10),
  explanation: z.string().min(1).max(1000),
  confidence: z.number().min(0).max(1),
});
export const screeningCategoryResultSchema = z.object({
  categoryId: screeningCategoryIdSchema,
  weight: z.number().positive().max(100),
  score: z.number().min(0).max(100).optional(),
  weightedContribution: z.number().min(0).max(100).optional(),
  evaluableWeight: z.number().min(0).max(100),
  status: z.enum(['scored', 'insufficient_evidence', 'not_applicable']),
  requirementIds: z.array(z.string()),
});
export const screeningScoreSchema = z.object({
  rubricVersion: z.literal(screeningRubricVersion),
  scoreType: z.literal('resume_job_match'),
  status: z.enum(['complete', 'provisional', 'insufficient_evidence']),
  score: z.number().min(0).max(100).optional(),
  evidenceCoverage: z.number().min(0).max(100),
  categories: z.array(screeningCategoryResultSchema).length(screeningCategories.length),
  requirements: z.array(requirementResultSchema),
});
export const preliminaryCriterionSchema = z.object({
  id: z.string().min(1).max(80),
  categoryId: screeningCategoryIdSchema,
  description: z.string().min(1).max(500),
  importance: z.enum(['required', 'preferred']),
  status: z.enum(['supported', 'unverified']),
  matchedTerms: z.array(z.string().min(1).max(40)).max(40),
  matchPercentage: z.number().min(0).max(100).optional(),
  evidenceExcerpt: z.string().min(1).max(240).optional(),
}).strict();
export const preliminaryEvaluationSchema = z.object({
  rubricVersion: z.literal('resume-document-match-1.0.0'),
  score: z.number().min(0).max(100),
  evidenceCoverage: z.number().min(0).max(100),
  criteria: z.array(preliminaryCriterionSchema).min(1).max(40),
}).strict();
export const screeningCreateSchema = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  jobDescription: z.string().trim().min(50).max(30000),
  candidateIds: z.array(z.string().uuid().nullable()).min(1).max(20).optional().superRefine((ids, context) => {
    if (!ids) return;
    const selected = ids.filter((id): id is string => id !== null);
    if (!selected.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Select at least one candidate when providing a candidate mapping.' });
    if (new Set(selected).size !== selected.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'A candidate can be mapped to only one resume in a screening session.' });
  }),
}).strict();
export const screeningSubmissionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(['created', 'processing', 'completed', 'partial', 'failed']),
  resumes: z.array(z.object({
    id: z.string().uuid(),
    filename: z.string().min(1),
    status: screeningStatusSchema,
  })).min(1).max(20),
}).strict();
export const screeningResumeDetailsSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid().nullable().optional(),
  filename: z.string().min(1),
  status: screeningStatusSchema,
  candidate: z.object({ name: z.string().min(1).max(120).nullable() }).nullable(),
  evaluation: screeningScoreSchema.nullable(),
  preliminaryEvaluation: preliminaryEvaluationSchema.nullable().optional(),
  errorCode: z.string().min(1).max(80).optional(),
  retryCount: z.number().int().min(0).max(3).optional(),
  error: z.string().optional(),
}).strict();
export const screeningDetailsResponseSchema = z.object({
  sessionId: z.string().uuid(),
  jobTitle: z.string(),
  status: z.enum(['created', 'processing', 'completed', 'partial', 'failed']),
  resumes: z.array(screeningResumeDetailsSchema).min(1).max(20),
}).strict();
export const screeningComparisonRequestSchema = z.object({
  resumeIds: z.array(z.string().uuid()).min(2).max(20),
}).strict().refine(({ resumeIds }) => new Set(resumeIds).size === resumeIds.length, {
  message: 'Select each resume only once.', path: ['resumeIds'],
});
export const screeningRankingSchema = z.object({
  ranked: z.array(z.object({ resumeId: z.string().uuid(), rank: z.number().int().positive(), score: z.number().min(0).max(100) })).max(20),
  unranked: z.array(z.object({ resumeId: z.string().uuid(), filename: z.string(), status: screeningStatusSchema, reason: z.string() })).max(20),
  rankingCriteria: z.string(),
}).strict();
export const screeningRankingResponseSchema = z.object({
  sessionId: z.string().uuid(),
  jobTitle: z.string(),
  ranking: screeningRankingSchema,
}).strict();
export const screeningRetryResponseSchema = z.object({
  resumeId: z.string().uuid(),
  status: z.literal('queued'),
}).strict();
export const screeningComparisonResponseSchema = z.object({
  sessionId: z.string().uuid(),
  jobTitle: z.string(),
  candidates: z.array(screeningResumeDetailsSchema).min(2).max(20),
  ranking: screeningRankingSchema,
}).strict();
export const screeningReportResponseSchema = z.object({
  generatedAt: z.string().datetime(),
  selectedResumeIds: z.array(z.string().uuid()).min(2).max(20),
  details: screeningDetailsResponseSchema,
  ranking: screeningRankingSchema,
}).strict();
export const screeningErrorSchema = z.object({ code: z.string(), message: z.string() });

export type ScreeningCategoryId = z.infer<typeof screeningCategoryIdSchema>;
export type ScreeningRequirement = z.infer<typeof screeningRequirementSchema>;
export type RequirementResult = z.infer<typeof requirementResultSchema>;
export type ScreeningScore = z.infer<typeof screeningScoreSchema>;
export type ScreeningDetailsResponse = z.infer<typeof screeningDetailsResponseSchema>;
export type ScreeningComparisonResponse = z.infer<typeof screeningComparisonResponseSchema>;
export type ScreeningReportResponse = z.infer<typeof screeningReportResponseSchema>;
