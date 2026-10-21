import type { ScreeningComparisonResponse, ScreeningDetailsResponse } from '@devrank/contracts';

export function filterAndSortScreeningResumes(
  details: ScreeningDetailsResponse,
  ranking: ScreeningComparisonResponse['ranking'],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rankById = new Map(ranking.ranked.map((item) => [item.resumeId, item]));
  const matching = details.resumes.filter((resume) => {
    if (!normalizedQuery) return true;
    return `${resume.candidate?.name ?? ''} ${resume.filename}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const unscored = matching.filter((resume) => !rankById.has(resume.id));
  const resumeById = new Map(matching.map((resume) => [resume.id, resume]));
  // Keep the backend's saved-score order and tie ranks authoritative.
  const orderedScored = ranking.ranked.flatMap((item) => {
    const resume = resumeById.get(item.resumeId);
    return resume ? [resume] : [];
  });
  return { scored: orderedScored, unscored, rankById };
}

/** Presentation-only colour bands; these are not validated hiring thresholds. */
export function scoreBand(score: number): 'high' | 'medium' | 'low' {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

export function scorePresentation(resume: ScreeningDetailsResponse['resumes'][number]) {
  if (resume.evaluation?.score !== undefined) return { score: resume.evaluation.score, label: 'Validated score' as const, preliminary: false };
  if (resume.preliminaryEvaluation) return { score: resume.preliminaryEvaluation.score, label: 'Preliminary match' as const, preliminary: true };
  return null;
}
