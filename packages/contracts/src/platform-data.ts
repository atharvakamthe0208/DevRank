import { z } from 'zod';

export const platformNameSchema = z.enum(['github', 'leetcode', 'hackerrank', 'candidate_provided']);
export const sourceAvailabilitySchema = z.enum(['available', 'unavailable', 'not_provided', 'error']);
export const platformEvidenceSchema = z.object({
  platform: platformNameSchema,
  availability: sourceAvailabilitySchema,
  observedAt: z.string().datetime().optional(),
  evidence: z.array(z.record(z.unknown())).default([]),
});
export type PlatformEvidence = z.infer<typeof platformEvidenceSchema>;
