import {
  githubInsightsSchema,
  type GitHubInsights,
} from '@devrank/contracts';

type Reason = 'not_configured' | 'provider_error' | 'provider_timeout' | 'provider_unavailable' | 'malformed_response' | 'rate_limited' | 'missing_history' | 'attribution_mismatch' | 'partial_response' | 'truncated_history' | 'duplicate_conflict';

export interface UtcCalendarRange {
  year: number;
  from: string;
  to: string;
  periodEnd: string;
  observedAt: string;
}
export function currentUtcCalendarRange(now: Date): UtcCalendarRange {
  if (!Number.isFinite(now.getTime())) throw new TypeError('A valid observation date is required');
  const year = now.getUTCFullYear();
  const from = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1) - 1);
  const to = new Date(Math.min(now.getTime(), yearEnd.getTime()));
  return { year, from: from.toISOString(), to: to.toISOString(), periodEnd: yearEnd.toISOString(), observedAt: now.toISOString() };
}

function dateOnlyUtc(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : undefined;
}

function weekKeyUtc(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  const dayFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayFromMonday);
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function nonnegativeInt(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function unavailableCurrentYear(range: UtcCalendarRange, reason: Reason) {
  return {
    status: 'unavailable' as const,
    year: range.year,
    timezone: 'UTC' as const,
    periodStart: range.from,
    periodEnd: range.periodEnd,
    observedThrough: range.to,
    observedAt: range.observedAt,
    reasons: [reason],
  };
}

function normalizeCurrentYearCalendar(collection: Record<string, unknown> | undefined, range: UtcCalendarRange, hasErrors: boolean) {
  const calendar = record(collection?.contributionCalendar);
  const weeks = Array.isArray(calendar?.weeks) ? calendar.weeks : undefined;
  if (!weeks || weeks.length === 0) return unavailableCurrentYear(range, 'missing_history');

  const startDate = range.from.slice(0, 10);
  const endDate = range.to.slice(0, 10);
  const days = new Map<string, number>();
  const reasons = new Set<Reason>();
  if (hasErrors) reasons.add('partial_response');
  for (const weekValue of weeks) {
    const week = record(weekValue);
    const contributionDays = Array.isArray(week?.contributionDays) ? week.contributionDays : [];
    for (const dayValue of contributionDays) {
      const day = record(dayValue);
      const date = typeof day?.date === 'string' ? dateOnlyUtc(day.date) : undefined;
      const count = day?.contributionCount;
      if (!date || !nonnegativeInt(count)) {
        reasons.add('partial_response');
        continue;
      }
      if (date < startDate || date > endDate) continue;
      const existing = days.get(date);
      if (existing !== undefined) {
        reasons.add(existing === count ? 'partial_response' : 'duplicate_conflict');
        days.set(date, Math.max(existing, count));
      } else days.set(date, count);
    }
  }

  const dailyContributions = [...days].sort(([left], [right]) => left.localeCompare(right))
    .map(([date, contributionCount]) => ({ date, contributionCount }));
  if (dailyContributions.length === 0) return unavailableCurrentYear(range, reasons.values().next().value ?? 'missing_history');
  const expectedDayCount = Math.floor((Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)) / 86_400_000) + 1;
  if (days.size < expectedDayCount) reasons.add('partial_response');
  const totalContributions = dailyContributions.reduce((sum, day) => sum + day.contributionCount, 0);
  const yearTotal = calendar?.totalContributions;
  if (!nonnegativeInt(yearTotal) || yearTotal !== totalContributions) reasons.add('partial_response');

  const firstDate = new Date(`${startDate}T00:00:00.000Z`);
  const lastDate = new Date(`${endDate}T00:00:00.000Z`);
  const observedWeekKeys = new Set<string>();
  for (const date = new Date(firstDate); date <= lastDate; date.setUTCDate(date.getUTCDate() + 1)) {
    observedWeekKeys.add(weekKeyUtc(date.toISOString().slice(0, 10)));
  }
  const activeWeekKeys = new Set(dailyContributions.filter(({ contributionCount }) => contributionCount > 0).map(({ date }) => weekKeyUtc(date)));
  const observedWeeks = observedWeekKeys.size;
  const weeklyCounts = new Map([...observedWeekKeys].map((weekStart) => [weekStart, 0]));
  for (const day of dailyContributions) {
    const key = weekKeyUtc(day.date);
    weeklyCounts.set(key, (weeklyCounts.get(key) ?? 0) + day.contributionCount);
  }
  const weeklyContributions = [...weeklyCounts].sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, contributionCount]) => ({ weekStart, contributionCount }));
  const elapsedWeekRate = observedWeeks > 0 ? round2(totalContributions / observedWeeks) : undefined;
  const activeWeekCoveragePercent = observedWeeks > 0 ? round2(activeWeekKeys.size / observedWeeks * 100) : undefined;
  const typeCounts = {
    commits: collection?.totalCommitContributions,
    pullRequestsOpened: collection?.totalPullRequestContributions,
    issuesOpened: collection?.totalIssueContributions,
    reviewsSubmitted: collection?.totalPullRequestReviewContributions,
  };
  const contributionTypes = Object.fromEntries(Object.entries(typeCounts).filter(([, value]) => nonnegativeInt(value)));
  const missingType = Object.values(typeCounts).some((value) => !nonnegativeInt(value));
  if (missingType) reasons.add('partial_response');
  return {
    status: reasons.size ? 'partial' as const : 'available' as const,
    year: range.year,
    timezone: 'UTC' as const,
    periodStart: range.from,
    periodEnd: range.periodEnd,
    observedThrough: range.to,
    observedAt: range.observedAt,
    totalContributions,
    dailyContributions,
    weeklyContributions,
    observedWeeks,
    activeWeeks: activeWeekKeys.size,
    ...(activeWeekCoveragePercent !== undefined ? { activeWeekCoveragePercent } : {}),
    ...(elapsedWeekRate !== undefined ? { contributionsPerObservedWeek: elapsedWeekRate } : {}),
    ...(Object.keys(contributionTypes).length ? { contributionTypes } : {}),
    reasons: [...reasons],
  };
}

