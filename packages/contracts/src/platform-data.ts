import { z } from 'zod';
import { githubSyncResponseSchema } from './github.js';

export const platformNameSchema = z.enum(['github', 'leetcode', 'hackerrank', 'candidate_provided']);
export const sourceAvailabilitySchema = z.enum(['available', 'unavailable', 'not_provided', 'error']);
export const platformEvidenceSchema = z.object({
  platform: platformNameSchema,
  availability: sourceAvailabilitySchema,
  observedAt: z.string().datetime().optional(),
  evidence: z.array(z.record(z.unknown())).default([]),
});
export type PlatformEvidence = z.infer<typeof platformEvidenceSchema>;

const nonNegativeCount = z.number().int().nonnegative();
const leetCodeStatisticsSchema = z.object({
  problemsSolved: nonNegativeCount.optional(),
  easySolved: nonNegativeCount.optional(),
  mediumSolved: nonNegativeCount.optional(),
  hardSolved: nonNegativeCount.optional(),
}).strict();
const hackerRankStatisticsSchema = z.object({
  points: z.number().nonnegative().optional(),
  badges: nonNegativeCount.optional(),
  certificates: nonNegativeCount.optional(),
}).strict();

function platformSubmissionSchema<T extends z.ZodTypeAny>(
  platform: 'leetcode' | 'hackerrank',
  statisticsSchema: T,
  hostname: string,
) {
  return z.object({
    platform: z.literal(platform),
    profileUrl: z.string().url().optional(),
    handle: z.string().trim().min(1).max(100).optional(),
    availability: z.enum(['available', 'unavailable', 'not_provided']),
    statistics: statisticsSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (!value.profileUrl && !value.handle) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['handle'], message: 'Provide a profile URL or handle' });
    }
    if (value.profileUrl) {
      try {
        const url = new URL(value.profileUrl);
        if (url.protocol !== 'https:' || !(url.hostname === hostname || url.hostname.endsWith(`.${hostname}`))) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileUrl'], message: `Profile URL must use ${hostname}` });
        }
      } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileUrl'], message: 'Profile URL is invalid' });
      }
    }
    const hasStats = value.statistics !== undefined
      && Object.values(value.statistics as Record<string, unknown>).some((item) => item !== undefined);
    if (value.availability === 'available' && !hasStats) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['statistics'], message: 'Available data must include at least one statistic' });
    }
    if (value.availability !== 'available' && value.statistics !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['statistics'], message: 'Statistics are only accepted when availability is available' });
    }
  });
}

export const leetCodeSubmissionSchema = platformSubmissionSchema('leetcode', leetCodeStatisticsSchema, 'leetcode.com');
export const hackerRankSubmissionSchema = platformSubmissionSchema('hackerrank', hackerRankStatisticsSchema, 'hackerrank.com');
export const candidatePlatformSubmissionSchema = z.union([leetCodeSubmissionSchema, hackerRankSubmissionSchema]);
export type CandidatePlatformSubmission = z.infer<typeof candidatePlatformSubmissionSchema>;

export const candidatePlatformResponseSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  platform: z.enum(['leetcode', 'hackerrank']),
  availability: z.enum(['available', 'unavailable', 'not_provided']),
  provenance: z.literal('candidate_provided'),
  profileUrl: z.string().url().optional(),
  handle: z.string().optional(),
  statistics: z.record(z.number().nonnegative()).optional(),
  submittedAt: z.string().datetime(),
}).strict();

export type CandidatePlatformResponse = z.infer<typeof candidatePlatformResponseSchema>;

export const candidatePlatformDataResponseSchema = z.object({
  items: z.array(z.union([candidatePlatformResponseSchema, githubSyncResponseSchema])),
}).strict();
export type CandidatePlatformDataResponse = z.infer<typeof candidatePlatformDataResponseSchema>;
