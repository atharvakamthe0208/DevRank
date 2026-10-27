import { z } from 'zod';
import { proposedEvaluationReportSchema } from './proposed-report.js';

export const dashboardEvaluationStatusSchema = z.enum([
  'pending', 'in_progress', 'completed', 'insufficient_evidence', 'failed',
]);

export const dashboardResponseSchema = z.object({
  candidateCount: z.number().int().nonnegative(),
  evaluationCount: z.number().int().nonnegative(),
  statusCounts: z.record(dashboardEvaluationStatusSchema, z.number().int().nonnegative()),
  recentEvaluations: z.array(z.object({
    id: z.string().uuid(),
    candidateId: z.string().uuid(),
    candidateName: z.string().min(1),
    status: dashboardEvaluationStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    score: z.number().finite().min(0).max(100).optional(),
    scoringVersion: z.string().nullable(),
    finalReport: proposedEvaluationReportSchema.optional(),
    finalReportUnavailable: z.boolean().optional(),
  }).strict()).max(10),
}).strict();

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
