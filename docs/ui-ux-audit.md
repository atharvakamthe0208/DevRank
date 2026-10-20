# DevRank UI/UX Audit and Improvement Plan

## Audit scope and evidence

This is a source-led audit of the current working tree on `codex/evaluation-report-ui-cleanup`. I reviewed the router, shared shell, dashboard, candidates, platform sync, evaluation setup/results, AI analysis, insights, admin approval, authentication, and the associated page styles. I also opened the local app in a narrow browser viewport. The public login screen rendered; navigating to the protected dashboard redirected to login. I did not sign in or submit credentials, so recruiter and administrator screens below are assessed from source rather than claimed as browser-verified. No contrast analyzer, screen reader, or automated accessibility tool was run.

The audit preserves the current light palette, muted gray surfaces, dark green actions, and warm evidence notices. The recommendations focus on hierarchy, spacing, consistency, and progressive disclosure. They do not propose changing scoring, evidence meaning, access checks, or historical records.

## A. Executive summary

DevRank has a coherent visual foundation and a well-defined core workflow: add a candidate, save or sync public platform evidence, run an evaluation from saved snapshots, and inspect the result. Its strongest product choices are keeping candidate-reported and provider-fetched evidence separate, retaining historical scoring snapshots, distinguishing missing evidence from zero, and keeping AI analysis explanatory rather than score-authoritative.

The main usability cost is **information competing for attention**. Dashboard and Insights both surface overlapping counts and repeated evaluation evidence; candidate details combine profile metadata, sync controls, snapshots, and evaluation history; the evaluation result mixes scores, limitations, and AI analysis; and the Insights page combines draft indexes, rankings, and comparisons. The interface can feel more complex than the underlying tasks require.

### Five biggest usability problems

1. **Dashboard focus is split.** Four status cards, recent evaluations, a draft evidence-index disclosure, and recent candidates all compete for the first screen. The most actionable work is not explicitly distinguished from reference data.
2. **Insights combines three different jobs.** Draft indexes, comparable rankings, and manual comparison are peers in one long page, while some summary counts repeat the dashboard.
3. **Candidate profile is dense.** Profile identity, GitHub/LeetCode syncing, evidence snapshots, and evaluation history each matter, but are presented in a long vertical sequence with little prioritization.
4. **Evaluation results repeat interpretation.** Category explanations, evidence limitations, calculation explanation, decision-support notice, and an AI panel can repeat caveats or make the key result harder to scan. Raw evidence keys/JSON are difficult for nontechnical readers.
5. **Shared interaction styling is uneven.** Similar secondary actions use locally overridden styles, icon glyphs vary, and keyboard-focus styling is explicit for some screens but not consistently visible across the application.

### Five highest-impact improvements

1. Make the dashboard show the next useful action and a compact recent-evaluation list first; keep candidate management and draft indexes available below or on their dedicated pages.
2. Give Insights a clear sequence: role-scoped rankings first, comparison second, and draft evidence indexes in a clearly secondary disclosure or dedicated view.
3. Reorder candidate details around identity and current evaluation status, then place sync controls and source provenance in compact, clearly labeled platform sections.
4. Keep the evaluation result focused on overall status and six category results; collapse technical evidence details and avoid repeating the same limitation in multiple adjacent blocks.
5. Standardize button, focus, status, and table treatments using the existing design tokens and theme; validate at keyboard-only and narrow widths.

## B. Page inventory

Density labels describe the amount of information and actions on the page, not whether the page is visually attractive.

