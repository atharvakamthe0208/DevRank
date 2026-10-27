import { z } from 'zod';
import { candidateSchema } from './candidate.js';
import { finalReportCategorySchema } from './proposed-report.js';
import { unifiedAssessmentSchema } from './unified-assessment.js';

export const unifiedReportSourceSchema = z.object({
  status: z.enum(['available', 'partial', 'unavailable', 'not_evaluated']),
  provenance: z.string().nullable(),
  capturedAt: z.string().datetime({ offset: true }).nullable(),
  values: z.record(z.unknown()),
  findings: z.array(finalReportCategorySchema),
  limitations: z.array(z.string()),
}).strict();

export const unifiedCandidateReportSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  candidate: candidateSchema,
  job: z.object({ roleId: z.string().nullable(), roleLabel: z.string().nullable(), description: z.string().nullable() }).strict(),
  platformEvaluation: z.object({
    status: z.enum(['completed', 'insufficient_evidence', 'not_evaluated', 'historical']),
    evaluatedAt: z.string().datetime({ offset: true }).nullable(),
    overallIndex: z.number().min(0).max(100).nullable(),
    rubricNotice: z.string().nullable(),
    strengths: z.array(z.string()),
    improvementAreas: z.array(z.string()),
  }).strict(),
  assessment: unifiedAssessmentSchema.nullable(),
  sources: z.object({ github: unifiedReportSourceSchema, leetcode: unifiedReportSourceSchema }).strict(),
  resume: z.object({
    id: z.string().uuid().nullable(),
    status: z.enum(['unlinked', 'unavailable', 'available']),
    message: z.string(),
    jobTitle: z.string().nullable(),
    jobDescription: z.string().nullable(),
    evaluatedAt: z.string().datetime({ offset: true }).nullable(),
    validatedScore: z.number().min(0).max(100).nullable(),
    preliminaryScore: z.number().min(0).max(100).nullable(),
    statusLabel: z.string().nullable(),
    evidence: z.array(z.string()),
    limitations: z.array(z.string()),
  }).strict(),
  linkableResumes: z.array(z.object({ id: z.string().uuid(), filename: z.string(), candidateName: z.string().nullable(), jobTitle: z.string(), status: z.string(), scoreLabel: z.string(), score: z.number().min(0).max(100).nullable() }).strict()),
}).strict();

export const unifiedReportResumeLinkRequestSchema = z.object({ resumeId: z.string().uuid() }).strict();

export type UnifiedCandidateReport = z.infer<typeof unifiedCandidateReportSchema>;
