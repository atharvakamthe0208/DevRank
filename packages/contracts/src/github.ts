import { z } from 'zod';

export const githubProfileQuerySchema = z.object({
  profile: z.string().trim().min(1).max(255),
}).strict();

export const githubRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  private: z.boolean(),
  name: z.string(),
  full_name: z.string(),
  html_url: z.string().url(),
  description: z.string().nullable(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  language: z.string().nullable(),
  updated_at: z.string().datetime(),
});

export const githubContributionDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  contributionCount: z.number().int().nonnegative(),
}).strict();

const contributionStateSchema = z.enum(['available', 'partial', 'unavailable']);
const reasonCodeSchema = z.enum(['not_configured', 'provider_error', 'provider_timeout', 'provider_unavailable', 'malformed_response', 'rate_limited', 'missing_history', 'attribution_mismatch', 'partial_response', 'truncated_history', 'duplicate_conflict']);

export const githubCurrentYearContributionsSchema = z.object({
  status: contributionStateSchema,
  year: z.number().int().min(2000).max(2100),
  timezone: z.literal('UTC'),
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  observedThrough: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }),
  totalContributions: z.number().int().nonnegative().optional(),
  dailyContributions: z.array(githubContributionDaySchema).optional(),
  weeklyContributions: z.array(z.object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    contributionCount: z.number().int().nonnegative(),
  }).strict()).optional(),
  observedWeeks: z.number().int().nonnegative().optional(),
  activeWeeks: z.number().int().nonnegative().optional(),
  activeWeekCoveragePercent: z.number().finite().min(0).max(100).optional(),
  contributionsPerObservedWeek: z.number().finite().nonnegative().optional(),
  contributionTypes: z.object({
    commits: z.number().int().nonnegative().optional(),
    pullRequestsOpened: z.number().int().nonnegative().optional(),
    issuesOpened: z.number().int().nonnegative().optional(),
    reviewsSubmitted: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  reasons: z.array(reasonCodeSchema),
}).strict().superRefine((value, context) => {
  if (value.status === 'unavailable' && (value.totalContributions !== undefined || value.dailyContributions !== undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['status'], message: 'Unavailable calendar data cannot include contribution values.' });
  }
});

export const githubDevelopmentActivitySchema = z.object({
  status: contributionStateSchema,
  totalCommitContributions: z.number().int().nonnegative().optional(),
  activeCommitDays: z.number().int().nonnegative().optional(),
  activeCommitWeeks: z.number().int().nonnegative().optional(),
  repositoriesWithCommitContributions: z.number().int().nonnegative().optional(),
  duplicateDailyRecords: z.number().int().nonnegative(),
  reasons: z.array(reasonCodeSchema),
}).strict();

export const githubCollaborationActivitySchema = z.object({
  status: contributionStateSchema,
  pullRequestsOpened: z.number().int().nonnegative().optional(),
  issuesOpened: z.number().int().nonnegative().optional(),
  reviewsSubmitted: z.number().int().nonnegative().optional(),
  reasons: z.array(reasonCodeSchema),
}).strict();

export const githubInsightsSchema = z.object({
  requestedLogin: z.string().min(1),
  attributionStatus: z.enum(['matched', 'mismatched', 'unavailable']),
  attributedLogin: z.string().min(1).optional(),
  currentYearContributions: githubCurrentYearContributionsSchema,
  developmentActivity: githubDevelopmentActivitySchema,
  collaboration: githubCollaborationActivitySchema,
  limitations: z.array(z.string().min(1)),
}).strict();
export type GitHubInsights = z.infer<typeof githubInsightsSchema>;

export const githubProfileResponseSchema = z.object({
  username: z.string(),
  profileUrl: z.string().url(),
  publicRepositoryCount: z.number().int().nonnegative(),
  followers: z.number().int().nonnegative(),
  following: z.number().int().nonnegative(),
  repositories: z.array(z.object({
    id: z.number().int().nonnegative(),
    name: z.string(),
    fullName: z.string(),
    url: z.string().url(),
    description: z.string().nullable(),
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    primaryLanguage: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })),
  repositoriesReturned: z.number().int().nonnegative(),
  repositoriesTruncated: z.boolean(),
  insights: githubInsightsSchema.optional(),
}).strict();

export type GitHubProfileResponse = z.infer<typeof githubProfileResponseSchema>;

export const githubSyncRequestSchema = z.object({
  profile: z.string().trim().min(1).max(255),
}).strict();

export const githubSyncResponseSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  source: z.literal('github'),
  availability: z.literal('available'),
  provenance: z.literal('github_api'),
  // Supabase/PostgREST may serialize timestamptz with an explicit +00:00 offset.
  syncedAt: z.string().datetime({ offset: true }),
  profile: githubProfileResponseSchema,
}).strict();

export type GitHubSyncRequest = z.infer<typeof githubSyncRequestSchema>;
export type GitHubSyncResponse = z.infer<typeof githubSyncResponseSchema>;
