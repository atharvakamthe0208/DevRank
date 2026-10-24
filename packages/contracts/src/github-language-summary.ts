import { z } from 'zod';

export const githubLanguageCoverageStatusSchema = z.enum(['complete', 'partial', 'unavailable']);
export const githubLanguageRetrievalIssueSchema = z.enum([
  'provider_rate_limited', 'provider_timeout', 'provider_unavailable', 'provider_error', 'invalid_response',
]);

export const githubLanguageSummarySchema = z.object({
  totalEligibleRepositories: z.number().int().nonnegative(),
  repositoriesAnalyzed: z.number().int().nonnegative(),
  observedLanguages: z.array(z.string().min(1)),
  repositoriesMissingLanguage: z.number().int().nonnegative(),
  coverageStatus: githubLanguageCoverageStatusSchema,
  retrievalIssue: githubLanguageRetrievalIssueSchema.optional(),
}).strict();

export type GitHubLanguageSummary = z.infer<typeof githubLanguageSummarySchema>;
export type GitHubLanguageCoverageStatus = z.infer<typeof githubLanguageCoverageStatusSchema>;
export type GitHubLanguageRetrievalIssue = z.infer<typeof githubLanguageRetrievalIssueSchema>;

/** Summarizes every repository returned by GitHub without treating missing fields as "no language". */
export function summarizeGitHubLanguages(
  repositories: Array<{ primaryLanguage?: unknown }>,
  totalEligibleRepositories: number,
  paginationComplete: boolean,
  retrievalIssue?: GitHubLanguageRetrievalIssue,
): GitHubLanguageSummary {
  const observedLanguages = [...new Set(repositories.flatMap(({ primaryLanguage }) =>
    typeof primaryLanguage === 'string' && primaryLanguage.trim() ? [primaryLanguage.trim()] : []))]
    .sort((left, right) => left.localeCompare(right));
  const repositoriesMissingLanguage = repositories.filter(({ primaryLanguage }) => primaryLanguage === undefined).length;
  const complete = paginationComplete
    && repositories.length >= totalEligibleRepositories
    && repositoriesMissingLanguage === 0
    && retrievalIssue === undefined;
  const coverageStatus: GitHubLanguageCoverageStatus = complete
    ? 'complete'
    : repositories.length > 0 ? 'partial' : retrievalIssue ? 'unavailable' : 'partial';

  return githubLanguageSummarySchema.parse({
    totalEligibleRepositories,
    repositoriesAnalyzed: repositories.length,
    observedLanguages,
    repositoriesMissingLanguage,
    coverageStatus,
    ...(retrievalIssue ? { retrievalIssue } : {}),
  });
}
