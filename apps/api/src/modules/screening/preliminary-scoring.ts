import { preliminaryEvaluationSchema, screeningCategories, type ScreeningRequirement } from '@devrank/contracts';

const shortSkillTokens = new Set(['ai', 'c#', 'c++', 'f#', 'go', 'ml', 'qa', 'r', 'sql', 'ui', 'ux']);
const ignoredTerms = new Set([
  'about', 'ability', 'able', 'across', 'additional', 'also', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'both',
  'build', 'building', 'candidate', 'company', 'develop', 'development', 'excellent', 'experience', 'for', 'from', 'good',
  'have', 'having', 'in', 'include', 'including', 'into', 'is', 'it', 'job', 'knowledge', 'looking', 'must', 'of', 'on',
  'or', 'our', 'preferred', 'proven', 'qualification', 'qualifications', 'relevant', 'required', 'role', 'should', 'skill',
  'skills', 'strong', 'team', 'that', 'the', 'their', 'this', 'to', 'use', 'using', 'we', 'with', 'work', 'working', 'years',
]);

function terms(value: string): string[] {
  const matches = value.normalize('NFKC').toLocaleLowerCase().match(/c\+\+|c#|f#|\.net|[\p{L}][\p{L}\p{N}+#.-]*/gu) ?? [];
  return [...new Set(matches.map((term) => {
    const normalized = term.startsWith('.') ? term.slice(1) : term;
    return shortSkillTokens.has(normalized) ? normalized : normalized.replace(/[+#.-]+$/g, '');
  }).filter((term) => (term.length >= 3 || shortSkillTokens.has(term)) && !ignoredTerms.has(term)))];
}

function excerptFor(text: string, matchedTerms: string[]): string | undefined {
  if (!matchedTerms.length) return undefined;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((candidate) => terms(candidate).some((term) => matchedTerms.includes(term)));
  if (!line) return undefined;
  if (line.length <= 240) return line;
  const lower = line.toLocaleLowerCase();
  const hit = matchedTerms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, Math.min(hit - 80, line.length - 240));
  return line.slice(start, start + 240);
}

/**
 * Produces a preliminary resume-document match, not a claim about candidate ability.
 * Only explicit lexical matches contribute; absent criteria are listed as unverified.
 */
export function scorePreliminaryMatch(
  requirements: ScreeningRequirement[],
  resumeText: string,
  jobDescription: string,
) {
  const resume = resumeText.replace(/\u0000/g, '').replace(/\r/g, '').trim();
  const job = jobDescription.trim();
  if (resume.length < 40 || job.length < 50 || !requirements.length) return null;

  const jobTerms = new Set(terms(job));
  const resumeTerms = new Set(terms(resume));
  const criteria = requirements.flatMap((requirement) => {
    // Requirements only contribute when their substantive terms are present in
    // the original job description, preventing model-added criteria from scoring.
    const requestedTerms = terms(requirement.description).filter((term) => jobTerms.has(term));
    if (!requestedTerms.length) return [];
    const matchedTerms = requestedTerms.filter((term) => resumeTerms.has(term));
    const matchPercentage = requestedTerms.length ? Math.round(matchedTerms.length / requestedTerms.length * 100) : undefined;
    const supported = matchedTerms.length > 0 && matchPercentage !== undefined;
    return [{
      id: requirement.id,
      categoryId: requirement.categoryId,
      description: requirement.description,
      importance: requirement.importance,
      status: supported ? 'supported' as const : 'unverified' as const,
      matchedTerms,
      ...(supported && matchPercentage !== undefined ? { matchPercentage, evidenceExcerpt: excerptFor(resume, matchedTerms) } : {}),
    }];
  });
  if (!criteria.some((criterion) => criterion.status === 'supported')) return null;

  const categoryWeight = new Map<string, number>(screeningCategories.map(({ id, weight }) => [id, weight]));
  const applicableCategories = screeningCategories.filter(({ id }) => criteria.some((criterion) => criterion.categoryId === id));
  const totalCategoryWeight = applicableCategories.reduce((sum, category) => sum + category.weight, 0);
  if (totalCategoryWeight === 0) return null;

  const score = applicableCategories.reduce((total, category) => {
    const categoryCriteria = criteria.filter((criterion) => criterion.categoryId === category.id);
    const denominator = categoryCriteria.reduce((sum, criterion) => sum + (criterion.importance === 'required' ? 2 : 1), 0);
    const categoryMatch = categoryCriteria.reduce((sum, criterion) => sum + (criterion.importance === 'required' ? 2 : 1) * (criterion.matchPercentage ?? 0), 0) / denominator;
    return total + category.weight * categoryMatch;
  }, 0) / totalCategoryWeight;
  const evidenceWeight = criteria.reduce((sum, criterion) => criterion.status === 'supported'
    ? sum + (categoryWeight.get(criterion.categoryId) ?? 0) * (criterion.importance === 'required' ? 2 : 1)
    : sum, 0);
  const totalEvidenceWeight = criteria.reduce((sum, criterion) => sum + (categoryWeight.get(criterion.categoryId) ?? 0) * (criterion.importance === 'required' ? 2 : 1), 0);
  return preliminaryEvaluationSchema.parse({
    rubricVersion: 'resume-document-match-1.0.0',
    score: Math.round(score * 100) / 100,
    evidenceCoverage: totalEvidenceWeight ? Math.round(evidenceWeight / totalEvidenceWeight * 100) : 0,
    criteria,
  });
}

/** Partial update intentionally omits `evaluation`, preserving validated scores. */
export function preliminaryResumePatch(candidateName: string | null, preliminaryEvaluation: ReturnType<typeof scorePreliminaryMatch>, updatedAt: string) {
  return {
    extracted_data: { candidate: { name: candidateName } },
    ...(preliminaryEvaluation ? { preliminary_evaluation: preliminaryEvaluation } : {}),
    updated_at: updatedAt,
  };
}
