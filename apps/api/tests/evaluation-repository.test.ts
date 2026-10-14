import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { HttpError } from '../src/middleware/http-error.js';

const roleProfileId = 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084';
const validWeights = { technical_skills: 27.78, problem_solving_dsa: 22.22, relevant_project_experience: 22.22, practical_assessment_performance: 16.67, learning_adaptability: 11.11 };

describe('evaluation role profile listing', () => {
  it('returns only a validation status for owner-scoped role profiles and preserves stored weights', async () => {
    const result = { data: [
      { id: roleProfileId, name: 'software_developer', description: 'Approved by team', weights: validWeights },
      { id: 'df7e058f-6309-4b3b-8ea8-7827f6952ec2', name: 'unapproved_role', description: null, weights: validWeights },
      { id: 'a2c72455-45cd-413d-a596-e9b66cfc0015', name: 'data_analyst', description: null, weights: { ...validWeights, communication_skills: 1 } },
    ], error: null };
    const builder: Record<string, any> = {};
    for (const method of ['select', 'eq']) builder[method] = vi.fn(() => builder);
    builder.order = vi.fn(async () => result);
    const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
    const getClient = vi.fn(() => client);
    const repository = createEvaluationRepository(getClient);

    const response = await repository.listRoleProfiles({ userId: 'user-1', accessToken: 'verified-token' });

    expect(getClient).toHaveBeenCalledWith('verified-token');
    expect(client.from).toHaveBeenCalledWith('role_profiles');
    expect(builder.eq).toHaveBeenCalledWith('owner_id', 'user-1');
    expect(response).toEqual({ items: [
      { id: roleProfileId, name: 'software_developer', description: 'Approved by team', usable: true, targetRole: 'software_developer', weights: validWeights },
      { id: 'df7e058f-6309-4b3b-8ea8-7827f6952ec2', name: 'unapproved_role', description: null, usable: false, weights: validWeights },
      { id: 'a2c72455-45cd-413d-a596-e9b66cfc0015', name: 'data_analyst', description: null, usable: false, targetRole: 'data_analyst' },
    ] });
  });

  it('lists recent evaluation snapshots only after verifying candidate ownership', async () => {
    const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
    const saved = {
      id: '8c649201-886d-4c46-b99f-8aa2afc0cd6c', candidateId,
      roleProfileId, status: 'insufficient_evidence', createdAt: '2026-10-14T01:00:00.000Z',
      result: { schemaVersion: '2.0.0', scoringVersion: '2.0.0', candidateId, targetRole: 'software_developer',
        categoryScores: [
          { categoryId: 'technical_skills', displayName: 'Technical Skills', status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' },
          { categoryId: 'problem_solving_dsa', displayName: 'Problem-Solving / DSA', status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' },
          { categoryId: 'relevant_project_experience', displayName: 'Relevant Project Experience', status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' },
          { categoryId: 'practical_assessment_performance', displayName: 'Practical Assessment Performance', status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' },
          { categoryId: 'learning_adaptability', displayName: 'Learning & Adaptability', status: 'insufficient_evidence', evidenceRefs: [], explanation: 'No evidence.' },
        ], roleWeightsUsed: validWeights, evidence: [], strengths: [], skillGaps: [], recommendations: [],
        missingEvidence: ['technical_skills', 'problem_solving_dsa', 'relevant_project_experience', 'practical_assessment_performance', 'learning_adaptability'],
        calculationExplanation: 'No overall score.', evaluationStatus: 'insufficient_evidence',
        aiExplanation: { summary: 'No analysis.', strengths: [], skillGaps: [], recommendations: [] },
        decisionSupportNotice: 'Decision support only; not an automatic hiring decision.' },
    };
    const candidateQuery: Record<string, any> = {};
    for (const method of ['select', 'eq', 'is']) candidateQuery[method] = vi.fn(() => candidateQuery);
    candidateQuery.maybeSingle = vi.fn(async () => ({ data: { id: candidateId }, error: null }));
    const evaluationsQuery: Record<string, any> = {};
    for (const method of ['select', 'eq', 'order']) evaluationsQuery[method] = vi.fn(() => evaluationsQuery);
    evaluationsQuery.limit = vi.fn(async () => ({ data: [{ id: saved.id, candidate_id: candidateId, role_profile_id: roleProfileId, status: saved.status, created_at: saved.createdAt, evaluation_result: saved.result }], error: null }));
    const client = { from: vi.fn((table: string) => table === 'candidates' ? candidateQuery : evaluationsQuery) } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);
    const auth = { userId: 'user-1', accessToken: 'verified-token', email: 'recruiter@example.com', emailConfirmed: true, profile: { id: 'user-1', display_name: 'Recruiter', role: 'recruiter' as const, approval_status: 'approved' as const } };

    await expect(repository.listForCandidate(auth, candidateId)).resolves.toEqual({ items: [saved] });
    expect(candidateQuery.eq).toHaveBeenCalledWith('owner_id', auth.userId);
    expect(evaluationsQuery.eq).toHaveBeenCalledWith('owner_id', auth.userId);
    expect(evaluationsQuery.limit).toHaveBeenCalledWith(20);

    candidateQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(repository.listForCandidate(auth, candidateId)).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
