import { describe, expect, it } from 'vitest';
import { extractCandidateName } from '../src/modules/screening/candidate-name.js';

describe('resume candidate name extraction', () => {
  it('accepts a name heading at the top of a resume before contact details', () => {
    const resumeText = 'Priya Sharma\nBengaluru, India | priya@example.test | +91 1234567890\nSenior Software Engineer\nExperience';
    expect(extractCandidateName(resumeText)).toBe('Priya Sharma');
  });

  it('accepts an explicit name label and validates an AI proposal against resume text', () => {
    const resumeText = 'RESUME\nName: Mary Ann van Buren\nEmail: mary@example.test';
    expect(extractCandidateName(resumeText, 'Mary Ann van Buren')).toBe('Mary Ann van Buren');
    expect(extractCandidateName(resumeText, 'Mary Ann Other')).toBe('Mary Ann van Buren');
  });

  it('does not infer a name from email, filename, title, or a resume without a name', () => {
    expect(extractCandidateName('Resume\nSoftware Engineer\nemail: alex.jones@example.test\nSkills\nTypeScript')).toBeNull();
    expect(extractCandidateName('alex.jones@example.test\nSenior Backend Engineer\nExperience')).toBeNull();
  });

  it('does not accept a provider-invented name that is absent from extracted text', () => {
    expect(extractCandidateName('Built APIs with TypeScript\nExperience\nProjects', 'Priya Sharma')).toBeNull();
  });
});
