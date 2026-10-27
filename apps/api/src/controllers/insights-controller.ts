import { candidateComparisonSchema, isResumeRoleCompatible, rankingQuerySchema, screeningScoreSchema, unifiedAssessmentRankingQuerySchema, unifiedAssessmentRankingResponseSchema, unifiedAssessmentSchema, rankUnifiedAssessments } from '@devrank/contracts';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { insightsRepository, type InsightsRepository } from '../repositories/insights-repository.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getSupabaseClient } from '../config/supabase.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createInsightsController(repository: InsightsRepository = insightsRepository, getClient: typeof getSupabaseClient = getSupabaseClient) {
  return {
    dashboard: asyncHandler(async (request, response) => response.json(await repository.dashboard(authContext(request)))),
    compare: asyncHandler(async (request, response) => {
      const input = candidateComparisonSchema.parse(request.body);
      response.json(await repository.compare(authContext(request), input));
    }),
    ranking: asyncHandler(async (request, response) => {
      const input = rankingQuerySchema.parse(request.query);
      response.json(await repository.ranking(authContext(request), input));
    }),
    unifiedRanking: asyncHandler(async (request, response) => {
      const auth = authContext(request);
      const { roleId } = unifiedAssessmentRankingQuerySchema.parse(request.query);
      // Rankings contain recruiter-specific saved assessment data and must be refreshed after Assess All.
      response.set('Cache-Control', 'no-store');
      const client = getClient(auth.accessToken);
      const rows: Array<{ candidateName: string; githubUsername: string | null; leetcodeUsername: string | null; assessment: ReturnType<typeof unifiedAssessmentSchema.parse> }> = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('unified_assessments')
          .select('id,candidate_id,created_at,result,candidates!inner(full_name,github_username,leetcode_username)')
          .eq('owner_id', auth.userId).eq('role_id', roleId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 499);
        if (error) {
          if (error.code === '42P01' || error.code === 'PGRST205') throw new HttpError(503, 'UNIFIED_ASSESSMENT_MIGRATION_REQUIRED', 'Apply the unified assessment migration before loading final rankings.');
          throw new HttpError(503, 'UNIFIED_RANKING_UNAVAILABLE', 'Could not load the saved final ranking right now.');
        }
        for (const row of data ?? []) {
          const assessment = unifiedAssessmentSchema.safeParse(row.result);
          const relation = row.candidates as { full_name?: string; github_username?: string | null; leetcode_username?: string | null } | { full_name?: string; github_username?: string | null; leetcode_username?: string | null }[] | null;
          const candidate = Array.isArray(relation) ? relation[0] : relation;
          const candidateName = candidate?.full_name;
          if (assessment.success && assessment.data.candidateId === row.candidate_id && assessment.data.roleId === roleId && candidateName) {
            rows.push({ candidateName, githubUsername: candidate?.github_username ?? null, leetcodeUsername: candidate?.leetcode_username ?? null, assessment: assessment.data });
          }
        }
        if (!data || data.length < 500) break;
      }
      const ranking = rankUnifiedAssessments(rows);
      const candidateIds = [...new Set(ranking.items.map((item) => item.assessment.candidateId))];
      const resumeScores = new Map<string, number>();
      if (candidateIds.length) {
        const { data: linkedResumes, error: resumeError } = await client.from('resume_screenings')
          .select('id,candidate_id,owner_id,original_filename,status,extracted_data,evaluation,preliminary_evaluation,safe_error_message,processed_at,screening_sessions!inner(job_title,job_description)')
          .eq('owner_id', auth.userId).in('candidate_id', candidateIds);
        if (resumeError) {
          if (resumeError.code === '42P01' || resumeError.code === 'PGRST205') throw new HttpError(503, 'SCREENING_SCHEMA_MISSING', 'Resume screening tables are missing. Apply the resume screening migrations before loading resume scores.');
          throw new HttpError(503, 'UNIFIED_RANKING_RESUME_LOOKUP_FAILED', 'Could not load linked resume scores for this ranking.');
        }
        for (const resume of linkedResumes ?? []) {
          const session = resume.screening_sessions as { job_title?: string } | { job_title?: string }[] | null;
          const jobTitle = Array.isArray(session) ? session[0]?.job_title : session?.job_title;
          const evaluation = screeningScoreSchema.safeParse(resume.evaluation);
          if (resume.owner_id === auth.userId && typeof resume.candidate_id === 'string' && candidateIds.includes(resume.candidate_id)
            && resume.status === 'completed' && evaluation.success
            && evaluation.data.status === 'complete' && typeof evaluation.data.score === 'number'
            && typeof jobTitle === 'string' && isResumeRoleCompatible(roleId, jobTitle)) {
            resumeScores.set(resume.candidate_id, evaluation.data.score);
          }
        }
      }
      response.json(unifiedAssessmentRankingResponseSchema.parse({
        roleId,
        ...ranking,
        items: ranking.items.map((item) => ({ ...item, resumeScore: resumeScores.get(item.assessment.candidateId) ?? null })),
        total: ranking.items.length,
      }));
    }),
  };
}

export const insightsController = createInsightsController();
