import { z } from 'zod';

const timestampSchema = z.string().datetime({ offset: true });

export const adminRecruiterDetailsSchema = z.object({
  profile: z.object({
    userId: z.string().uuid(),
    email: z.string().email().nullable(),
    displayName: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    companyName: z.string().nullable(),
    jobTitle: z.string().nullable(),
    companyWebsite: z.string().nullable(),
    locationCity: z.string().nullable(),
    locationCountry: z.string().nullable(),
    role: z.literal('recruiter'),
    approvalStatus: z.enum(['pending', 'approved', 'rejected', 'suspended']),
    emailConfirmed: z.boolean(),
    registeredAt: timestampSchema,
    profileUpdatedAt: timestampSchema,
    lastApprovalDecision: z.object({
      status: z.enum(['approved', 'rejected']),
      decidedAt: timestampSchema,
      decidedByUserId: z.string().uuid(),
    }).nullable(),
  }),
  stats: z.object({
    totalEvaluations: z.number().int().nonnegative(),
    completedEvaluations: z.number().int().nonnegative(),
    inProgressEvaluations: z.number().int().nonnegative(),
    distinctCandidatesEvaluated: z.number().int().nonnegative(),
    resumeScreeningsInitiated: z.number().int().nonnegative(),
    completedResumeScreenings: z.number().int().nonnegative(),
    averageCompletedEvaluationScore: z.number().min(0).max(100).nullable(),
    recentActivityCount30Days: z.number().int().nonnegative(),
  }),
  recentActivity: z.array(z.object({
    id: z.string(),
    type: z.enum(['evaluation_created', 'screening_initiated', 'screening_completed', 'recruiter_approved', 'recruiter_rejected']),
    occurredAt: timestampSchema,
    summary: z.string(),
  })).max(20),
});

export type AdminRecruiterDetails = z.infer<typeof adminRecruiterDetailsSchema>;
