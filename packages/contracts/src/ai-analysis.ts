import { z } from 'zod';
import { persistedEvaluationSchema } from './evaluation.js';

const explanationText = z.string().trim().min(1).max(1200);
const referencedObservationSchema = z.object({
  text: explanationText,
  evidenceReferences: z.array(z.string().min(1).max(100)).max(12),
}).strict();

/** Provider output, validated again by the API before it reaches a caller. */
export const aiAnalysisContentSchema = z.object({
  summary: z.string().trim().min(1).max(1600),
  summaryEvidenceReferences: z.array(z.string().min(1).max(100)).min(1).max(12),
  strengths: z.array(referencedObservationSchema).max(8),
  weaknesses: z.array(referencedObservationSchema).max(8),
  roleRelevance: explanationText,
  roleRelevanceEvidenceReferences: z.array(z.string().min(1).max(100)).min(1).max(12),
  recommendations: z.array(referencedObservationSchema).max(8),
}).strict();
export type AiAnalysisContent = z.infer<typeof aiAnalysisContentSchema>;

export const aiAnalysisResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
    evaluation: persistedEvaluationSchema,
    analysis: aiAnalysisContentSchema,
  }).strict(),
  z.object({
    status: z.literal('insufficient_evidence'),
    evaluation: persistedEvaluationSchema,
    analysis: z.null(),
  }).strict(),
]);
export type AiAnalysisResponse = z.infer<typeof aiAnalysisResponseSchema>;
export const aiAnalysisRequestSchema = z.object({}).strict().optional();
