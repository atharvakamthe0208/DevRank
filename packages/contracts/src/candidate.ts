import { z } from 'zod';

export const candidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  githubUsername: z.string().optional(),
  leetcodeUsername: z.string().optional(),
  hackerrankUsername: z.string().optional(),
  // PostgreSQL/PostgREST timestamptz values may use offsets such as +00:00 rather than Z.
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type Candidate = z.infer<typeof candidateSchema>;
