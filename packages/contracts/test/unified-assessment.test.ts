import { describe, expect, it } from 'vitest';
import { calculateUnifiedAssessment, isResumeRoleCompatible, rankUnifiedAssessments, type UnifiedAssessmentInputs } from '../src/unified-assessment.js';
import { scoringCategories } from '../src/scoring.js';

const candidateId = 'bb235ee8-a6cf-407b-b8b6-66e4e540f14c';
const anotherCandidateId = 'cddae17a-6f9d-4f60-a13f-2e31e8e7529a';
const thirdCandidateId = 'a2e2378a-5c0b-40a2-ad27-ec9462476319';
const evaluationId = '8c649201-886d-4c46-b99f-8aa2afc0cd6c';
const resumeId = 'a1328d63-3e22-448f-b719-1a76ecbaea0d';
const weights = { project_portfolio: 20, technical_skills: 20, development_activity: 15, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 25 };

function input(overrides: Partial<UnifiedAssessmentInputs> = {}): UnifiedAssessmentInputs {
  return {
    id: '1fa1c1bb-3c20-4b5c-ab53-437d8c616d28', candidateId, roleId: 'software_developer', roleLabel: 'Software Developer', generatedAt: '2026-10-25T12:00:00.000Z',
    platformEvaluation: { id: evaluationId, candidateId, roleId: 'software_developer', result: {
      scoringVersion: '4.0.1',
      targetRole: 'software_developer',
      categoryScores: scoringCategories.map(({ id }) => ({ categoryId: id, score: id === 'problem_solving_dsa' ? 90 : 80, status: 'scored', evidenceRefs: [`evidence-${id}`] })),
      roleWeightsUsed: weights,
      evidence: scoringCategories.map(({ id }) => ({ evidenceId: `evidence-${id}`, categoryId: id, source: id === 'problem_solving_dsa' ? 'leetcode · alfa_leetcode_api' : 'github · github_api', availability: 'available', normalizedValue: id === 'problem_solving_dsa' ? 90 : 80 })),
      platformEvidence: [{ evidenceId: 'github-row:github', source: 'github_api' }, { evidenceId: 'leetcode-row:leetcode:alfa', source: 'alfa_leetcode_api' }],
      strengths: ['Saved platform strength'], skillGaps: ['Saved platform gap'],
    } },
    resume: { id: resumeId, status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 70 }, preliminaryScore: null },
    ...overrides,
  };
}