| Route | Page and primary purpose | Density | Main usability issue | Specific improvement |
|---|---|---:|---|---|
| `/` | Redirect to recruiter overview | N/A | Correctly forwards users, but destination depends on authentication state. | Keep the redirect; ensure loading and redirect states remain brief and announced. |
| `/login` | Recruiter sign-in | Medium | Form is clear; the split-screen product showcase and broad intro copy take space away from sign-in, especially on small screens. | Keep email, password, reset, submit, and account-creation links prominent; keep decorative/product content secondary below the form on narrow screens. |
| `/signup` | Recruiter account creation | High | Four fields, confirmation/approval policy, and an animated product showcase compete. The showcase advances automatically. | Keep signup fields and approval expectations first; reduce showcase prominence and ensure motion remains off under reduced-motion preferences (source already checks this). Do not obscure form errors/status. |
| `/forgot-password` | Request a password-reset email | Low | The shared auth layout repeats marketing copy for a narrow one-field task. | Keep email, neutral response, and return link; reduce the showcase on this route. Preserve account-enumeration-safe confirmation wording. |
| `/reset-password` | Set a replacement password or recover an expired link | Medium | Multiple states (restoring, invalid, complete, form) share one layout; recovery instructions and form can be separated more clearly. | Make the current state the page heading and primary message; preserve password rules, confirmation, and secure-session behavior. |
| `/auth/callback` | Complete email confirmation/session restoration | Low | A technical transition page can leave users unsure whether to wait or return to sign-in. | Keep the concise status, show a retry/return action only when appropriate, and retain safe expired-link guidance. |
| `/access-pending` | Explain unconfirmed, pending, rejected, or suspended recruiter access | Low | Access states share similar copy and styling; user must distinguish whether to wait, confirm email, or contact an administrator. | Keep the state-specific next step as the strongest element; preserve privacy and the sign-out action. |
| `/admin/recruiters` | Review recruiter access applications | Medium | Status filter, account table, and approve/reject controls are straightforward, but decisions use native confirmation prompts and the list has no visible pagination. | Keep pending as the default; show decision outcome and progress consistently, use a contextual confirmation for approval/rejection if the list becomes long, and provide pagination if the dataset can grow. |
| `/dashboard` | Understand workload and continue work | High | Four metrics, recent evaluations, draft indices, and recent candidates all compete; candidate/evaluation information overlaps with dedicated pages. | Put actionable evaluation statuses and recent runs first; reduce or move repeated candidate metadata and keep draft indices collapsed/secondary. |
| `/dashboard/candidates` | Find, add, open, or remove candidates | Medium | Table is operationally useful; at narrow widths it has a 720px minimum width and therefore requires horizontal scrolling. Delete uses a native confirm. | Preserve columns and pagination; use a compact mobile row/card or clearly signposted horizontal scroll. Make the deletion confirmation explain that saved candidate data is deleted. |
| `/candidates/new` | Create a candidate and optionally enter GitHub/LeetCode names | Medium | Name/email and two platform identifiers are grouped well; optionality and the distinction between saving a name and syncing evidence can be clearer. | Keep required name and optional contact/profile fields; add concise helper text distinguishing profile association from fetching a snapshot. Retain inline validation and post-save feedback. |
| `/candidates/:id` | Review candidate profile, sync evidence, and inspect history | High | Profile, platform forms/snapshots, rubric context, and evaluation history create a long page and mix task-critical data with provenance details. | Start with identity, latest evaluation status, and primary actions; group each provider’s sync and latest snapshot together; collapse raw or historical detail while retaining timestamps/provenance. |
| `/candidates/:id/evaluate` | Start an evaluation from a candidate profile and select a saved role | Medium | This is a second evaluation entry point beside `/evaluations`; role profile validation and weight previews add setup detail. | Keep the candidate preselected and role choices clear; use official human-readable category names; link back to the candidate and make invalid/inactive role state actionable. Clarify how this flow differs from the general evaluation page. |
| `/evaluations` | Choose a candidate and role, run the active v4 evaluation, review the result | High after run | Before run, the weight paragraph is dense; after run, six categories, limitations, disclaimer, and AI analysis appear together. | Keep candidate, role, active-version marker, and run action first. After run, put overall status and category results first; collapse detailed limitations/evidence and keep AI clearly separate. |
| `/evaluations/:evaluationId` | View a saved evaluation or a historical result | High | Current and legacy reports have different category schemas; current details include per-category explanations, saved platform evidence, limitations, and notices. | Make version/status visible, preserve original historical categories, humanize evidence field names, and collapse saved raw snapshot details. Keep missing evidence visibly distinct from low scores. |
| `/evaluations/:evaluationId/analysis` | Read detailed evidence-grounded AI explanation | High | Detailed report repeats the deterministic result and may regenerate analysis when opened directly or reloaded because the analysis response is passed through navigation state. | Keep the score summary compact and clearly authoritative; make summary, strengths, gaps, and recommendations scannable; disclose supporting references on demand. Consider an explicit generation/loading state and avoid implying persisted analysis if it is not stored. |
| `*` | Unknown route recovery | Low | Fallback is concise, but source uses a plain anchor to overview rather than a router link. | Keep the clear “Page not found” message and route through normal app navigation so client transitions remain consistent. |

