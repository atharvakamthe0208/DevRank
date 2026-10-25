# Active GitHub + LeetCode rubric (v4)

This rubric is active for new evaluations under schema version `4.0.0` and scoring version `4.0.1`, following explicit product direction. The earlier contract identifier `github_leetcode_proposal_v1` remains accepted only as historical evidence-mapping metadata. The active rubric identifier is `github_leetcode_v4`. Weights are fixed in `config/role-weights.json`; old owner-defined profiles are not translated automatically. Historical evaluation snapshots retain their original scoring versions and are read-only.

## Categories and weights

| Category | Weight | Source | Scope |
| --- | ---: | --- | --- |
| Project Portfolio | 20% | GitHub | Public repository/portfolio context; repository count is a quantity proxy and stars/popularity are not quality. |
| Technical Skills | 20% | GitHub | Distinct languages in saved repository metadata; breadth is not proficiency. |
| Development Activity | 15% | GitHub | Attributable commit history and activity patterns; counts do not establish code quality. |
| Collaboration | 10% | GitHub | Attributable pull requests opened, issues opened, and reviews submitted; counts do not establish collaboration quality. |
| Current-Year Contributions | 10% | GitHub | Contribution volume and distribution during the current UTC calendar year. |
| DSA & Problem-Solving | 25% | LeetCode | Solved-by-difficulty; contest fields are context only. GitHub activity is not a DSA signal. |

## GitHub evidence actually requested

The backend-only GitHub adapter uses the official REST API for the public profile and repositories:

- `GET /users/{username}` for login, public repository count, followers, and following.
- `GET /users/{username}/repos?type=owner&sort=updated&per_page=50&page={n}` for at most two pages of public repository metadata. Private repositories are filtered.

When `GITHUB_PUBLIC_CONTRIBUTIONS_TOKEN` is configured, the backend separately requests `POST https://api.github.com/graphql` for `User.contributionsCollection(from,to)`: calendar daily counts, total commit/PR/issue/review contribution counts, and bounded `commitContributionsByRepository(maxRepositories:100)` data. It does not fetch issue/PR/review objects, code contents, or diffs. Language breadth is limited to the repository metadata already returned. Tokens stay server-side and must never be placed in `VITE_*` variables. A token without the optional `read:user` scope is required; the API does not introspect scopes.

The GraphQL `user.login` must match the requested account, case-insensitively. This is provider attribution only, not proof that the account belongs to the candidate. Missing token/history leaves those categories unavailable. Partial responses and truncation remain partial.

## Calendar window and overlap

The current year is selected in UTC. The calendar window is January 1 `00:00:00.000Z` through December 31 `23:59:59.999Z`; observations stop at the capture instant during an in-progress year. Daily contributions are de-duplicated by date; conflicting duplicates, missing dates, provider total mismatch, GraphQL partial errors, or incomplete responses mark data partial. No usable dates means unavailable, not zero.

`contributionsPerObservedWeek` is the calendar total divided by UTC Monday-start weeks intersecting January 1 through `observedThrough`. `activeWeekCoveragePercent` is the percentage of those observed weeks with at least one contribution. The final v4 Current-Year Contributions index uses active-week coverage; the calendar total and type breakdowns are shown as context only. Development Activity separately uses attributable commit volume and patterns. Calendar totals and contribution-type totals overlap and are never added together. GitHub counts do not establish code quality or competence.

## Final deterministic indexes

The complete formulas, evidence requirements, missing-data behavior, weighted-total rule, and the DSA cap are documented in [active scoring rules](scoring-rules.md) and [the final report specification](proposed-rubric-report.md). These indexes describe source evidence volume/breadth; they are not calibrated measures of engineering competence, code quality, identity, or hiring suitability. Incomplete required category evidence remains unscored and blocks the overall weighted result. A candidate with no LeetCode username and no saved LeetCode snapshot receives an explicitly marked policy-defined DSA zero. Snapshot dates and evidence coverage should be considered before comparing results.

The DSA formula uses easy=1, medium=2, hard=3 and caps at 300 weighted solved problems (index 100). The cap is uncalibrated and requires future review. If only total solved is returned, the total is used as a labeled fallback; contest values are context only.

## Persistence and compatibility

Each evaluation stores its own immutable GitHub/LeetCode evidence snapshot. Report rendering uses only that saved snapshot; a later platform sync cannot rewrite a saved evaluation. Candidate-reported LeetCode data remains separately identified as `candidate_provided`; `alfa_leetcode_api` provider data is preferred for the DSA index when available. Failed syncs do not replace previously saved evidence. The current database schema stores these values in existing JSON snapshot fields, so this activation does not add a migration.

New evaluations persist scoring version `4.0.1`. Historical v4.0.0 and v1/v2/v3 categories and scores are shown unchanged. Existing custom role profiles with old category keys require their owner to explicitly reconfigure all six v4 weights before creating a new evaluation. No automatic profile conversion or weight inference occurs. Production readiness is still blocked on the separate live catalog/migration-ledger reconciliation, backup/restore verification, and approved deployment plan.