function normalizeDevelopmentActivity(collection: Record<string, unknown> | undefined, year: number, hasErrors: boolean) {
  const reasons = new Set<Reason>();
  if (hasErrors) reasons.add('partial_response');
  const total = collection?.totalCommitContributions;
  const repositories = collection?.commitContributionsByRepository;
  if (!Array.isArray(repositories)) {
    return {
      status: nonnegativeInt(total) ? 'partial' as const : 'unavailable' as const,
      ...(nonnegativeInt(total) ? { totalCommitContributions: total } : {}),
      duplicateDailyRecords: 0,
      reasons: [...reasons, 'missing_history' as const],
    };
  }
  if (!nonnegativeInt(total)) reasons.add('partial_response');
  const uniqueByRepoDay = new Map<string, { repo: string; date: string; count: number }>();
  let duplicateDailyRecords = 0;
  for (const repositoryValue of repositories) {
    const repository = record(repositoryValue);
    const repositoryInfo = record(repository?.repository);
    const repoName = typeof repositoryInfo?.nameWithOwner === 'string' ? repositoryInfo.nameWithOwner : undefined;
    const contributions = record(repository?.contributions);
    const nodes = Array.isArray(contributions?.nodes) ? contributions.nodes : undefined;
    const pageInfo = record(contributions?.pageInfo);
    if (!repoName || !nodes) { reasons.add('partial_response'); continue; }
    if (pageInfo?.hasNextPage === true) reasons.add('truncated_history');
    for (const nodeValue of nodes) {
      const node = record(nodeValue);
      const occurredAt = typeof node?.occurredAt === 'string' ? new Date(node.occurredAt) : undefined;
      const count = node?.commitCount;
      if (!occurredAt || !Number.isFinite(occurredAt.getTime()) || occurredAt.getUTCFullYear() !== year || !nonnegativeInt(count)) {
        reasons.add('partial_response');
        continue;
      }
      const date = occurredAt.toISOString().slice(0, 10);
      const key = `${repoName}\u0000${date}`;
      const existing = uniqueByRepoDay.get(key);
      if (existing) {
        duplicateDailyRecords += 1;
        if (existing.count !== count) reasons.add('duplicate_conflict');
        uniqueByRepoDay.set(key, { repo: repoName, date, count: Math.max(existing.count, count) });
      } else uniqueByRepoDay.set(key, { repo: repoName, date, count });
    }
  }
  if (repositories.length >= 100) reasons.add('truncated_history');
  if (duplicateDailyRecords > 0 && !reasons.has('duplicate_conflict')) reasons.add('partial_response');
  const observedCommitCount = [...uniqueByRepoDay.values()].reduce((sum, contribution) => sum + contribution.count, 0);
  if (nonnegativeInt(total) && observedCommitCount !== total) reasons.add('partial_response');
  const activeDays = new Set([...uniqueByRepoDay.values()].map(({ date }) => date));
  const activeWeeks = new Set([...activeDays].map(weekKeyUtc));
  const status = reasons.size ? 'partial' as const : nonnegativeInt(total) ? 'available' as const : 'unavailable' as const;
  return {
    status,
    ...(nonnegativeInt(total) ? { totalCommitContributions: total } : {}),
    activeCommitDays: activeDays.size,
    activeCommitWeeks: activeWeeks.size,
    repositoriesWithCommitContributions: new Set([...uniqueByRepoDay.values()].map(({ repo }) => repo)).size,
    duplicateDailyRecords,
    reasons: [...reasons],
  };
}

