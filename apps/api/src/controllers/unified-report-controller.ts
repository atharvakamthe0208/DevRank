import {
  candidateEvaluationsResponseSchema,
  candidatePlatformDataResponseSchema,
  candidateIdParamsSchema,
  unifiedReportResumeLinkRequestSchema,
  evaluationResponseSchema,
  unifiedCandidateReportSchema,
} from '@devrank/contracts';
import type { Request } from 'express';
import { HttpError } from '../middleware/http-error.js';
import { candidateRepository, type CandidateRepository } from '../repositories/candidate-repository.js';
import { evaluationRepository, type EvaluationRepository } from '../repositories/evaluation-repository.js';
import { candidatePlatformRepository, type CandidatePlatformRepository } from '../repositories/candidate-platform-repository.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getSupabaseClient } from '../config/supabase.js';

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
  const get = asyncHandler(async (request, response) => {
    const auth = authContext(request);
    const { id: candidateId } = candidateIdParamsSchema.parse(request.params);
    const candidate = await candidates.get(auth, candidateId);
    const [evaluationResponse, platformResponse] = await Promise.all([
      evaluations.listForCandidate(auth, candidateId),
      platforms.getLatest(auth, candidateId),
    ]);
    const savedEvaluations = candidateEvaluationsResponseSchema.parse(evaluationResponse).items;
    const latest = savedEvaluations[0];
    const current = latest ? evaluationResponseSchema.safeParse(latest.result) : undefined;
    const sourceSnapshots = current?.success ? current.data.platformEvidence ?? [] : [];
    const savedPlatforms = candidatePlatformDataResponseSchema.parse(platformResponse).items;
    const categoryReport = current?.success ? current.data.finalReport : undefined;

    let roleDescription: string | null = null;
    let linkedResume: Record<string, unknown> | undefined;
    let linkableResumes: Array<Record<string, unknown>> = [];
    let resumeSchemaUnavailable = false;
    try {
      const client = getClient(auth.accessToken);
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
      const missingAssociationSchema = [linkedResult.error, availableResult.error].some((error) => error?.code === '42703' || error?.code === 'PGRST204');
      if (missingAssociationSchema) resumeSchemaUnavailable = true;
      else if (linkedResult.error || availableResult.error) throw new HttpError(503, 'UNIFIED_REPORT_RESUME_LOOKUP_FAILED', 'Could not load owned resume screening results.');
      else {
        linkedResume = linkedResult.data ?? undefined;
        linkableResumes = availableResult.data ?? [];
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      resumeSchemaUnavailable = true;
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
        roleId: latest?.targetRole ?? null,
        roleLabel: latest?.targetRole ? latest.targetRole.replaceAll('_', ' ') : null,
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
      sources: { github: sourceReport('github'), leetcode: sourceReport('leetcode') },
      resume: (() => {
        if (resumeSchemaUnavailable) return {
          status: 'unavailable', message: 'Apply the candidate-linked screening migration to associate saved resume results with this candidate.',
          jobTitle: null, jobDescription: null, evaluatedAt: null, validatedScore: null, preliminaryScore: null, statusLabel: null, evidence: [],
          limitations: ['Resume results are not joined by name or email.'],
        };
        if (!linkedResume) return {
          status: 'unlinked', message: 'No resume screening has been explicitly associated with this candidate. Choose a saved resume result below to link it.',
          jobTitle: null, jobDescription: null, evaluatedAt: null, validatedScore: null, preliminaryScore: null, statusLabel: null, evidence: [],
          limitations: ['Resume results are not joined by name or email.'],
        };
        const session = linkedResume.screening_sessions as { job_title?: string; job_description?: string } | null;
        const evaluation = linkedResume.evaluation && typeof linkedResume.evaluation === 'object' ? linkedResume.evaluation as Record<string, unknown> : {};
        const preliminary = linkedResume.preliminary_evaluation && typeof linkedResume.preliminary_evaluation === 'object' ? linkedResume.preliminary_evaluation as Record<string, unknown> : {};
        const extraction = linkedResume.extracted_data && typeof linkedResume.extracted_data === 'object' ? linkedResume.extracted_data as Record<string, unknown> : {};
        const requirements = Array.isArray(evaluation.requirements) ? evaluation.requirements as Array<Record<string, unknown>> : [];
        return {
          status: 'available', message: `${String(linkedResume.original_filename)} · ${String(extraction.candidate && typeof extraction.candidate === 'object' ? (extraction.candidate as Record<string, unknown>).name ?? 'Name not identified' : 'Name not identified')}`,
          jobTitle: session?.job_title ?? null,
          jobDescription: session?.job_description ?? null,
          evaluatedAt: typeof linkedResume.processed_at === 'string' ? linkedResume.processed_at : null,
          validatedScore: typeof evaluation.score === 'number' ? evaluation.score : null,
          preliminaryScore: typeof preliminary.score === 'number' ? preliminary.score : null,
          statusLabel: typeof evaluation.status === 'string' ? evaluation.status : typeof linkedResume.status === 'string' ? linkedResume.status : null,
          evidence: requirements.flatMap((item) => Array.isArray(item.evidence) ? item.evidence.flatMap((piece) => piece && typeof piece === 'object' && typeof (piece as Record<string, unknown>).excerpt === 'string' ? [(piece as Record<string, unknown>).excerpt as string] : []) : []),
          limitations: ['Resume job-match score uses a different rubric from the GitHub and LeetCode v4 evidence index.', 'Preliminary matches are not validated evaluation scores.', ...(typeof linkedResume.safe_error_message === 'string' ? [linkedResume.safe_error_message] : [])],
        };
      })(),
      linkableResumes: resumeSchemaUnavailable ? [] : linkableResumes.map((row) => {
        const session = row.screening_sessions as { job_title?: string } | null;
        const extracted = row.extracted_data && typeof row.extracted_data === 'object' ? row.extracted_data as Record<string, unknown> : {};
        const person = extracted.candidate && typeof extracted.candidate === 'object' ? extracted.candidate as Record<string, unknown> : {};
        const evaluation = row.evaluation && typeof row.evaluation === 'object' ? row.evaluation as Record<string, unknown> : {};
        const preliminary = row.preliminary_evaluation && typeof row.preliminary_evaluation === 'object' ? row.preliminary_evaluation as Record<string, unknown> : {};
        const score = typeof evaluation.score === 'number' ? evaluation.score : typeof preliminary.score === 'number' ? preliminary.score : null;
        return { id: row.id, filename: row.original_filename, candidateName: typeof person.name === 'string' ? person.name : null,
          jobTitle: session?.job_title ?? '', status: row.status, scoreLabel: typeof evaluation.score === 'number' ? 'Validated' : score !== null ? 'Preliminary match' : 'Unavailable', score };
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
  return { get, linkResume };
}
