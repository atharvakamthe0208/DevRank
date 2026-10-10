import { z } from 'zod';
import { scoringCategorySchema, scoreSchema } from './scoring.js';

export const evidenceSchema = z.object({
  evidenceId: z.string().min(1),
  evidenceType: z.enum(['technical_screen', 'coding_assessment', 'project', 'work_sample', 'structured_interview', 'learning_record', 'portfolio', 'other']),
  source: z.string().min(1),
  description: z.string().min(1),
  originalValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  normalizedValue: scoreSchema.optional(),
  verificationStatus: z.enum(['verified', 'partially_verified', 'unverified']),
  observedAt: z.string().datetime().optional(),
  categoryId: scoringCategorySchema,
  availability: z.enum(['available', 'missing']),
}).superRefine((evidence, context) => {
  if (evidence.availability === 'missing' && evidence.normalizedValue !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['normalizedValue'], message: 'Missing evidence cannot have a normalized value.' });
});
export const evidenceListSchema = z.array(evidenceSchema);
export type Evidence = z.infer<typeof evidenceSchema>;
