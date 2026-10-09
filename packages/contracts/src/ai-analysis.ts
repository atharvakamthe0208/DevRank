import { z } from 'zod';

export const aiAnalysisSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  caveats: z.array(z.string()),
  evidenceReferences: z.array(z.string()),
});
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
