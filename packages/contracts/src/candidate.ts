import { z } from 'zod';

export const candidateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email().optional(),
  createdAt: z.string().datetime(),
});
export type Candidate = z.infer<typeof candidateSchema>;
