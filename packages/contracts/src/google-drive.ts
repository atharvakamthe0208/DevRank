import { z } from 'zod';

export const googleDriveResumeScreenRequestSchema = z.object({
  jobTitle: z.string().trim().min(1).max(200),
  jobDescription: z.string().trim().min(50).max(30000),
  resumes: z.array(z.object({
    fileId: z.string().trim().min(1).max(500),
    candidateId: z.string().uuid(),
  }).strict()).min(1).max(20),
}).strict().superRefine((value, context) => {
  const candidates = new Set<string>();
  for (const [index, resume] of value.resumes.entries()) {
    if (candidates.has(resume.candidateId)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['resumes', index, 'candidateId'], message: 'Each resume must belong to a different candidate.' });
    candidates.add(resume.candidateId);
  }
});

export const googleDriveResumeScreenResponseSchema = z.object({
  results: z.array(z.object({
    candidateId: z.string().uuid(),
    fileId: z.string().min(1).max(500),
    status: z.enum(['queued', 'failed']),
    sessionId: z.string().uuid().optional(),
    resumeId: z.string().uuid().optional(),
    code: z.string().regex(/^[A-Z0-9_]{1,64}$/).optional(),
    message: z.string().max(300).optional(),
  }).strict()).min(1).max(20),
}).strict();

export type GoogleDriveResumeScreenRequest = z.infer<typeof googleDriveResumeScreenRequestSchema>;
export type GoogleDriveResumeScreenResponse = z.infer<typeof googleDriveResumeScreenResponseSchema>;
