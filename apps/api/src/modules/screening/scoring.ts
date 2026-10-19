import { screeningCategories, screeningScoreSchema, type RequirementResult, type ScreeningScore } from '@devrank/contracts';

/**
 * Resume job-match score v1. This is deliberately independent of DevRank's developer
 * evaluation score. Only explicit, job-specific requirements in this session contribute.
 * Missing/uncertain evidence is excluded; no weight is silently assigned to missing facts.
 */
export function scoreResumeJobMatch(requirements: RequirementResult[]): ScreeningScore {
  const ids = requirements.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('Requirement IDs must be unique');
  const categories = screeningCategories.map(({ id: categoryId, weight }) => {
    const items = requirements.filter((item) => item.categoryId === categoryId);
    const applicable = items.filter(({ status }) => status !== 'not_applicable');
    const evaluable = applicable.filter(({ status }) => status !== 'insufficient_evidence');
    const evaluableWeight = applicable.length > 0 && evaluable.length === applicable.length ? weight : 0;
    if (!applicable.length || evaluable.length !== applicable.length) return {
      categoryId, weight, evaluableWeight,
      status: !applicable.length ? 'not_applicable' as const : 'insufficient_evidence' as const,
      requirementIds: items.map(({ id }) => id),
    };
    const importanceWeight = (item: RequirementResult) => item.importance === 'required' ? 2 : 1;
    const denominator = evaluable.reduce((sum, item) => sum + importanceWeight(item), 0);
    const raw = evaluable.reduce((sum, item) => sum + importanceWeight(item) * (
      item.status === 'demonstrated' ? 100 : item.status === 'partially_demonstrated' ? 50 : 0
    ), 0) / denominator;
    const score = Math.round((raw + Number.EPSILON) * 100) / 100;
    return {
      categoryId, weight, score,
      weightedContribution: Math.round((score * weight / 100 + Number.EPSILON) * 100) / 100,
      evaluableWeight, status: 'scored' as const, requirementIds: items.map(({ id }) => id),
    };
  });
  const configuredEvaluableWeight = categories.reduce((sum, item) => sum + item.evaluableWeight, 0);
  const applicableWeight = categories.filter(({ status }) => status !== 'not_applicable').reduce((sum, item) => sum + item.weight, 0);
  const score = configuredEvaluableWeight === 0 ? undefined : Math.round((categories.reduce((sum, item) => sum + (item.weightedContribution ?? 0), 0) / configuredEvaluableWeight * 100 + Number.EPSILON) * 100) / 100;
  const evidenceCoverage = applicableWeight === 0 ? 0 : Math.round(configuredEvaluableWeight / applicableWeight * 100);
  const result: ScreeningScore = {
    rubricVersion: 'resume-job-match-1.0.0', scoreType: 'resume_job_match',
    status: score === undefined ? 'insufficient_evidence' : configuredEvaluableWeight === applicableWeight ? 'complete' : 'provisional',
    ...(score === undefined ? {} : { score }),
    evidenceCoverage,
    categories, requirements,
  };
  return screeningScoreSchema.parse(result);
}