## C. Information reduction matrix

| Page | Keep visible | Consolidate or simplify | Move to details | Remove |
|---|---|---|---|---|
| Login and signup | Form, errors, primary action, recruiter-only and approval requirements | Repeated intro/marketing copy | Product showcase and decorative previews | Duplicate account links where the same link appears twice on one screen |
| Recovery and access states | Current state, next step, safe confirmation, return/sign-out action | Shared auth shell copy | Decorative showcase | Generic marketing copy unrelated to recovery/access |
| Admin applications | Pending state, recruiter, registration date, status, decision controls | Repeated status labels and notices | Long audit detail if later exposed | Redundant profile information not used for approval |
| Dashboard | Recent evaluation state/score, clear action, concise counts | Candidate totals duplicated with candidate list; same state in card and row | Draft indexes, older activity, source details | Decorative or repeated mini-statistics without decisions |
| Candidate list | Candidate name, linked GitHub/LeetCode, added date, open/delete, total and pagination | “View” icon and row click if they lead to same place (retain at least one accessible action) | Email on small screens if not required for identification | Empty platform placeholders where a compact dash suffices |
| Add candidate | Name, optional email, GitHub and LeetCode fields, validation | Developer profile section heading and optional note | Guidance on provider sync after creation | HackerRank or unrelated provider references (not present in current add form) |
| Candidate profile | Identity, latest evaluation state, GitHub/LeetCode association, sync action | Repeated source headings, save/sync explanatory copy | Snapshot timestamps, provenance, full repository/evidence lists, older evaluations | Any duplicate rubric/report block that repeats the evaluation result |
| Candidate evaluation setup | Candidate, role, active rubric, run action | Long weight list into a compact readable summary | Per-category formula detail | Implementation identifiers such as raw enum keys |
| Evaluation result | Overall result or insufficient-evidence state, six category names and scores | Repeated caveats across category, limitations, and footer copy | Evidence refs, raw provider fields, timestamps, full AI report | Duplicate active/proposed report rendering |
| AI analysis | Short summary, strengths, evidence gaps, score-integrity statement | Repeated deterministic result details | Full references, recommendations, long reasoning | Any AI-generated score or repeated category score cards with no added context |
| Insights | Role selector, ranked list and compatibility context, compare action | Counts already visible on overview | Draft indexes, snapshot-level raw values, comparison details until requested | Decorative totals or repeated complete report cards before the ranking task |

## D. Prioritized improvement backlog

No confirmed P0 blocker was found in source review. Items below are usability/accessibility improvements; authentication, ownership, evidence provenance, and scoring integrity must remain unchanged.

