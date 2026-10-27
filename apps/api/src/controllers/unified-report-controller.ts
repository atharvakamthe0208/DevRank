import {
  candidateEvaluationsResponseSchema,
  candidatePlatformDataResponseSchema,
  candidateIdParamsSchema,
  unifiedReportResumeLinkRequestSchema,
  evaluationResponseSchema,
  unifiedCandidateReportSchema,
  unifiedAssessmentCreateRequestSchema,
  unifiedAssessmentSchema,
  calculateUnifiedAssessment,
  unifiedAssessmentInputVersion,
  unifiedAssessmentRankingQuerySchema,
  unifiedReportQuerySchema,
  preliminaryEvaluationSchema,
  screeningScoreSchema,
  isResumeRoleCompatible,
} from '@devrank/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { candidateRepository, type CandidateRepository } from '../repositories/candidate-repository.js';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { candidatePlatformRepository, type CandidatePlatformRepository } from '../repositories/candidate-platform-repository.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getSupabaseClient, SupabaseConfigurationError } from '../config/supabase.js';

function authContext(request: Request) {
  if (!request.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication is required');
  return request.auth;
}

export function createUnifiedReportController(
  candidates: CandidateRepository = candidateRepository,
  evaluations: EvaluationRepository = evaluationRepository,
  platforms: CandidatePlatformRepository = candidatePlatformRepository,
  getClient: typeof getSupabaseClient = getSupabaseClient,
) {
  function databaseUnavailable(error: { code?: string } | null, operation: string): never {
    if (['42P01', 'PGRST205', '42703', 'PGRST204', '42883'].includes(error?.code ?? '')) {
      throw new HttpError(503, 'UNIFIED_ASSESSMENT_MIGRATION_REQUIRED', 'Apply the unified assessment migration before generating or loading final assessments.');
    }
    throw new HttpError(503, 'UNIFIED_ASSESSMENT_STORAGE_FAILED', `Could not ${operation} right now.`);
  }
  const get = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const reportQuery = unifiedReportQuerySchema.parse(request.query);
    const candidate = await candidates.get(auth, candidateId);
    const [evaluationResponse, platformResponse] = await Promise.all([
      evaluations.listForCandidate(auth, candidateId),
      platforms.getLatest(auth, candidateId),
    ]);
    const savedEvaluations = candidateEvaluationsResponseSchema.parse(evaluationResponse).items;
    const latest = reportQuery.roleId ? savedEvaluations.find((item) => item.targetRole === reportQuery.roleId) : savedEvaluations[0];
    const current = latest ? evaluationResponseSchema.safeParse(latest.result) : undefined;
    const sourceSnapshots = current?.success ? current.data.platformEvidence ?? [] : [];
    const savedPlatforms = candidatePlatformDataResponseSchema.parse(platformResponse).items;
    const categoryReport = current?.success ? current.data.finalReport : undefined;

    let roleDescription: string | null = null;
    let savedAssessment = null;
    let linkedResume: Record<string, unknown> | undefined;
    let linkableResumes: Array<Record<string, unknown>> = [];
    let resumeSchemaUnavailable = false;
    try {
      const client = getClient(auth.accessToken);
      const latestAssessment = await client.from('unified_assessments').select('result')
        .eq('owner_id', auth.userId).eq('candidate_id', candidateId).eq('role_id', reportQuery.roleId ?? latest?.targetRole ?? 'software_developer')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
      if (latestAssessment.error) databaseUnavailable(latestAssessment.error, 'load the saved assessment');
      if (latestAssessment.data?.result) savedAssessment = unifiedAssessmentSchema.parse(latestAssessment.data.result);
      if (latest?.roleProfileId) {
        const role = await client.from('role_profiles').select('description').eq('id', latest.roleProfileId).eq('owner_id', auth.userId).maybeSingle();
        if (!role.error && typeof role.data?.description === 'string') roleDescription = role.data.description;
      }
      const [linkedResult, availableResult] = await Promise.all([
        client.from('resume_screenings').select('id,original_filename,status,extracted_data,evaluation,preliminary_evaluation,safe_error_message,processed_at,screening_sessions!inner(job_title,job_description)')
          .eq('owner_id', auth.userId).eq('candidate_id', candidateId).maybeSingle(),
        client.from('resume_screenings').select('id,original_filename,status,extracted_data,evaluation,preliminary_evaluation,screening_sessions!inner(job_title)')
          .eq('owner_id', auth.userId).is('candidate_id', null).order('created_at', { ascending: false }).limit(50),
      ]);
      const lookupErrors = [linkedResult.error, availableResult.error].filter((error) => error !== null);
      const missingAssociationSchema = lookupErrors.some((error) =>
        ['42703', 'PGRST204'].includes(error.code ?? '') && /candidate_id/i.test(`${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`));
      if (missingAssociationSchema) resumeSchemaUnavailable = true;
      else if (lookupErrors.length) {
        if (lookupErrors.some((error) => ['42P01', 'PGRST205'].includes(error.code ?? ''))) {
          throw new HttpError(503, 'SCREENING_SCHEMA_MISSING', 'Resume screening tables are missing. Apply the resume screening migrations before loading resume results.');
        }
        throw new HttpError(503, 'UNIFIED_REPORT_RESUME_LOOKUP_FAILED', 'Could not load owned resume screening results.');
      }
      else {
        linkedResume = linkedResult.data ?? undefined;
        linkableResumes = availableResult.data ?? [];
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof SupabaseConfigurationError) throw new HttpError(503, 'SUPABASE_CONFIGURATION_MISSING', error.message);
      throw new HttpError(503, 'UNIFIED_REPORT_RESUME_LOOKUP_FAILED', 'Could not load owned resume screening results. Check API connectivity and database availability.');
    }

    function sourceReport(source: 'github' | 'leetcode') {
      const snapshotItems = sourceSnapshots.filter((item) => item.source === source);
      const latestPlatform = savedPlatforms.find((item) => source === 'github'
        ? 'source' in item && item.source === 'github'
        : 'platform' in item && item.platform === 'leetcode');
      const findings = categoryReport?.categories.filter((item) => item.source === source) ?? [];
      if (snapshotItems.length > 0) {
        const newest = snapshotItems.reduce((a, b) => a.observedAt > b.observedAt ? a : b);
        return {
          status: snapshotItems.some((item) => item.availability === 'available') ? 'available' as const
            : snapshotItems.some((item) => item.availability === 'partial') ? 'partial' as const : 'unavailable' as const,
          provenance: newest.provenance,
          capturedAt: newest.observedAt,
          values: Object.assign({}, ...snapshotItems.map((item) => item.normalizedValue)),
          findings,
          limitations: [...new Set(snapshotItems.flatMap((item) => item.limitations))],
        };
      }
      if (latestPlatform && 'source' in latestPlatform) return {
        status: 'available' as const, provenance: latestPlatform.provenance, capturedAt: latestPlatform.syncedAt,
        values: { profile: latestPlatform.profile }, findings,
        limitations: ['Public provider data is unverified and does not prove candidate identity or engineering competence.'],
      };
      if (latestPlatform && 'platform' in latestPlatform) return {
        status: latestPlatform.availability === 'available' ? 'available' as const
          : latestPlatform.availability === 'unavailable' ? 'unavailable' as const : 'not_evaluated' as const,
        provenance: latestPlatform.provenance,
        capturedAt: 'syncedAt' in latestPlatform ? latestPlatform.syncedAt : latestPlatform.submittedAt,
        values: { handle: latestPlatform.handle, profileUrl: latestPlatform.profileUrl, statistics: latestPlatform.statistics }, findings,
        limitations: [latestPlatform.provenance === 'alfa_leetcode_api' ? 'LeetCode statistics came from an unofficial third-party service and do not verify identity or problem-solving process.' : 'Recruiter-entered statistics are unverified.'],
      };
      return { status: 'not_evaluated' as const, provenance: null, capturedAt: null, values: {}, findings, limitations: [] };
    }

    response.json(unifiedCandidateReportSchema.parse({
      generatedAt: new Date().toISOString(),
      candidate,
      job: {
        roleId: reportQuery.roleId ?? latest?.targetRole ?? null,
        roleLabel: (reportQuery.roleId ?? latest?.targetRole) ? (reportQuery.roleId ?? latest?.targetRole)!.replaceAll('_', ' ') : null,
        // Built-in role runs do not persist a description; owner-defined profiles do.
        description: roleDescription,
      },
      platformEvaluation: {
        status: !latest ? 'not_evaluated' : current?.success
          ? current.data.evaluationStatus === 'completed' ? 'completed' : 'insufficient_evidence' : 'historical',
        evaluatedAt: latest?.createdAt ?? null,
        overallIndex: current?.success ? current.data.finalReport?.overallScore ?? null : null,
        rubricNotice: current?.success ? current.data.finalReport?.notice ?? current.data.calculationExplanation : latest ? 'This saved result uses a historical scoring snapshot.' : null,
        strengths: current?.success ? current.data.strengths : [],
        improvementAreas: current?.success ? current.data.skillGaps : [],
      },
      assessment: savedAssessment,
      sources: { github: sourceReport('github'), leetcode: sourceReport('leetcode') },
      resume: (() => {
        if (resumeSchemaUnavailable) return {
          id: null, status: 'unavailable', message: 'Apply the candidate-linked screening migration to associate saved resume results with this candidate.',
          jobTitle: null, jobDescription: null, evaluatedAt: null, validatedScore: null, preliminaryScore: null, statusLabel: null, evidence: [],
          limitations: ['Resume results are not joined by name or email.'],
        };
        if (!linkedResume) return {
          id: null, status: 'unlinked', message: 'No resume screening has been explicitly associated with this candidate. Choose a saved resume result below to link it.',
          jobTitle: null, jobDescription: null, evaluatedAt: null, validatedScore: null, preliminaryScore: null, statusLabel: null, evidence: [],
          limitations: ['Resume results are not joined by name or email.'],
        };
        const session = linkedResume.screening_sessions as { job_title?: string; job_description?: string } | null;
        const evaluation = screeningScoreSchema.safeParse(linkedResume.evaluation);
        const preliminary = preliminaryEvaluationSchema.safeParse(linkedResume.preliminary_evaluation);
        const extraction = linkedResume.extracted_data && typeof linkedResume.extracted_data === 'object' ? linkedResume.extracted_data as Record<string, unknown> : {};
        const validEvaluation = evaluation.success ? evaluation.data : null;
        const validPreliminary = preliminary.success ? preliminary.data : null;
        const validatedScore = linkedResume.status === 'completed' && validEvaluation?.status === 'complete' ? validEvaluation.score ?? null : null;
        const preliminaryScore = validPreliminary?.score ?? (linkedResume.status === 'completed' && validEvaluation?.status === 'provisional' ? validEvaluation.score ?? null : null);
        const requirements = validEvaluation?.requirements ?? [];
        return {
          id: String(linkedResume.id), status: 'available', message: `${String(linkedResume.original_filename)} · ${String(extraction.candidate && typeof extraction.candidate === 'object' ? (extraction.candidate as Record<string, unknown>).name ?? 'Name not identified' : 'Name not identified')}`,
          jobTitle: session?.job_title ?? null,
          jobDescription: session?.job_description ?? null,
          evaluatedAt: typeof linkedResume.processed_at === 'string' ? linkedResume.processed_at : null,
          validatedScore,
          preliminaryScore,
          statusLabel: validEvaluation?.status ?? (typeof linkedResume.status === 'string' ? linkedResume.status : null),
          evidence: requirements.flatMap((item) => Array.isArray(item.evidence) ? item.evidence.flatMap((piece) => piece && typeof piece === 'object' && typeof (piece as Record<string, unknown>).excerpt === 'string' ? [(piece as Record<string, unknown>).excerpt as string] : []) : []),
          limitations: ['Resume job-match score uses a different rubric from the GitHub and LeetCode v4 evidence index.', 'Preliminary matches are not validated evaluation scores.', ...(linkedResume.evaluation && !evaluation.success ? ['The stored resume evaluation did not match the current validated schema and was excluded from scoring.'] : []), ...(typeof linkedResume.safe_error_message === 'string' ? [linkedResume.safe_error_message] : [])],
        };
      })(),
      linkableResumes: resumeSchemaUnavailable ? [] : linkableResumes.map((row) => {
        const session = row.screening_sessions as { job_title?: string } | null;
        const extracted = row.extracted_data && typeof row.extracted_data === 'object' ? row.extracted_data as Record<string, unknown> : {};
        const person = extracted.candidate && typeof extracted.candidate === 'object' ? extracted.candidate as Record<string, unknown> : {};
        const evaluation = screeningScoreSchema.safeParse(row.evaluation);
        const preliminary = preliminaryEvaluationSchema.safeParse(row.preliminary_evaluation);
        const validated = row.status === 'completed' && evaluation.success && evaluation.data.status === 'complete' ? evaluation.data.score ?? null : null;
        const provisional = preliminary.success ? preliminary.data.score
          : row.status === 'completed' && evaluation.success && evaluation.data.status === 'provisional' ? evaluation.data.score ?? null : null;
        const score = validated ?? provisional;
        return { id: row.id, filename: row.original_filename, candidateName: typeof person.name === 'string' ? person.name : null,
          jobTitle: session?.job_title ?? '', status: row.status, scoreLabel: validated !== null ? 'Validated' : score !== null ? 'Preliminary match' : 'Unavailable', score };
      }),
    }));
  });

  const linkResume = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const { resumeId } = unifiedReportResumeLinkRequestSchema.parse(request.body);
    await candidates.get(auth, candidateId);
    const client = getClient(auth.accessToken);
    const updated = await client.from('resume_screenings').update({ candidate_id: candidateId })
      .eq('id', resumeId).eq('owner_id', auth.userId).in('status', ['completed', 'failed']).is('candidate_id', null)
      .select('id').maybeSingle();
    if (updated.error) {
      if (updated.error.code === '23505') throw new HttpError(409, 'RESUME_ALREADY_LINKED', 'This candidate already has a linked resume result.');
      if (updated.error.code === '42703' || updated.error.code === 'PGRST204') throw new HttpError(503, 'RESUME_LINK_MIGRATION_REQUIRED', 'Apply the candidate-linked screening migration before linking resume results.');
      throw new HttpError(503, 'RESUME_LINK_FAILED', 'Could not link this resume result. Confirm it belongs to your account and has reached a terminal status.');
    }
    if (!updated.data) throw new HttpError(409, 'RESUME_NOT_LINKABLE', 'This resume result is unavailable, has not finished processing, or has already been linked.');
    response.status(200).json({ status: 'linked', candidateId, resumeId });
  });
  const replaceResume = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const { resumeId } = unifiedReportResumeLinkRequestSchema.parse(request.body);
    await candidates.get(auth, candidateId);
    const result = await getClient(auth.accessToken).rpc('replace_candidate_resume_result', {
      p_candidate_id: candidateId,
      p_resume_id: resumeId,
    });
    if (result.error) {
      const code = typeof result.error.code === 'string' && /^[A-Z0-9]{4,12}$/i.test(result.error.code) ? result.error.code : 'database_error';
      console.error('Candidate resume replacement database operation failed', { operation: 'replace_candidate_resume_result', code });
      if (code === 'PGRST202' || code === '42883') {
        throw new HttpError(503, 'RESUME_REPLACEMENT_MIGRATION_REQUIRED', 'The resume replacement database function is not installed. Apply the latest DevRank resume replacement migration, then retry. The current linked result was not changed.');
      }
      if (code === '42501' || code === 'PGRST301') {
        throw new HttpError(403, 'RESUME_REPLACEMENT_PERMISSION_DENIED', 'The database denied permission to replace this resume result. Verify recruiter access and resume replacement database permissions.');
      }
      if (['23503', '23505', '40001'].includes(code)) {
        throw new HttpError(409, 'RESUME_REPLACEMENT_CONFLICT', 'The linked resume changed while replacement was in progress. Reload the report and try again. The transaction preserved the existing result.');
      }
      throw new HttpError(503, 'RESUME_REPLACEMENT_FAILED', 'The database could not complete the resume replacement. The transaction preserved the current linked result; check the API database diagnostic and retry.');
    }
    if (result.data !== true) throw new HttpError(409, 'RESUME_REPLACEMENT_NOT_ALLOWED', 'Replacement requires an existing linked result and a different, completed, unlinked resume result owned by your workspace. No saved result was changed.');
    response.json({ status: 'replaced', candidateId, resumeId });
  });
  const assess = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const input = unifiedAssessmentCreateRequestSchema.parse(request.body);
    await candidates.get(auth, candidateId);
    const evaluationResponse = candidateEvaluationsResponseSchema.parse(await evaluations.listForCandidate(auth, candidateId));
    const matching = evaluationResponse.items.find((item) => item.targetRole === input.roleId);
    const parsedPlatform = matching ? evaluationResponseSchema.safeParse(matching.result) : undefined;
    const platformEvaluation = matching && parsedPlatform?.success ? {
      id: matching.id,
      candidateId: matching.candidateId,
      roleId: matching.targetRole,
      result: parsedPlatform.data,
    } : null;
    const client = getClient(auth.accessToken);
    let resume: Parameters<typeof calculateUnifiedAssessment>[0]['resume'] = null;
    if (input.resumeId) {
      const selected = await client.from('resume_screenings').select('id,status,evaluation,preliminary_evaluation,screening_sessions!inner(job_title)')
        .eq('id', input.resumeId).eq('owner_id', auth.userId).eq('candidate_id', candidateId).maybeSingle();
      if (selected.error) databaseUnavailable(selected.error, 'load the selected candidate resume result');
      if (!selected.data) throw new HttpError(404, 'RESUME_RESULT_NOT_FOUND', 'The selected resume result is not linked to this candidate in your workspace.');
      const row = selected.data as Record<string, unknown>;
      const session = row.screening_sessions as { job_title?: string } | null;
      const parsedEvaluation = screeningScoreSchema.safeParse(row.evaluation);
      const parsedPreliminary = preliminaryEvaluationSchema.safeParse(row.preliminary_evaluation);
      const evaluation = parsedEvaluation.success ? parsedEvaluation.data : null;
      const preliminary = parsedPreliminary.success ? parsedPreliminary.data : null;
      resume = {
        id: String(row.id), status: String(row.status), jobTitle: session?.job_title ?? '',
        evaluation: row.status === 'completed' && evaluation ? { status: evaluation.status, ...(typeof evaluation.score === 'number' ? { score: evaluation.score } : {}) } : null,
        preliminaryScore: preliminary?.score ?? (row.status === 'completed' && evaluation?.status === 'provisional' ? evaluation.score ?? null : null),
      };
    } else {
      const linked = await client.from('resume_screenings').select('id,status,evaluation,preliminary_evaluation,screening_sessions!inner(job_title)')
        .eq('owner_id', auth.userId).eq('candidate_id', candidateId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (linked.error) databaseUnavailable(linked.error, 'load the candidate resume result');
      if (linked.data) {
        const row = linked.data as Record<string, unknown>;
        const session = row.screening_sessions as { job_title?: string } | null;
        const parsedEvaluation = screeningScoreSchema.safeParse(row.evaluation);
        const parsedPreliminary = preliminaryEvaluationSchema.safeParse(row.preliminary_evaluation);
        const evaluation = parsedEvaluation.success ? parsedEvaluation.data : null;
        const preliminary = parsedPreliminary.success ? parsedPreliminary.data : null;
        resume = { id: String(row.id), status: String(row.status), jobTitle: session?.job_title ?? '',
          evaluation: row.status === 'completed' && evaluation ? { status: evaluation.status, ...(typeof evaluation.score === 'number' ? { score: evaluation.score } : {}) } : null,
          preliminaryScore: preliminary?.score ?? (row.status === 'completed' && evaluation?.status === 'provisional' ? evaluation.score ?? null : null) };
      }
    }
    const roleLabel = input.roleId.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const resumeRoleMismatch = Boolean(resume && !isResumeRoleCompatible(input.roleId, resume.jobTitle));
    const screeningResumeId = resume?.id ?? null;
    const sourceSnapshot = JSON.stringify({ inputVersion: unifiedAssessmentInputVersion, candidateId, roleId: input.roleId, platformEvaluation, resume, screeningResumeId });
    const fingerprint = createHash('sha256').update(sourceSnapshot).digest('hex');
    const assessment = calculateUnifiedAssessment({
      id: randomUUID(), candidateId, roleId: input.roleId,
      roleLabel,
      generatedAt: new Date().toISOString(), platformEvaluation, resume, resumeRoleMismatch,
    });
    const insert = await client.from('unified_assessments').insert({ owner_id: auth.userId, candidate_id: candidateId,
      role_id: input.roleId, platform_evaluation_id: platformEvaluation?.id ?? null, resume_screening_id: resume?.id ?? null,
      source_fingerprint: fingerprint, scoring_version: assessment.scoringVersion, overall_score: assessment.overallScore,
      status: assessment.status, result: assessment }).select('result').maybeSingle();
    if (insert.error?.code === '23505') {
      const existing = await client.from('unified_assessments').select('result').eq('owner_id', auth.userId)
        .eq('candidate_id', candidateId).eq('role_id', input.roleId).eq('source_fingerprint', fingerprint).maybeSingle();
      if (existing.error || !existing.data?.result) databaseUnavailable(existing.error, 'load the existing assessment');
      response.json(unifiedAssessmentSchema.parse(existing.data.result));
      return;
    }
    if (insert.error) databaseUnavailable(insert.error, 'save the candidate assessment');
    if (!insert.data?.result) throw new HttpError(503, 'UNIFIED_ASSESSMENT_STORAGE_FAILED', 'The saved assessment could not be verified.');
    response.status(201).json(unifiedAssessmentSchema.parse(insert.data.result));
  });
  const getAssessment = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const { roleId } = unifiedAssessmentRankingQuerySchema.parse(request.query);
    await candidates.get(auth, candidateId);
    const result = await getClient(auth.accessToken).from('unified_assessments').select('result')
      .eq('owner_id', auth.userId).eq('candidate_id', candidateId).eq('role_id', roleId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (result.error) databaseUnavailable(result.error, 'load the candidate assessment');
    response.json(result.data?.result ? unifiedAssessmentSchema.parse(result.data.result) : null);
  });
  return { get, linkResume, replaceResume, assess, getAssessment };
}
