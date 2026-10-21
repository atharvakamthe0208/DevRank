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

const candidateImportCandidateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema.optional(),
  githubUsername: usernameSchema.optional(),
  leetcodeUsername: usernameSchema.optional(),
}).strict();

const candidateImportRowSchema = z.object({
  rowNumber: z.number().int().min(2).max(1_000_000),
  candidate: candidateImportCandidateSchema,
}).strict();

function uniqueImportRowNumbers(rows: Array<z.infer<typeof candidateImportRowSchema>>, context: z.RefinementCtx) {
  const seen = new Set<number>();
  rows.forEach((row, index) => {
    if (seen.has(row.rowNumber)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rows', index, 'rowNumber'], message: 'CSV row numbers must be unique' });
    seen.add(row.rowNumber);
  });
}

export const candidateImportRowsSchema = z.object({
  rows: z.array(candidateImportRowSchema).min(1).max(500),
}).strict().superRefine(({ rows }, context) => uniqueImportRowNumbers(rows, context));

export const candidateImportPreviewResponseSchema = z.object({
  rows: z.array(z.object({
    rowNumber: z.number().int().positive(),
    status: z.enum(['ready', 'duplicate']),
    potentialDuplicate: z.boolean(),
    candidateId: z.string().uuid().nullable(),
  }).strict()),
}).strict();

export const candidateBulkImportRequestSchema = z.object({
  rows: z.array(candidateImportRowSchema).min(1).max(500),
  skipDuplicates: z.boolean(),
}).strict().superRefine(({ rows }, context) => uniqueImportRowNumbers(rows, context));

export const candidateBulkImportResponseSchema = z.object({
  results: z.array(z.object({
    rowNumber: z.number().int().positive(),
    status: z.enum(['created', 'skipped', 'failed']),
    reason: z.enum(['potential_duplicate', 'candidate_not_created']).optional(),
    candidateId: z.string().uuid().optional(),
  }).strict()),
  createdCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  const counts = {
    created: value.results.filter((row) => row.status === 'created').length,
    skipped: value.results.filter((row) => row.status === 'skipped').length,
    failed: value.results.filter((row) => row.status === 'failed').length,
  };
  if (counts.created !== value.createdCount || counts.skipped !== value.skippedCount || counts.failed !== value.failedCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['results'], message: 'Status counts must match row results' });
  }
  const seen = new Set<number>();
  value.results.forEach((row, index) => {
    if (seen.has(row.rowNumber)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['results', index, 'rowNumber'], message: 'Result row numbers must be unique' });
    seen.add(row.rowNumber);
    if (row.status === 'created' && !row.candidateId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['results', index, 'candidateId'], message: 'Created rows require a candidate ID' });
    if (row.status === 'skipped' && row.reason !== 'potential_duplicate') context.addIssue({ code: z.ZodIssueCode.custom, path: ['results', index, 'reason'], message: 'Skipped rows require a skip reason' });
    if (row.status === 'failed' && row.reason !== 'candidate_not_created') context.addIssue({ code: z.ZodIssueCode.custom, path: ['results', index, 'reason'], message: 'Failed rows require a failure reason' });
  });
});

export type CandidateCreateInput = z.infer<typeof candidateCreateSchema>;
export type CandidateUpdateInput = z.infer<typeof candidateUpdateSchema>;
export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;
export type CandidateImportRows = z.infer<typeof candidateImportRowsSchema>;
export type CandidateImportPreviewResponse = z.infer<typeof candidateImportPreviewResponseSchema>;
export type CandidateBulkImportRequest = z.infer<typeof candidateBulkImportRequestSchema>;
export type CandidateBulkImportResponse = z.infer<typeof candidateBulkImportResponseSchema>;