| Priority | Page/component | Current problem | Proposed change and user benefit | Scope | Dependencies or risks | Acceptance criteria |
|---|---|---|---|---|---|---|
| P1 | `DashboardPage.tsx`, dashboard styles | Status metrics, recent runs, draft indexes, and recent candidates compete for attention. | Lead with runs needing action and recent outcomes; move repeated counts and draft indices down or keep them collapsed. Helps recruiters decide what to do next quickly. | Medium | Do not invent new metrics; use only existing dashboard response fields. | At a glance, user can identify recent incomplete/failed/insufficient runs and start evaluation; draft indexes remain available but are not mistaken for active scores. |
| P1 | `InsightsPage.tsx`, `insights-page.css` | Draft report values, ranking, and comparison share one long screen; counts duplicate the overview. | Put rankings and role context first, comparison second, draft evidence indexes in a clearly secondary disclosure. Reduces scanning and separates ranking from evidence-volume indexes. | Medium | Preserve compatibility checks, incomplete exclusions, and distinct draft status. | User can find the active ranking without scrolling through draft reports; no draft value enters ranking. |
| P1 | `CandidateDetailsPage.tsx`, `CandidatePlatformDataPanel.tsx` | Long sequence of identity, provider forms, snapshots, rubric/evidence detail, and history. | Establish profile summary first; group sync and latest saved snapshot per provider; disclose older/raw detail progressively. | Medium | Preserve live sync, provider provenance, candidate-reported separation, and saved snapshots. | On initial view, identity and primary actions are visible; saved status and sync errors remain clear; historical data is still reachable. |
| P1 | `EvaluationPage.tsx`, `EvaluationRunResult` | Weight text is dense; generated result is followed by several explanation/caveat blocks and a separate AI workflow. | Compact the setup copy; prioritize overall state and six categories; group technical evidence/limitations in details; keep AI visibly explanatory. | Medium | Keep all six categories, no-score states, deterministic snapshot integrity, and AI separation. | After run, score status and categories are immediately scannable; no missing value is represented as zero; AI cannot be confused with the saved score. |
| P1 | `CandidateListPage.tsx` | Candidate table is 720px wide at mobile breakpoint; destructive confirmation is a native prompt with no contextual summary. | Provide a mobile-friendly row layout or accessible scroll treatment; use a product-styled confirmation that names the candidate and explains deletion scope. | Medium | Deletion is permanent; confirmation must not become easier to trigger accidentally. Preserve authorization and API behavior. | At 320–700px, all actions can be reached without clipped controls; keyboard users can review and cancel deletion; success/error is announced. |
| P2 | `EvaluationResults.tsx`, platform evidence presentation | Raw JSON values and snake-case field names make source evidence hard to understand; extensive caveats may repeat. | Humanize labels and use a disclosure for snapshot metadata/raw structures; retain source, time, availability, and category mapping. | Small | Do not hide evidence needed to explain a score or alter the stored snapshot. | User-facing labels are readable; provenance and missing/partial states remain visible; no raw provider request payload is exposed. |
| P2 | `CandidateCreate` and `EvaluationCreatePage.tsx` | Two evaluation entry points are present; user may not know which one to start from. Role weight preview uses transformed keys rather than guaranteed official names. | Make the entry-point difference explicit and share official category labels between flows. | Small | Keep role validation and candidate-specific preselection. | Both routes lead to the expected candidate/role; categories use the canonical display names; invalid roles remain understandable. |
| P2 | Shared buttons/focus styles across `styles.css`, feature CSS | Global and local secondary-button overrides vary; focus-visible rules are concentrated in selected pages. | Consolidate primary/secondary/link-button variants and define consistent visible keyboard focus using existing green palette. | Medium | Check contrast and avoid changing established color grading. | Every interactive element has a visible focus indicator; similarly purposed buttons share height, padding, and disabled state. |
| P2 | `AppShell.tsx` and navigation | Sidebar uses varied Unicode glyphs; breadcrumb title condition ordering includes an unreachable second evaluations condition. | Use a consistent icon treatment and simplify route-to-title mapping. | Small | Keep labels visible and screen-reader names unchanged. | Each route shows the expected breadcrumb and active nav state; no icon is the sole accessible name. |
| P2 | Auth route layout and `SignupFeatureShowcase.tsx` | Signup showcase auto-rotates and recovery pages inherit broad promotional content. | Keep decorative content secondary on narrow screens and simplify recovery states; provide a pause/disable interaction if animation is not sufficiently brief under accessibility review. | Small/medium | Reduced-motion handling already exists; preserve registration and approval requirements. | Form remains primary at 320px width; reduced-motion users see no automatic transition; status/errors remain perceivable. |
| P3 | Empty/error/loading states | Similar retry and status messages use different component treatments across pages. | Reuse a compact state pattern with consistent icon, message, and retry action. | Small | Preserve specific actionable error messages and status semantics. | Loading, empty, and failure are visually distinguishable and use `role=status`/`role=alert` appropriately. |
| P3 | Auth/admin decorative elements | Decorative previews and repeated visual flourishes use space on task-focused screens. | Reduce decoration where it competes with the form or decision, retaining the existing brand palette. | Small | No rebrand or color shift. | Primary task is visually dominant at desktop and narrow widths; decorative content remains non-interactive and ignored by assistive technology. |

## E. Recommended design-system refinements

