import { z } from 'zod';
import { candidateSchema } from './candidate.js';

const usernameSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/, 'Use a username, not a profile URL');
const emailSchema = z.string().trim().email().max(254);

export const candidateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema.optional(),
  githubUsername: usernameSchema.optional(),
  leetcodeUsername: usernameSchema.optional(),
  hackerrankUsername: usernameSchema.optional(),
}).strict();

export const candidateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: emailSchema.nullable().optional(),
  githubUsername: usernameSchema.nullable().optional(),
  leetcodeUsername: usernameSchema.nullable().optional(),
  hackerrankUsername: usernameSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one supported field is required');

export const candidateIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const candidateListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export const candidateListResponseSchema = z.object({
  items: z.array(candidateSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive().max(100),
  total: z.number().int().nonnegative(),
});

export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;
