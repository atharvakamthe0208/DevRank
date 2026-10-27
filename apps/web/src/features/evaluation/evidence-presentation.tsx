import { Fragment } from 'react';
import type { CategoryScore, Evidence, FinalReportCategory, PlatformEvaluationEvidence } from '@devrank/contracts';

const fieldLabels: Record<string, string> = {
  activeCommitDays: 'Active commit days', activeCommitWeeks: 'Active commit weeks',
  calendarContributionTotal: 'Calendar contributions', calendarTypeCommits: 'Calendar commit contributions',
  candidateReportedStatistics: 'Candidate-reported statistics', contestAttended: 'Contests attended',
  contestGlobalRanking: 'Global contest ranking', contestParticipants: 'Contest participants',
  contestRating: 'Contest rating', contestTopPercentage: 'Contest top percentage',
  distinctRepositoryLanguages: 'Distinct repository languages', easySolved: 'Easy problems solved',
  followers: 'Followers', following: 'Following', hardSolved: 'Hard problems solved',
  issuesOpened: 'Issues opened', languagesObserved: 'Languages observed', mediumSolved: 'Medium problems solved',
  problemsSolved: 'Problems solved', publicRepositoryCount: 'Public repositories', pullRequestsOpened: 'Pull requests opened',
  repositoriesObserved: 'Repositories observed', repositoriesWithCommitContributions: 'Repositories with commit contributions',
  reviewsSubmitted: 'Reviews submitted', stars: 'Stars', totalContributions: 'Total contributions',
  year: 'Calendar year', timezone: 'Time zone',
};

export function readableEvidenceLabel(value: string): string {
  if (fieldLabels[value]) return fieldLabels[value];
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function readableProvenance(value: string): string {
  const labels: Record<string, string> = {
    github_api: 'GitHub public API', alfa_leetcode_api: 'LeetCode statistics provider',
    candidate_provided: 'Candidate-reported',
  };
  return labels[value] ?? readableEvidenceLabel(value);
}

export function categoryEvidenceStatus(score: CategoryScore, evidence: Evidence[], snapshots: PlatformEvaluationEvidence[] = [], reportCategory?: FinalReportCategory): string {
  if (score.scoreBasis === 'optional_missing_zero') return 'LeetCode profile not provided · policy-defined zero';
  if (score.categoryId === 'technical_skills' && reportCategory) {
    const coverage = reportCategory.metrics.languageCoverageStatus;
    if (coverage === 'complete' || coverage === 'partial' || coverage === 'unavailable') {
      const analyzed = reportCategory.metrics.repositoriesAnalyzed;
      const total = reportCategory.metrics.totalEligibleRepositories;
      const languages = reportCategory.metrics.languagesObserved;
      const missingFields = reportCategory.metrics.repositoriesMissingLanguage;
      const issue = reportCategory.metrics.languageRetrievalIssue;
      const countText = typeof analyzed === 'number' && typeof total === 'number' ? `${analyzed} of ${total} repositories analyzed` : 'repository coverage count unavailable';
      const languageText = typeof languages === 'string' ? ` · Languages observed: ${languages}` : '';
      const missingText = typeof missingFields === 'number' && missingFields > 0 ? ` · ${missingFields} repositories did not include language metadata` : '';
      const issueText = issue === 'provider_rate_limited' ? ' · GitHub rate limit interrupted repository retrieval'
        : issue === 'provider_timeout' ? ' · GitHub timed out during repository retrieval'
          : issue === 'provider_unavailable' ? ' · GitHub could not be reached during repository retrieval'
            : issue === 'invalid_response' ? ' · GitHub returned incomplete repository data'
              : issue === 'provider_error' ? ' · Repository retrieval ended with a provider error' : '';
      if (coverage === 'complete') return `Complete language coverage · ${countText}${languageText}`;
      if (coverage === 'unavailable') return `GitHub language data unavailable · ${countText} · no score assigned`;
      return `Partial language coverage · ${countText}${languageText}${missingText}${issueText} · no score assigned until coverage is complete`;
    }
  }
  if (score.status !== 'scored' && typeof reportCategory?.metrics.dataStatus === 'string') return reportCategory.metrics.dataStatus;
  if (score.status !== 'scored' || score.score === undefined) return 'Insufficient evidence · no score assigned';
  const referencedEvidence = evidence.filter(({ evidenceId }) => score.evidenceRefs.includes(evidenceId));
  const relatedSnapshots = snapshots.filter(({ categoryMappings }) => categoryMappings.some(({ categoryId, relation }) => categoryId === score.categoryId && relation === 'supporting'));
  if (referencedEvidence.some(({ verificationStatus }) => verificationStatus === 'partially_verified')
    || relatedSnapshots.some(({ availability }) => availability === 'partial')) return 'Scored · partial source evidence';
  if (relatedSnapshots.some(({ availability }) => availability === 'unavailable' || availability === 'not_provided')) return 'Scored · some source data unavailable';
  return 'Scored · evidence available';
}

export function EvidenceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Not provided</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{String(value)}</span>;
  if (Array.isArray(value)) return value.length
    ? <ul className="evidence-value-list">{value.map((item, index) => <li key={index}><EvidenceValue value={item}/></li>)}</ul>
    : <span>None recorded</span>;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined && item !== null);
    return entries.length
      ? <dl className="evidence-value-list">{entries.map(([key, item]) => <Fragment key={key}><dt>{readableEvidenceLabel(key)}</dt><dd><EvidenceValue value={item}/></dd></Fragment>)}</dl>
      : <span>None recorded</span>;
  }
  return <span>Unavailable</span>;
}

export function formatEvidenceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