- **Keep the current palette.** Continue using the existing ink, muted, line, green, warm-neutral, and white tokens in `apps/web/src/styles.css`; align feature-specific fallbacks with those variables rather than introducing a second palette.
- **Set a small spacing scale.** Use a shared scale for page gaps, panel padding, form spacing, and table rows. The current feature styles range from compact 9–13px text and 14–26px padding; establish a few predictable values and use responsive reductions only where needed.
- **Clarify type roles.** Use one page-title size range, one section heading level, and a stable body/helper size. Avoid small helper text for essential state. Preserve readable line height for long evidence and policy notices.
- **Standardize actions.** Keep one primary action per page region; use a common secondary action and low-emphasis text link. Keep minimum interactive hit areas comfortable at touch sizes and avoid per-page overrides that cause wrap/clipping.
- **Standardize status patterns.** Pair status text with color and, where needed, an icon; never rely on the green/yellow/red dot alone. Use consistent success/error/loading/empty spacing and announcement behavior.
- **Use consistent icons.** Replace ad-hoc Unicode marks when they have inconsistent visual weight, but retain text labels. Decorative glyphs should be hidden from assistive technology when the adjacent text provides the name.
- **Use progressive disclosure for technical detail.** Keep evidence source, timestamp, availability, and mapping discoverable. Put raw normalized values, long evidence references, and historical details behind native details/disclosure controls when not needed immediately.
- **Preserve responsive containment.** Tables should have either deliberate horizontal scroll with a visible affordance or a compact mobile layout; every page should avoid accidental horizontal overflow at the 320px minimum width.
- **Audit focus and contrast centrally.** Add consistent `:focus-visible` treatment to links, buttons, selects, checkboxes, summaries, and inputs. Verify muted text and subtle status backgrounds against contrast requirements before any color adjustment.

## F. Proposed dashboard layout

1. **Header:** “Overview,” concise purpose, one clear primary action: Add candidate. If evaluation work is the frequent next action, retain a secondary “Run evaluation” action near recent activity.
2. **Needs-attention strip:** Use only existing statuses/counts and link directly to the relevant candidate/evaluation. If the API does not provide a reliable actionable subset, do not invent one; keep the current status summary instead.
3. **Recent evaluations:** Show up to five rows with candidate, role/version, status, score or “Insufficient evidence,” date, and one open action. Avoid repeating both “Open” and a clickable row unless keyboard/semantics require a separate named control.
4. **Recently added candidates:** Keep a compact list with name, linked provider badges, and open action. Omit email/date here if the candidate table already owns that detail.
5. **Draft GitHub + LeetCode indexes:** Keep collapsed and clearly marked as separate evidence indexes, not active scores/rankings. Preserve snapshot date and the formula/cap limitation inside the expanded view.
6. **Footer note:** One concise statement that displayed scores come from saved deterministic evaluations and missing evidence is not zero.

Keep the dashboard to a short first-screen summary. Put full candidate management on Candidates and ranking/comparison on Insights.

## G. Proposed AI analysis layout

The detailed AI report route already exists at `/evaluations/:evaluationId/analysis`, so a new report page is not needed.

1. **Compact saved-result header:** candidate/role, scoring version, saved score or insufficient-evidence status, and a link back to the evaluation.
2. **Short summary:** one paragraph, with supporting references available directly below or in a disclosure.
3. **Three scan-friendly groups:** strengths, evidence gaps, and recommendations. Each observation should show its supporting evidence reference when available; an empty state should say no supported finding was returned.
4. **Expandable evidence:** full references and longer explanation behind native disclosures. Keep provider, provenance, snapshot date, and missing/partial caveats intact.
5. **Persistent integrity note:** state once near the top that AI is explanatory and does not calculate or alter scores. Avoid repeating the full saved category cards when the user can return to the evaluation report.

The current route obtains analysis from navigation state when available and may request it again after direct navigation or refresh. The UI should communicate generation/loading and availability truthfully; any caching or persistence change would need a separate product/data decision.

## H. Responsive and accessibility findings

### Confirmed from source

- The shared shell has a fixed 248px sidebar and responsive mobile navigation styles elsewhere in `styles.css`; the dashboard has explicit 950px and 700px breakpoints, and candidate platform/evaluation/AI report styles have 600–760px breakpoints.
- Candidate management uses a `min-width: 720px` table at widths below 700px, so horizontal scrolling is expected rather than a narrow reflow.
- The dashboard honors `prefers-reduced-motion`; signup’s rotating showcase also checks that preference.
- Candidate row actions, page links, form labels, progress labels, status/error roles, and many table headers have accessible names or semantics. Several route-specific focus styles exist, but they are not a unified rule across all feature CSS.
- The add-candidate deletion path uses `window.confirm`; administrator approval/rejection also uses native confirmation. These prompts are functional but offer limited context and styling control.
- The candidate table has a screen-reader-only actions heading and labels its row actions. However, click targets and action reachability still need keyboard/touch verification in a running authenticated session.
- Some evidence rendering uses `JSON.stringify` for object values and direct normalized field names; that is legible to developers but not an accessible explanation for most recruiter users.

