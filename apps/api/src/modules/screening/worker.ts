import type { SupabaseClient } from '@supabase/supabase-js';
import { screeningRequirementsSchema } from '@devrank/contracts';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/http-error.js';
import { createScreeningProcessor, extractResumeText, type ScreeningProcessor } from './processor.js';
import { extractCandidateName } from './candidate-name.js';
import { preliminaryResumePatch, scorePreliminaryMatch } from './preliminary-scoring.js';

type ScreeningJob = { id: string; resume_id: string; owner_id: string; attempt: number };
type WorkerClient = SupabaseClient;
const transientCodes = new Set(['SCREENING_AI_RATE_LIMITED', 'SCREENING_AI_UNAVAILABLE']);

export async function processClaimedScreeningJobs<T>(
  jobs: T[],
  processOne: (job: T) => Promise<void>,
  concurrency = 2,
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), jobs.length) }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try { await processOne(job); }
      catch (cause) {
        console.error('Resume screening job failed outside candidate processing', {
          message: cause instanceof Error ? cause.message.slice(0, 160) : 'Unknown worker error',
        });
      }
    }
  }));
}

export async function drainScreeningQueue<T>(
  claim: (limit: number) => Promise<T[]>,
  processOne: (job: T) => Promise<void>,
  concurrency = 2,
): Promise<void> {
  while (true) {
    const jobs = await claim(concurrency);
    if (!jobs.length) return;
    await processClaimedScreeningJobs(jobs, processOne, concurrency);
  }
}

async function refreshSession(client: WorkerClient, sessionId: string, ownerId: string) {
  const { data, error } = await client.from('resume_screenings').select('status').eq('session_id', sessionId).eq('owner_id', ownerId);
  if (error || !data?.length) return;
  const active = data.some((row) => row.status === 'queued' || row.status === 'uploaded' || row.status === 'processing');
  const completed = data.filter((row) => row.status === 'completed').length;
  const failed = data.filter((row) => row.status === 'failed').length;
  const status = active ? 'processing' : failed === 0 ? 'completed' : completed > 0 ? 'partial' : 'failed';
  const updated = await client.from('screening_sessions').update({ status, updated_at: new Date().toISOString() }).eq('id', sessionId).eq('owner_id', ownerId);
  if (updated.error) console.error('Resume screening session status update failed', { code: updated.error.code ?? 'database_error' });
}

async function processJob(client: WorkerClient, processor: ScreeningProcessor, job: ScreeningJob) {
  const { data: resume, error: resumeError } = await client.from('resume_screenings')
    .select('id,session_id,owner_id,storage_path,mime_type,status')
    .eq('id', job.resume_id).eq('owner_id', job.owner_id).single();
  if (resumeError || !resume) throw resumeError ?? new Error('Screening job has no matching resume.');
  if (resume.status === 'completed') {
    const completed = await client.from('screening_jobs').update({ status: 'completed', lease_until: null, updated_at: new Date().toISOString() }).eq('id', job.id);
    if (completed.error) throw completed.error;
    await refreshSession(client, resume.session_id, job.owner_id);
    return;
  }
  const { data: session, error: sessionError } = await client.from('screening_sessions')
    .select('job_description,normalized_requirements').eq('id', resume.session_id).eq('owner_id', job.owner_id).single();
  if (sessionError || !session) throw sessionError ?? new Error('Screening job has no matching session.');

  const started = await client.from('resume_screenings').update({ status: 'processing', safe_error_code: null, safe_error_message: null, updated_at: new Date().toISOString() }).eq('id', job.resume_id);
  if (started.error) throw started.error;
  try {
    const { data: stored, error: storageError } = await client.storage.from('private-resumes').download(resume.storage_path);
    if (storageError || !stored) throw new Error('Private resume could not be retrieved for processing.');
    const buffer = Buffer.from(await stored.arrayBuffer());
    const file = { mimetype: resume.mime_type } as Express.Multer.File;
    const text = await extractResumeText(file, buffer);
    const requirements = screeningRequirementsSchema.parse(session.normalized_requirements);
    const preliminaryEvaluation = scorePreliminaryMatch(requirements, text, session.job_description);
    const preliminarySaved = await client.from('resume_screenings').update(
      preliminaryResumePatch(extractCandidateName(text), preliminaryEvaluation, new Date().toISOString()),
    ).eq('id', job.resume_id).eq('owner_id', job.owner_id);
    if (preliminarySaved.error) throw preliminarySaved.error;
    const assessment = await processor.assess(requirements, text);
    const saved = await client.from('resume_screenings').update({
      status: 'completed', extracted_data: { candidate: assessment.candidate }, evaluation: assessment.evaluation,
      safe_error_code: null, safe_error_message: null, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.resume_id).eq('owner_id', job.owner_id);
    if (saved.error) throw saved.error;
    await client.from('screening_jobs').update({ status: 'completed', lease_until: null, updated_at: new Date().toISOString() }).eq('id', job.id);
  } catch (cause) {
    const code = cause instanceof HttpError ? cause.code : 'RESUME_PROCESSING_FAILED';
    const message = cause instanceof HttpError ? cause.message : 'This resume could not be extracted or evaluated.';
    console.warn('Resume screening worker failed one item', { code });
    const failedResume = await client.from('resume_screenings').update({
      status: 'failed', safe_error_code: code, safe_error_message: message, processed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', job.resume_id).eq('owner_id', job.owner_id);
    if (failedResume.error) throw failedResume.error;
    const failedJob = await client.from('screening_jobs').update({ status: 'failed', lease_until: null, last_error_code: code, updated_at: new Date().toISOString() }).eq('id', job.id);
    if (failedJob.error) throw failedJob.error;
    if (transientCodes.has(code)) {
      const retried = await client.rpc('retry_screening_job', { p_resume_id: job.resume_id });
      if (retried.error) console.error('Resume screening retry enqueue failed', { code: retried.error.code ?? 'database_error' });
    }
  } finally {
    await refreshSession(client, resume.session_id, job.owner_id);
  }
}

/** Starts a bounded, durable worker using the service-role client only on the API server. */
export function startScreeningWorker(client: WorkerClient, processor: ScreeningProcessor = createScreeningProcessor()) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const poll = async (): Promise<void> => {
    if (stopped) return;
    let nextDelay = 1000;
    try {
      await drainScreeningQueue(async (limit) => {
        const { data, error } = await client.rpc('claim_screening_jobs', { p_limit: limit, p_lease_seconds: 300 });
        if (error) throw error;
        return (data ?? []) as ScreeningJob[];
      }, (job) => processJob(client, processor, job), 2);
      failures = 0;
    } catch (cause) {
      if (failures === 0) console.error('Resume screening worker is temporarily unavailable', {
        code: cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'worker_error',
      });
      failures += 1;
      nextDelay = Math.min(30000, 1000 * (2 ** Math.min(failures, 5)));
    } finally {
      if (!stopped) {
        timer = setTimeout(() => { void poll(); }, nextDelay);
        timer.unref();
      }
    }
  };
  void poll();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

