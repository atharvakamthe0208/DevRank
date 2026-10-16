# Proposed GitHub + LeetCode Rubric (Not Approved)

This is a product proposal, not the active DevRank scoring policy. The `github_leetcode_proposal_v1` contract is tagged `proposed`; its weights do not enter the current scorer, configured role profiles, owner-defined role profiles, persisted score snapshots, ranking, or evaluation result. No legacy v1/v2/v3 result is reinterpreted. Historical category labels and scores remain governed by the rubric snapshot under which they were created.

## Proposed categories

| Category | Proposed weight | Source | Scope |
| --- | ---: | --- | --- |
| Project Portfolio | 20% | GitHub | Public repository/portfolio context; stars and popularity are not quality measures. |
| Technical Skills | 20% | GitHub | Technologies evidenced by public repository language metadata and separately assessed technical work. |
| Development Activity | 15% | GitHub | Commit history and activity patterns. Counts do not establish code quality or engineering competence. |
| Collaboration | 10% | GitHub | Pull requests opened, issues opened, and pull-request reviews submitted. Counts do not establish collaboration quality. |
| Current-Year Contributions | 10% | GitHub | Attributable contribution volume and its time distribution in the current UTC calendar year. |
| DSA & Problem-Solving | 25% | LeetCode | Actual LeetCode solved-by-difficulty and contest evidence, when available; GitHub activity is not a proxy. |

The weights total 100% but remain proposals. Changing or activating them requires explicit product/assessment-owner approval and the existing owner-weight configuration process. Existing five-weight role profiles are not padded, translated, or approved by this proposal.

## GitHub data actually requested

The backend-only GitHub adapter uses the [official REST API](https://docs.github.com/en/rest/users/users) for existing public profile and repository metadata:

- `GET /users/{username}` for the login, public repository count, followers, and following.
- `GET /users/{username}/repos?type=owner&sort=updated&per_page=50&page={n}` for at most two pages of public repository metadata. Private repositories are filtered.

When `GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN` is configured, it separately requests `POST https://api.github.com/graphql` for `User.contributionsCollection(from,to)`, `contributionCalendar.weeks.contributionDays`, `totalCommitContributions`, `totalPullRequestContributions`, `totalIssueContributions`, `totalPullRequestReviewContributions`, and `commitContributionsByRepository(maxRepositories:100)` with at most 100 daily commit-contribution nodes per repository. GitHub defines the collection end bound as inclusive and timestamps the profile contribution graph in UTC ([GraphQL Users reference](https://docs.github.com/en/graphql/reference/users), [contribution graph documentation](https://docs.github.com/en/account-and-profile/concepts/contributions-on-your-profile)). It does not fetch the issue/PR/review objects, contents, diffs, or language/skill data beyond existing public repository language metadata. A missing token leaves contribution history unavailable; REST profile sync can still succeed.

GitHub documents that private/internal contributions are included only with the optional `read:user` scope. The separate contribution token must be configured without that scope. DevRank does not introspect token scopes, so the scope requirement is an operator configuration assumption; a mis-scoped token could return private aggregate counts. Do not configure a token with `read:user` for this integration. Tokens remain server-side and must never be placed in `VITE_*` variables.

The GraphQL `user.login` must match the requested GitHub handle case-insensitively. A mismatch makes all contribution categories unavailable. This confirms only that the API returned the requested GitHub account; it does not verify the account holder is the candidate. Candidate/GitHub identity proof remains unavailable in this flow.

## Current-year window and deterministic descriptive normalization

The calendar year is selected in UTC. `periodStart` is January 1 at `00:00:00.000Z`; `periodEnd` is December 31 at `23:59:59.999Z`. The provider query and `observedThrough` stop at the capture instant (bounded to the selected year); future dates are not treated as zero activity. During an in-progress year these are year-to-date observations within the full calendar-year window.

Calendar days are filtered to the selected UTC year and no later than `observedThrough`. Duplicate dates are counted once; if duplicate values conflict, the maximum observed count is retained and the snapshot is marked `partial`. Calendar totals are the sum of the deduplicated daily calendar counts. A mismatch with the provider's calendar total, a missing day, invalid day, GraphQL partial error, or incomplete response marks the calendar `partial`. If no usable calendar days exist, the value is `unavailable` and no total is emitted. A complete all-zero calendar is distinguishable from missing data because its daily dates are present with zero counts.

To account for a partial current year, deterministic descriptive metrics are:

- `contributionsPerObservedWeek = calendar total / number of UTC Monday-start weeks intersecting January 1 through the observed UTC date`, rounded to two decimals.
- `activeWeekCoveragePercent = 100 × distinct weeks with at least one contribution / observed weeks`, rounded to two decimals.
- The daily and weekly distributions are retained for review. The current day can still be in progress; `observedThrough` identifies the capture bound.

These are pace/distribution descriptions, not calibrated 0–100 category scores. There are no approved thresholds, peer baselines, weights, or evidence-quality rules, so the application does not convert volume into a score. It must not be used alone to infer competence, code quality, effort, or hiring suitability.

## Preventing overlap and false attribution

- The calendar total is the one Current-Year Contributions volume measure. Commit, issue, pull-request, and review totals are separate type breakdowns and are never added to the calendar total.
- Development Activity uses `totalCommitContributions`, active commit dates, active commit weeks, and repository distribution. The activity window is the same UTC current-year interval. Duplicate repository/day records do not inflate active-day/week counts; conflicting or truncated history is marked partial.
- Collaboration uses the separate GraphQL totals for pull requests opened, issues opened, and reviews submitted. These are not combined into a second total.
- A contribution may appear in more than one descriptive category, but no cross-category aggregate is calculated. No signal is treated as independently verified candidate identity.
- The schema bounds commit detail to 100 repositories and 100 nodes per repository. Reaching the bound or seeing another page marks Development Activity `partial`; it is not represented as complete.

## Availability and failure behavior

Each category reports `available`, `partial`, or `unavailable` with sanitized reason codes. Rate limiting, timeout, provider/network failure, malformed/partial responses, missing history, mismatched login, duplicates, and truncation are not converted into zero. Optional GraphQL contribution failure does not discard a successful REST profile/repository snapshot. A failed database persistence operation still fails the sync and preserves previously saved evidence. The existing owner-scoped candidate checks, RLS, and append/snapshot behavior are unchanged; no database migration is required because this context is stored in the existing JSON evidence payload.

LeetCode remains separate: its verified adapter retrieves its profile and solved/contest endpoints and maps only returned statistics. Missing LeetCode values remain absent; GitHub activity cannot satisfy DSA & Problem-Solving.

## Approval and limitations

Before any activation, owners must approve the category definitions, proposed weights, evidence standards, scope/consent, normalization, identity verification, freshness, and handling of GitHub account changes. Live provider behavior and token permissions must be validated with an approved non-production setup. Until then, platform values appear only as unverified context and do not affect any numeric result.
