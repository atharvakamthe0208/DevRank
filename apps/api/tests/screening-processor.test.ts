import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { HttpError } from '../src/middleware/http-error.js';
import { createScreeningProcessor } from '../src/modules/screening/processor.js';

const config = parseEnv({ GROQ_API_KEY: 'test-only-key', AI_TIMEOUT_MS: '1000' });

describe('resume screening processor', () => {
  it('extracts bounded job requirements and scores only resume evidence it can verify', async () => {
    const processor = createScreeningProcessor(config, async (input) => input.startsWith('REQUIREMENTS\n')
      ? { requirements: [{ categoryId: 'required_technical_skills', description: 'Use TypeScript', importance: 'required' }] }
      : { candidateName: 'Priya Example', results: [{ requirementId: 'req-1', status: 'demonstrated', evidence: [{ excerpt: 'Built services with TypeScript' }], explanation: 'The resume names TypeScript.', confidence: 0.9 }] });
    const requirements = await processor.requirements('Engineer', 'Build backend services using TypeScript and maintain production systems.');
    const result = await processor.assess(requirements, 'Name: Priya Example\nBuilt services with TypeScript');
    expect(requirements[0].id).toBe('req-1');
    expect(result.candidate.name).toBe('Priya Example');
    expect(result.evaluation.status).toBe('complete');
    expect(result.evaluation.score).toBe(100);
  });

  it('rejects unsupported excerpts and does not fabricate a candidate name', async () => {
    const processor = createScreeningProcessor(config, async (input) => input.startsWith('REQUIREMENTS\n')
      ? { requirements: [{ categoryId: 'required_technical_skills', description: 'Use TypeScript', importance: 'required' }] }
      : { candidateName: 'Invented Person', results: [{ requirementId: 'req-1', status: 'demonstrated', evidence: [{ excerpt: 'I am an expert at TypeScript' }], explanation: 'Claimed skill.', confidence: 0.9 }] });
    const requirements = await processor.requirements('Engineer', 'Build backend services using TypeScript and maintain production systems.');
    const result = await processor.assess(requirements, 'Some unrelated resume content with no matching claim');
    expect(result.candidate.name).toBeNull();
    expect(result.evaluation.status).toBe('insufficient_evidence');
    expect(result.evaluation.score).toBeUndefined();
  });

  it('returns an actionable configuration error without calling the provider', async () => {
    let called = false;
    const processor = createScreeningProcessor(parseEnv({}), async () => { called = true; return {}; });
    await expect(processor.requirements('Engineer', 'A valid job description of sufficient length for screening.'))
      .rejects.toMatchObject({ code: 'SCREENING_AI_NOT_CONFIGURED', statusCode: 503 });
    expect(called).toBe(false);
  });

  it('rejects malformed structured output and maps provider timeout failures', async () => {
    const malformed = createScreeningProcessor(config, async () => ({ requirements: [] }));
    await expect(malformed.requirements('Engineer', 'A valid job description of sufficient length for screening.'))
      .rejects.toMatchObject({ code: 'SCREENING_AI_INVALID_RESPONSE', statusCode: 502 });
    const timeout = createScreeningProcessor(config, async () => { throw new Error('timeout'); });
    await expect(timeout.requirements('Engineer', 'A valid job description of sufficient length for screening.'))
      .rejects.toMatchObject({ code: 'SCREENING_AI_UNAVAILABLE', statusCode: 503 });
  });

  it('classifies provider rate limits as retryable without returning a score', async () => {
    const rateLimited = createScreeningProcessor(config, async () => { throw Object.assign(new Error('rate limited'), { status: 429 }); });
    await expect(rateLimited.requirements('Engineer', 'A valid job description of sufficient length for screening.'))
      .rejects.toMatchObject({ code: 'SCREENING_AI_RATE_LIMITED', statusCode: 503 });
  });

  it('keeps a valid assessment completed when the resume contains no verifiable name', async () => {
    const processor = createScreeningProcessor(config, async (input) => input.startsWith('REQUIREMENTS\n')
      ? { requirements: [{ categoryId: 'required_technical_skills', description: 'Use TypeScript', importance: 'required' }] }
      : { candidateName: null, results: [{ requirementId: 'req-1', status: 'demonstrated', evidence: [{ excerpt: 'Built services with TypeScript' }], explanation: 'The resume names TypeScript.', confidence: 0.9 }] });
    const requirements = await processor.requirements('Engineer', 'Build backend services using TypeScript and maintain production systems.');
    const result = await processor.assess(requirements, 'Built services with TypeScript\nExperience');
    expect(result.candidate.name).toBeNull();
    expect(result.evaluation.status).toBe('complete');
  });

  it('rejects malformed PDF contents instead of treating extraction errors as empty success', async () => {
    const { extractResumeText } = await import('../src/modules/screening/processor.js');
    await expect(extractResumeText({ mimetype: 'application/pdf' } as Express.Multer.File, Buffer.from('not a PDF')))
      .rejects.toMatchObject({ code: 'INVALID_PDF', statusCode: 422 } satisfies Partial<HttpError>);
  });
});