function normalizeCollaboration(collection: Record<string, unknown> | undefined, hasErrors: boolean) {
  const totals = {
    pullRequestsOpened: collection?.totalPullRequestContributions,
    issuesOpened: collection?.totalIssueContributions,
    reviewsSubmitted: collection?.totalPullRequestReviewContributions,
  };
  const counts = Object.fromEntries(Object.entries(totals).filter(([, value]) => nonnegativeInt(value)));
  const reasons: Reason[] = [];
  if (hasErrors) reasons.push('partial_response');
  if (Object.keys(counts).length < 3) reasons.push('partial_response');
  const status = Object.keys(counts).length === 0 ? 'unavailable' as const : reasons.length ? 'partial' as const : 'available' as const;
  return { status, ...counts, reasons: [...new Set(reasons)] };
}

export function normalizeGitHubInsights(input: unknown, expectedLogin: string, now = new Date()): GitHubInsights {
  const range = currentUtcCalendarRange(now);
  const body = record(input);
  const data = record(body?.data);
  const user = record(data?.user);
  const actualLogin = typeof user?.login === 'string' && user.login.length > 0 ? user.login : undefined;
  const mismatch = !actualLogin || actualLogin.toLowerCase() !== expectedLogin.toLowerCase();
  const errorList = Array.isArray(body?.errors) ? body.errors : [];
  const hasErrors = errorList.length > 0;
  const collection = record(user?.contributionsCollection);
  const errorText = errorList.map((error) => JSON.stringify(error)).join(' ');
  const errorReason: Reason = /rate limit/i.test(errorText) ? 'rate_limited'
    : /not configured/i.test(errorText) ? 'not_configured'
    : /timeout/i.test(errorText) ? 'provider_timeout'
      : /network|unavailable/i.test(errorText) ? 'provider_unavailable'
        : /malformed/i.test(errorText) ? 'malformed_response' : 'provider_error';
  const limitations = [
    'GitHub account attribution is not identity verification; linked accounts, commit attribution settings, and unlinked author emails can change the data.',
    'When configured, the contribution query uses a dedicated backend token expected to omit the optional read:user scope. Token scope is an operator configuration requirement and is not introspected at runtime; public-only results depend on that configuration.',
    'Contribution totals are context, not code quality, engineering competence, or an evaluation score.',
    'The calendar total is authoritative for current-year volume. Type breakdowns and commit activity are shown separately and are never added to that total.',
    'Calendar volume is normalized by observed UTC weeks; distribution is active UTC weeks divided by observed UTC weeks. These descriptive rates are not rubric scores.',
  ];

  if (mismatch) {
    const attributionReason: Reason = actualLogin ? 'attribution_mismatch' : hasErrors ? errorReason : 'missing_history';
    return githubInsightsSchema.parse({
      requestedLogin: expectedLogin,
      attributionStatus: actualLogin ? 'mismatched' : 'unavailable',
      ...(actualLogin ? { attributedLogin: actualLogin } : {}),
      currentYearContributions: unavailableCurrentYear(range, attributionReason),
      developmentActivity: { status: 'unavailable', duplicateDailyRecords: 0, reasons: [attributionReason] },
      collaboration: { status: 'unavailable', reasons: [attributionReason] },
      limitations,
    });
  }

  const noCollection = !collection;
  return githubInsightsSchema.parse({
    requestedLogin: expectedLogin,
    attributionStatus: 'matched',
    attributedLogin: actualLogin,
    currentYearContributions: noCollection ? unavailableCurrentYear(range, hasErrors ? errorReason : 'missing_history') : normalizeCurrentYearCalendar(collection, range, hasErrors),
    developmentActivity: noCollection
      ? { status: 'unavailable', duplicateDailyRecords: 0, reasons: [hasErrors ? errorReason : 'missing_history'] }
      : normalizeDevelopmentActivity(collection, range.year, hasErrors),
    collaboration: noCollection
      ? { status: 'unavailable', reasons: [hasErrors ? errorReason : 'missing_history'] }
      : normalizeCollaboration(collection, hasErrors),
    limitations,
  });
}
