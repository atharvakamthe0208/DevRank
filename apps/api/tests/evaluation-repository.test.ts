import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEvaluationRepository } from '../src/repositories/evaluation-repository.js';
import { HttpError } from '../src/middleware/http-error.js';

const userId = '1d4b1d45-e136-4f50-a46e-8ef29735ec26';
const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const roleProfileId = 'e2c9bf0c-23d8-4d90-8cb5-8c33f0ef9084';
const auth = { userId, email: 'r@example.com', emailConfirmed: true, accessToken: 'test', profile: { id: userId, display_name: 'R', role: 'recruiter' as const, approval_status: 'approved' as const } };

describe('evaluation persistence repository', () => {
  it('persists configured-role results and reads the stored snapshot back', async () => {
    const insert = vi.fn();
    let record: Record<string, unknown> | undefined;
    let legacy = false;
    let insertError: { code: string; message: string; details: string } | null = null;
    const client = {
      from: (table: string) => {
        let values: Record<string, unknown> | undefined;
        const query: Record<string, any> = {};
        query.select = vi.fn(() => query);
        query.eq = vi.fn(() => query);
        query.is = vi.fn(() => query);
        query.order = vi.fn(async () => ({ data: [], error: null }));
        query.maybeSingle = vi.fn(async () => table === 'candidates'
          ? { data: { id: candidateId, full_name: 'Taylor Example' }, error: null }
          : table === 'role_profiles'
            ? { data: { id: roleProfileId, name: 'software_developer', weights: { technical_skills: 25, problem_solving_dsa: 20, relevant_project_experience: 20, practical_assessment_performance: 15, communication_skills: 10, learning_adaptability: 10 } }, error: null }
          : { data: legacy ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: null, status: 'pending', created_at: '2026-10-12T00:00:00.000Z', evaluation_result: null } : record ? { id: evaluationId, candidate_id: candidateId, role_profile_id: null, target_role: record.target_role, status: record.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: record.evaluation_result } : null, error: null });
        query.insert = vi.fn((value: Record<string, unknown>) => { values = value; insert(value); return query; });
        query.single = vi.fn(async () => {
          record = values;
          return { data: insertError ? null : { id: evaluationId, candidate_id: candidateId, role_profile_id: values?.role_profile_id ?? null, target_role: values?.target_role, status: values?.status, created_at: '2026-10-13T00:00:00.000Z', evaluation_result: values?.evaluation_result }, error: insertError };
        });
        return query;
      },
    } as unknown as SupabaseClient;
    const repository = createEvaluationRepository(() => client);

    const created = await repository.run(auth, { candidateId, roleId: 'software_developer' });
    expect(created.status).toBe('insufficient_evidence');
    expect(created.evaluation).not.toHaveProperty('overallScore');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: userId,
      candidate_id: candidateId,
      role_profile_id: null,
      target_role: 'software_developer',
      status: 'insufficient_evidence',
      scoring_version: '1.0.0',
      evidence_snapshot: [],
      role_weights_snapshot: created.role.weights,
      evaluation_result: created.evaluation,
    }));

    insert.mockClear();
    const ownerDefined = await repository.create(auth, candidateId, { roleProfileId });
    expect(ownerDefined).toMatchObject({ roleProfileId, targetRole: 'software_developer', status: 'insufficient_evidence' });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: userId, candidate_id: candidateId, role_profile_id: roleProfileId, target_role: 'software_developer',
    }));

    const retrieved = await repository.get(auth, evaluationId);
    expect(retrieved).toMatchObject({ id: evaluationId, candidateId, roleProfileId: null, targetRole: 'software_developer', result: created.evaluation });
    legacy = true;
    await expect(repository.get(auth, evaluationId)).rejects.toMatchObject({ statusCode: 409, code: 'EVALUATION_RESULT_UNAVAILABLE' });

    insertError = { code: 'PGRST204', message: "Could not find the 'target_role' column of 'evaluations' in the schema cache", details: 'private provider detail' };
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(repository.run(auth, { candidateId, roleId: 'software_developer' }))
      .rejects.toMatchObject({ statusCode: 503, code: 'DATABASE_UNAVAILABLE', message: 'Unable to process the evaluation right now' });
    expect(diagnostic).toHaveBeenCalledWith('Evaluation database operation failed', expect.objectContaining({
      operation: 'evaluation_insert', failureSource: 'supabase_response', category: 'schema', code: 'PGRST204', field: 'target_role',
    }));
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('private provider detail');
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('Could not find');
    diagnostic.mockRestore();
  });
});