### Browser observation

The app redirected from `/dashboard` to `/login` while unauthenticated. A narrow viewport login page rendered with the form first and the product showcase continuing below it. I did not interact with the sign-in form. Protected views could not be visually audited without an approved recruiter session. No desktop live view, keyboard-only pass, screen reader, touch-target measurement, or color-contrast measurement was completed.

### Verification recommendations

- Test 320px, 375px, 768px, and desktop widths for accidental page overflow and clipped buttons.
- Navigate each page using only Tab/Shift+Tab/Enter/Space; confirm visible focus, correct order, and usable native disclosures.
- Confirm form errors are associated with their fields, and loading/success/error changes are announced without moving focus unexpectedly.
- Verify status is conveyed with text as well as color, and progress elements have accessible labels.
- Check contrast for muted helper text, status badges, and green-on-pale-green actions using an automated contrast tool.
- Check touch target sizes for compact row and icon actions, especially pagination, external links, and delete.

## I. Implementation roadmap

1. **Phase 1 — High-impact hierarchy (small review):** simplify dashboard order; make Insights ranking-first; use one shared category label set; remove repeated explanatory copy while preserving one complete integrity note.
2. **Phase 2 — Candidate workflow (small/medium):** establish profile summary hierarchy; group provider sync and latest snapshot; improve mobile candidate table; improve contextual delete confirmation without changing its API/security behavior.
3. **Phase 3 — Evaluation report clarity (medium):** consolidate caveats, humanize evidence field labels, progressively disclose raw snapshot details, and keep current/legacy result schemas visibly distinct.
4. **Phase 4 — Shared interaction patterns (medium):** align button variants, focus indicators, status, empty, loading, error, and navigation icon treatment with existing design tokens.
5. **Phase 5 — Auth and admin refinement (small):** simplify recovery/access screens, make signup showcase secondary, and align admin decision progress and confirmation.
6. **Phase 6 — Validation:** conduct desktop/mobile browser review, keyboard and screen-reader checks, contrast checks, and run relevant existing UI tests after implementation. Confirm no scoring, provenance, authorization, or historical snapshot behavior changed.

Each phase should be a reviewable PR with screenshots for desktop and narrow widths. Keep any scoring or database changes out of these UI-only phases.

## J. Post-implementation verification checklist

- [ ] `/`, sign-in, signup, forgot/reset password, confirmation callback, pending/rejected access, and expired-link states.
- [ ] Recruiter/admin route guards and unauthenticated redirect behavior.
- [ ] Dashboard loading, failure/retry, empty state, recent completed and incomplete runs, and draft-index disclosure.
- [ ] Candidate list with 0, 1, and many records; pagination; missing GitHub/LeetCode values; mobile action reachability.
- [ ] Candidate creation validation, optional fields, successful navigation, and error recovery.
- [ ] Candidate profile with and without saved GitHub/LeetCode evidence, sync success/failure, provenance, and evaluation history.
- [ ] Candidate-specific evaluation setup with valid, inactive, and unavailable roles.
- [ ] General evaluation with complete evidence, partial evidence, and insufficient evidence; verify no missing field becomes zero.
- [ ] Current v4 and historical results; confirm historical categories and scores remain unchanged.
- [ ] AI analysis success, empty/limited response, rate limit, direct navigation, refresh, and return-to-evaluation flow.
- [ ] Insights ranking by role, exclusions, no-ranked-results state, selecting 2–5 comparable evaluations, incompatible selection, and comparison failure.
- [ ] Candidate deletion confirmation, cancel, success, API failure, list removal, and preservation of unrelated candidates.
- [ ] Admin pending/approved/rejected filters, approve/reject confirmation, progress, failure, and audit-log notice.
- [ ] Keyboard-only navigation, visible focus, screen-reader names and announcements, reduced motion, color contrast, and 320px/375px/768px/desktop widths.