describe('unified candidate assessment scoring', () => {
  it('matches only documented resume title aliases to supported roles', () => {
    expect(isResumeRoleCompatible('software_developer', 'Senior Software Engineer')).toBe(true);
    expect(isResumeRoleCompatible('software_developer', 'Full-Stack Developer')).toBe(true);
    expect(isResumeRoleCompatible('software_developer', 'Machine Learning Engineer')).toBe(false);
    expect(isResumeRoleCompatible('ai_ml_engineer', 'Lead ML Engineer')).toBe(true);
  });

  it('calculates a deterministic combined score from validated component scores and snapshots', () => {
    const result = calculateUnifiedAssessment(input());
    expect(result).toMatchObject({ status: 'completed', overallScore: 77.5, evidenceCompleteness: 100 });
    expect(result.weights).toEqual({ resume: 40, github: 45, leetcode: 15 });
    expect(result.components.github.score).toBe(80);
    expect(result.sourceReferences).toMatchObject({ platformEvaluationId: evaluationId, resumeScreeningId: resumeId });
    expect(result.sourceReferences.githubSnapshotIds).toEqual(['github-row:github']);
    expect(result.sourceReferences.leetcodeSnapshotIds).toEqual(['leetcode-row:leetcode:alfa']);
  });

  it('preserves the selected role six-category weight ratio inside the 60% platform share', () => {
    const roleSpecificWeights = { project_portfolio: 15, technical_skills: 15, development_activity: 10, collaboration: 10, current_year_contributions: 10, problem_solving_dsa: 40 };
    const source = input();
    source.platformEvaluation!.result.roleWeightsUsed = roleSpecificWeights;
    const result = calculateUnifiedAssessment(source);
    expect(result.weights).toEqual({ resume: 40, github: 36, leetcode: 24 });
    expect(result.overallScore).toBe(78.4);
  });

  it('does not mix another candidate or role platform evaluation into the assessment', () => {
    const result = calculateUnifiedAssessment(input({ platformEvaluation: { ...input().platformEvaluation!, candidateId: anotherCandidateId } }));
    expect(result.status).toBe('insufficient_evidence');
    expect(result.overallScore).toBeNull();
    expect(result.sourceReferences.platformEvaluationId).toBeNull();
    expect(result.components.github.status).toBe('not_evaluated');
  });

  it('requires an exact current v4 role snapshot and evidence-backed component references', () => {
    const withoutVersion = input();
    delete withoutVersion.platformEvaluation!.result.scoringVersion;
    expect(calculateUnifiedAssessment(withoutVersion).components.github.status).toBe('not_evaluated');
    const withoutEvidence = input();
    withoutEvidence.platformEvaluation!.result.categoryScores = withoutEvidence.platformEvaluation!.result.categoryScores.map((item) => ({ ...item, evidenceRefs: [] }));
    expect(calculateUnifiedAssessment(withoutEvidence)).toMatchObject({ status: 'insufficient_evidence', overallScore: null });
  });

  it('accepts persisted platform · provenance source labels but rejects an unapproved source mapping', () => {
    const wrongSource = input();
    wrongSource.platformEvaluation!.result.evidence = wrongSource.platformEvaluation!.result.evidence!.map((item) => item.categoryId === 'technical_skills' ? { ...item, source: 'leetcode · alfa_leetcode_api' } : item);
    expect(calculateUnifiedAssessment(wrongSource)).toMatchObject({ status: 'insufficient_evidence', overallScore: null, missingComponents: ['github'] });
    const wrongProvenance = input();
    wrongProvenance.platformEvaluation!.result.evidence = wrongProvenance.platformEvaluation!.result.evidence!.map((item) => item.categoryId === 'technical_skills' ? { ...item, source: 'github · unknown_provider' } : item);
    expect(calculateUnifiedAssessment(wrongProvenance)).toMatchObject({ status: 'insufficient_evidence', overallScore: null, missingComponents: ['github'] });
  });

  it('does not use missing or provisional resume scores in the final score', () => {
    const missing = calculateUnifiedAssessment(input({ resume: null }));
    expect(missing.components.resume.status).toBe('not_evaluated');
    expect(missing.overallScore).toBeNull();
    const preliminary = calculateUnifiedAssessment(input({ resume: { id: resumeId, status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'provisional', score: 62 }, preliminaryScore: 71 } }));
    expect(preliminary.components.resume).toMatchObject({ score: 62, status: 'preliminary' });
    expect(preliminary.overallScore).toBeNull();
    expect(preliminary.missingComponents).toContain('resume');
  });

  it('preserves a genuine zero source score and withholds overall score for missing components', () => {
    const zero = input();
    zero.platformEvaluation!.result.categoryScores = zero.platformEvaluation!.result.categoryScores.map((item) => item.categoryId === 'problem_solving_dsa' ? { ...item, score: 0 } : item);
    zero.platformEvaluation!.result.evidence = zero.platformEvaluation!.result.evidence!.map((item) => item.categoryId === 'problem_solving_dsa' ? { ...item, normalizedValue: 0 } : item);
    const result = calculateUnifiedAssessment(zero);
    expect(result.components.leetcode).toMatchObject({ score: 0, status: 'validated' });
    expect(result.status).toBe('completed');
    const partial = input();
    partial.platformEvaluation!.result.categoryScores = partial.platformEvaluation!.result.categoryScores.map((item) => item.categoryId === 'technical_skills' ? { categoryId: item.categoryId, status: 'insufficient_evidence' } : item);
    expect(calculateUnifiedAssessment(partial)).toMatchObject({ overallScore: null, status: 'insufficient_evidence' });
  });

  it('shows a policy-only DSA zero without counting it as observed LeetCode evidence', () => {
    const source = input();
    source.platformEvaluation!.result.categoryScores = source.platformEvaluation!.result.categoryScores.map((item) => item.categoryId === 'problem_solving_dsa' ? { ...item, score: 0, scoreBasis: 'optional_missing_zero' } : item);
    const result = calculateUnifiedAssessment(source);
    expect(result.components.leetcode).toMatchObject({ score: null, status: 'policy_only' });
    expect(result.overallScore).toBeNull();
    expect(result.limitations[2]).toContain('policy');
  });

  it('keeps an incompatible linked resume identifiable but excludes its score from the selected role', () => {
    const result = calculateUnifiedAssessment(input({
      resume: { id: resumeId, status: 'completed', jobTitle: 'Machine Learning Engineer', evaluation: { status: 'complete', score: 84 }, preliminaryScore: null },
      resumeRoleMismatch: true,
    }));
    expect(result.components.resume).toMatchObject({ score: null, status: 'insufficient_evidence', sourceId: resumeId });
    expect(result.sourceReferences.resumeScreeningId).toBe(resumeId);
    expect(result.limitations.some((item) => item.includes('different job title'))).toBe(true);
    expect(result.overallScore).toBeNull();
  });

  it('ranks complete final scores first with sequential deterministic ties and leaves incomplete assessments unranked', () => {
    const high = calculateUnifiedAssessment(input({ id: '11111111-1111-4111-8111-111111111111', candidateId: candidateId, resume: { id: resumeId, status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 90 }, preliminaryScore: null } }));
    const tied = calculateUnifiedAssessment(input({ id: '22222222-2222-4222-8222-222222222222', candidateId: anotherCandidateId,
      platformEvaluation: { ...input().platformEvaluation!, candidateId: anotherCandidateId }, resume: { id: 'b1328d63-3c22-448f-b719-1a76ecbaea0d', status: 'completed', jobTitle: 'Software Developer', evaluation: { status: 'complete', score: 90 }, preliminaryScore: null } }));
    const incomplete = calculateUnifiedAssessment(input({ id: '33333333-3333-4333-8333-333333333333', candidateId: thirdCandidateId, platformEvaluation: null, resume: null }));
    const result = rankUnifiedAssessments([
      { candidateName: 'Beta', assessment: tied }, { candidateName: 'No score', assessment: incomplete }, { candidateName: 'Alpha', assessment: high },
    ]);
    expect(result.items.map(({ candidateName, rank }) => [candidateName, rank])).toEqual([['Alpha', 1], ['Beta', 2], ['No score', null]]);
    expect(result.ranked).toBe(2);
  });
});
