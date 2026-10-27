import { describe, expect, it } from 'vitest';
import type { ScreeningRequirement } from '@devrank/contracts';
import { parseEnv } from '../src/config/env.js';
import { createScreeningProcessor } from '../src/modules/screening/processor.js';
import { preliminaryResumePatch, scorePreliminaryMatch } from '../src/modules/screening/preliminary-scoring.js';

const jobDescription = 'The engineer will build customer services using TypeScript, React, AWS, Kubernetes, and Docker. The role needs production systems experience.';
const requirements: ScreeningRequirement[] = [{
  id: 'req-tech', categoryId: 'required_technical_skills',
  description: 'TypeScript React AWS Kubernetes Docker', importance: 'required',
}, { id: 'req-exp', categoryId: 'relevant_experience',
  description: 'Production systems reliability engineering', importance: 'required' }];

describe('preliminary resume document matching', () => {
  it('produces descending evidence-based scores for strong, moderate, and weak documented matches', () => {
    const strong = scorePreliminaryMatch(requirements, 'TypeScript React AWS Kubernetes Docker. Production systems reliability engineering. More than ten years building reliable services.', jobDescription)!;
    const moderate = scorePreliminaryMatch(requirements, 'TypeScript React. Production systems reliability.', jobDescription)!;
    const weak = scorePreliminaryMatch(requirements, 'TypeScript is listed. Other details are not stated in this resume.', jobDescription)!;
    expect(strong.score).toBeGreaterThan(moderate.score);
    expect(moderate.score).toBeGreaterThan(weak.score);
    expect([strong.score, moderate.score, weak.score].every((score) => score >= 0 && score <= 100)).toBe(true);
  });

  it('labels absent skills and experience as unverified rather than asserting lack of ability', () => {
    const result = scorePreliminaryMatch(requirements, 'TypeScript is used to build customer-facing web applications. This resume has no years-of-experience section.', jobDescription)!;
    expect(result.criteria[0].status).toBe('supported');
    expect(result.criteria[1].status).toBe('unverified');
    expect(result.criteria[1].matchPercentage).toBeUndefined();
    expect(result.evidenceCoverage).toBe(58);
  });

  it('returns unavailable when text, job description, or match evidence is insufficient', () => {
    expect(scorePreliminaryMatch(requirements, '', jobDescription)).toBeNull();
    expect(scorePreliminaryMatch(requirements, 'TypeScript React AWS Kubernetes Docker. Production systems reliability engineering.', '')).toBeNull();
    expect(scorePreliminaryMatch(requirements, 'A resume with enough words but no job-related technologies or qualifications stated.', jobDescription)).toBeNull();
  });

  it('keeps a local preliminary result available when the full AI assessment fails', async () => {
    const resumeText = 'TypeScript React are listed skills in this resume. Several other relevant details are missing.';
    const processor = createScreeningProcessor(parseEnv({ GROQ_API_KEY: 'test-only-key' }), async () => { throw new Error('provider unavailable'); });
    await expect(processor.assess(requirements, resumeText)).rejects.toMatchObject({ code: 'SCREENING_AI_UNAVAILABLE' });
    const preliminary = scorePreliminaryMatch(requirements, resumeText, jobDescription);
    expect(preliminary?.score).toBeGreaterThan(0);
  });

  it('persists the preliminary result through a partial update that cannot overwrite validated evaluation', () => {
    const preliminary = scorePreliminaryMatch(requirements, 'TypeScript React AWS Kubernetes Docker. Production systems reliability engineering. Extra details from a sufficiently long resume.', jobDescription)!;
    const patch = preliminaryResumePatch('Priya Example', preliminary, '2026-10-21T00:00:00.000Z');
    expect(patch.preliminary_evaluation).toEqual(preliminary);
    expect(patch.extracted_data).toEqual({ candidate: { name: 'Priya Example' } });
    expect(patch).not.toHaveProperty('evaluation');
  });
});
