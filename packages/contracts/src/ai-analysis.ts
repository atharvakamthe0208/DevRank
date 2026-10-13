import { z } from 'zod';

const evidenceReferenceListSchema = z.array(z.string().min(1)).max(100).refine(
  (references) => new Set(references).size === references.length,
  'Evidence references must be unique.',
);

export const aiAnalysisFindingSchema = z.object({
  claim: z.string().trim().min(1).max(1000),
  evidenceReferences: z.array(z.string().min(1)).min(1).max(100).refine(
    (references) => new Set(references).size === references.length,
    'Evidence references must be unique.',
  ),
}).strict();

const aiAnalysisContentSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  strengths: z.array(aiAnalysisFindingSchema).max(20),
  developmentAreas: z.array(aiAnalysisFindingSchema).max(20),
  roleSuitability: aiAnalysisFindingSchema.nullable(),
  evidenceReferences: evidenceReferenceListSchema,
  limitations: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();

const completedAnalysisSchema = aiAnalysisContentSchema.extend({ status: z.literal('completed') }).superRefine((analysis, context) => {
  if (analysis.limitations.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['limitations'], message: 'A completed analysis must state its limitations.' });
  }
  const findingReferences = [
    ...analysis.strengths.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...analysis.developmentAreas.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...(analysis.roleSuitability?.evidenceReferences ?? []),
  ];
  if (analysis.roleSuitability === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['roleSuitability'], message: 'A completed analysis requires an evidence-referenced role-suitability explanation.' });
  }
  if (analysis.evidenceReferences.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidenceReferences'], message: 'A completed analysis requires evidence references.' });
  }
  if ([...analysis.evidenceReferences].sort().join('|') !== [...new Set(findingReferences)].sort().join('|')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidenceReferences'], message: 'Top-level evidence references must match the references attached to findings.' });
  }
});

const insufficientEvidenceAnalysisSchema = aiAnalysisContentSchema.extend({ status: z.literal('insufficient_evidence') }).superRefine((analysis, context) => {
  const findingReferences = [
    ...analysis.strengths.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...analysis.developmentAreas.flatMap(({ evidenceReferences }) => evidenceReferences),
    ...(analysis.roleSuitability?.evidenceReferences ?? []),
  ];
  if (analysis.limitations.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['limitations'], message: 'Insufficient evidence must be explained as a limitation.' });
  }
  if ([...analysis.evidenceReferences].sort().join('|') !== [...new Set(findingReferences)].sort().join('|')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['evidenceReferences'], message: 'Top-level evidence references must match the references attached to findings.' });
  }
});

export const aiAnalysisSchema = z.union([completedAnalysisSchema, insufficientEvidenceAnalysisSchema]);

export const aiAnalysisUnavailableReasonSchema = z.enum([
  'not_configured',
  'timeout',
  'rate_limited',
  'provider_error',
  'malformed_response',
  'invalid_output',
  'invalid_evaluation',
  'invalid_evidence_reference',
]);

export const aiAnalysisResultSchema = z.union([
  completedAnalysisSchema,
  insufficientEvidenceAnalysisSchema,
  z.object({ status: z.literal('unavailable'), reason: aiAnalysisUnavailableReasonSchema }).strict(),
  z.object({ status: z.literal('failed'), reason: aiAnalysisUnavailableReasonSchema }).strict(),
]);

export type AiAnalysisFinding = z.infer<typeof aiAnalysisFindingSchema>;
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
export type AiAnalysisResult = z.infer<typeof aiAnalysisResultSchema>;
