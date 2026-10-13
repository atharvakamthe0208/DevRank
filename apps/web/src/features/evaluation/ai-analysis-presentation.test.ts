import { describe, expect, it } from 'vitest';
import { aiAnalysisResponseSchema, scoringCategories, type PersistedEvaluation } from '@devrank/contracts';
import { ApiRequestError } from '../../lib/api/client';
import { aiAnalysisErrorMessage, analysisEmptyMessage, analysisReferenceDescriptions } from './ai-analysis-presentation';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const evaluation: PersistedEvaluation = {
  id: evaluationId,
  candidateId,
  roleProfileId: null,
  targetRole: 'software_developer',
  status: 'completed',
  createdAt: '2026-10-12T00:00:00.000Z',
  result: {
    schemaVersion: '1.0.0',
    scoringVersion: '1.0.0',
    candidateId,
    targetRole: 'software_developer',
    overallScore: 80,
    categoryScores: scoringCategories.map(({ id, displayName }, index) => ({
      categoryId: id, displayName, score: 80, status: 'scored', evidenceRefs: [`evidence-${index + 1}`], explanation: 'Supported by evidence.',
    })),
    roleWeightsUsed: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 },
    evidence: scoringCategories.map(({ id }, index) => ({ evidenceId: `evidence-${index + 1}`, evidenceType: 'technical_screen', source: 'Technical screen', description: 'Completed a structured technical screen.', normalizedValue: 80, verificationStatus: 'verified', categoryId: id, availability: 'available' })),
    strengths: [], skillGaps: [], recommendations: [], missingEvidence: [],
    calculationExplanation: 'Deterministic scoring explanation.', evaluationStatus: 'completed',
    aiExplanation: { summary: 'No AI explanation.', strengths: [], skillGaps: [], recommendations: [] },
    decisionSupportNotice: 'Decision support only; not an automatic hiring decision.',
  },
};

describe('AI analysis presentation helpers', () => {
  it('turns only recognized evidence and category references into supporting descriptions', () => {
    expect(analysisReferenceDescriptions(evaluation, ['evidence-1', 'technical_skills', 'unknown-ref'])).toEqual([
      'Technical screen · Completed a structured technical screen.',
      'Technical Skills: Supported by evidence.',
    ]);
  });

  it('shows a clear unavailable state when the API has insufficient evidence', () => {
    const response = aiAnalysisResponseSchema.parse({ status: 'insufficient_evidence', evaluation, analysis: null });
    expect(analysisEmptyMessage(response)).toContain('does not have sufficient verified evidence');
  });

  it('handles empty analysis lists without inventing observations', () => {
    const response = aiAnalysisResponseSchema.parse({
      status: 'completed', evaluation,
      analysis: {
        summary: 'Evidence supports this evaluation.', summaryEvidenceReferences: ['evidence-1'],
        strengths: [], weaknesses: [], recommendations: [],
        roleRelevance: 'The evidence relates to this software engineering role.', roleRelevanceEvidenceReferences: ['technical_skills'],
      },
    });
    expect(response.status).toBe('completed');
    if (response.status === 'completed') expect(response.analysis.strengths).toEqual([]);
    expect(analysisEmptyMessage(response)).toBeUndefined();
    expect(aiAnalysisResponseSchema.safeParse({ status: 'completed', evaluation, analysis: { summary: 'missing references' } }).success).toBe(false);
  });

  it('provides configuration, auth, and general failure messages without raw provider details', () => {
    expect(aiAnalysisErrorMessage(new ApiRequestError('configuration', 503, 'AI_NOT_CONFIGURED'))).toContain('not configured');
    expect(aiAnalysisErrorMessage(new ApiRequestError('authorization', 403))).toContain('not approved');
    expect(aiAnalysisErrorMessage(new Error('raw provider secret'))).not.toContain('raw provider secret');
  });
});
