import { z } from 'zod';

export const candidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  githubUsername: z.string().optional(),
  leetcodeUsername: z.string().optional(),
  hackerrankUsername: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Candidate = z.infer<typeof candidateSchema>;
