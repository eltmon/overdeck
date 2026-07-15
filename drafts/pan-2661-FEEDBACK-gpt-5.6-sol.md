# GPT-5.6 feedback on drafts/pan-2661.md

> Model: gpt-5.6-sol via codex-cli 0.144.4 (read-only) · 2026-07-15 · requested by the operator; feedback only, no changes applied by the reviewer.

## Verdict

Needs revision before implementation. The grouping direction is sound, but the PRD’s binding contract contradicts the current source and its own mockup on action count, `reviewTest` retirement, behavior preservation, tooltips, and Deep Wipe semantics. An implementing agent could produce a plausible but behavior-changing patch while believing it satisfies D-7.

## Reference-check findings

- **PRD `pan-2661.md:4` — partly wrong.** The mockup has the real 11-phase primary map (`issue-actions-grouped-pan-2661.html:220-226`), but its predicates are not “re-implemented verbatim.” `hasReviewFailure` only checks blocked/failed review (`:262`), while production also checks failed test, merge, inspection, UAT, and verification states (`pipeline-state.ts:52-65`). `canInspectTask` omits `selectedTaskId` (`mockup:252`; production `issueActions.ts:143`), and `hasPrTarget` omits `prUrl` and `workspace.mrUrl` (`mockup:265`; production `issueActions.ts:181`). The appendix can drift from real gating despite claiming it cannot.

- **PRD `:5` — source state supports the related additions.** `resetToPlanned` and `restartAgent` exist at `issueActions.ts:246,261`. The files reviewed do not establish their PAN-2660/PAN-2556 provenance.

- **PRD `:9` — verified.** `ISSUE_ACTIONS` contains 44 entries at `issueActions.ts:218-263`, with the stated fields defined at `:96-105`. The kind and group unions match `:65-76`.

- **PRD `:10` — mostly verified.** The gates occupy `issueActions.ts:137-189`; the cited `:137-195` range also includes phase-primary plumbing. Preserving them is a proposed constraint, not current behavior that source can verify.

- **PRD `:11` — verified.** There are 11 `PipelinePhase` values (`issueActions.ts:6-17`), the phase map is at `:193-205`, and derivation is at `:277-309`.

- **PRD `:12` — wrong path and incomplete routing citation.** The real hook is `components/IssueActionMenu/useIssueActions.ts`, not `lib/useIssueActions.ts`. Layout ordering is correctly cited at its `:377-388`; reasons are `:142-195`; confirm copy is `:215-241`. `:197-205` merely declares dialog keys; actual dialog routing occurs at `:357-359`, with rendering in `IssueActionMenu.tsx:206-261`.

- **PRD `:13` — verified.** `FeatureContextMenu` flattens primary, secondary, and overflow at `FeatureItem.tsx:711-714`, renders one “Issue actions” list at `:730-732`, and appends the three extras at `:734-755`.

- **PRD `:14` — verified.** Cockpit group metadata is local at `IssueMissionControl.tsx:86-108`, consumed by `IssueActionMegaMenu` at `:174-245`, and mounted at `:770`.

- **PRD `:15` — matches the mockup, not production.** The disclosure is implemented only in the mockup at `issue-actions-grouped-pan-2661.html:350-361`.

- **PRD `:19` — direction is source-consistent.** Moving `GROUP_ORDER` and `GROUP_LABELS` would remove the cockpit-local duplication. Today, however, `preserved` does render because it appears in `GROUP_ORDER` (`IssueMissionControl.tsx:98-108`) and contains `reviewTest` (`issueActions.ts:262`).

- **PRD `:20` — wrong count.** There are 44 entries before retirement, but the binding appendix supplies descriptions for only 43 actions (`mockup:278-322`) and adds `reviewTest` as a description-less retirement row (`:372`). After D-6, the registry would contain 43 entries. “Descriptions for all 44” and “delete `reviewTest`” cannot both be acceptance criteria.

- **PRD `:20,42` — tooltip behavior is underspecified and conflicts with “cockpit renders identically.”** Current cockpit buttons use disabled reason or label as `title` (`IssueMissionControl.tsx:219-234`). Replacing enabled-action titles with descriptions changes cockpit presentation. Disabled descriptions also compete with the required disabled-reason tooltip.

- **PRD `:21` — structure matches the mockup, but duplicates phase-primary actions.** The mockup renders enabled primary actions at `:344-347`, then renders the same actions again in their registry groups at `:356-357`. The PRD never says whether duplication is intentional. A set-equality parity test will not detect duplicate DOM entries.

- **PRD `:22` — duplicate UI is verified; behavior equivalence is not.** Registry `wipe` uses `/api/issues/:id/deep-wipe` (`issueActions.ts:242`) and typed confirmation (`useIssueActions.ts:346-353`). The hardcoded Deep Wipe uses `window.confirm` (`FeatureItem.tsx:716-724`) and calls a prop whose real handler sends `{deleteWorkspace: true}` (`CommandDeck/index.tsx:959-965`). Registry invocation sends `{}` because `wipe` has no `bodyForAction` case (`useIssueActions.ts:118-139,303-310`). Deleting the hardcoded path therefore changes confirmation and request payload unless endpoint defaults are explicitly verified.

- **PRD `:23` — only partly represented by the binding mockup.** Explain rendering exists at `mockup:71-74,334-342`, but persistence and the `overdeck.issueActions.explain` key are absent. The mockup resets Explain on reload.

- **PRD `:24` — retirement rationale is wrong and migration scope is incomplete.** `reviewTest` and `requestReview` share an endpoint, but their gates differ: `hasWorkspace` versus `canRequestReview` (`issueActions.ts:169,227,262`). Their declared kinds also differ. Repointing changes availability, so this is not behavior-neutral. Live references exist in `spotlight.ts:47-53` and `ReviewVerificationCard.tsx:102-119`, plus tests such as `issueActions.test.ts:153`, `issueActions.no-actions-lost.test.ts:18-21,61-64`, `action-parity.test.ts:7-9`, and `IssueDrawer.test.tsx:764,787`.

- **PRD `:25` — contradicted by D-4 and D-6.** Deep Wipe loses its existing confirm/payload path, and `reviewTest` consumers acquire `requestReview`’s stricter gate. “No behavior changes” and “confirm flows untouched” are false as currently specified. The `IssueActionDialogHost` mount itself is correctly identified at `FeatureItem.tsx:757`.

- **PRD `:29-32` — implementable after clarifying counts and tooltip ownership.** The registry and cockpit changes have clear source locations. “This session” remains surface-local because the current non-issue registry models those actions separately at `issueActions.ts:107-126`.

- **PRD `:33` — incompatible with the current context-menu primitives without extra design.** Disabled Radix items use `pointer-events-none` (`ContextMenu.tsx:20-37,40-57`), so a disabled item cannot reliably receive hover for a reason tooltip. FR-5 must require a wrapper, accessible description, or primitive change; passing `title` to the current wrappers is also impossible because they do not accept it.

- **PRD `:34` — retirement needs an explicit migration table.** “Re-point any code path” is too loose given the direct consumers above, especially `ReviewVerificationCard`, where `reviewTest` and `restartReview` are presented together (`ReviewVerificationCard.tsx:115-119`).

- **PRD `:35,45` — parity scope is ambiguous and duplicates an existing test name/concept.** An existing `issueActions.parity.test.tsx` already checks CLI coverage and registry rendering (`:140-213`). The new test should extend or clearly distinguish itself. It must assert multiplicity, not merely set equality, if duplicated phase-primary rows are forbidden.

- **PRD `:37` — styling direction is reasonable, but the mockup is not faithful.** Production uses DM Sans (`index.css:137`); the mockup uses system sans (`mockup:42-44`). The mockup also uses `--destructive-foreground` (`:70,80`), while NFR-1 says destruction must use only `--destructive`.

- **PRD `:38` — arrow navigation is supplied for normal items by Radix, but the custom Danger row is unresolved.** The mockup inserts `role="button"` inside a `role="menu"` (`mockup:173,350-361`). That is not a Radix menu item and may sit outside roving focus. FR-3/NFR-2 need explicit focus and ARIA behavior after expansion/collapse.

- **PRD `:42-44` — file work is incomplete for D-6.** The listed registry, grouped-menu, and rail files omit the production `reviewTest` consumers and parity/snapshot tests cited above.

- **PRD `:46` — conflates two different rail menus.** PAN-2499 inventories the per-agent `SessionNode context menu` (`three-issue-views-naming.html:343-362`), while PAN-2661 changes the issue-row `FeatureContextMenu` (`FeatureItem.tsx:702-760`). Updating the SessionNode inventory line would not record this change.

- **PRD `:50-54` — acceptance criteria inherit the contradictions.** AC-1 says the cockpit renders unchanged despite new tooltips; AC-4 cannot catch duplicate phase entries using set equality; AC-5 labels itself “WI-8” although only five work items exist.

## Gaps an implementing agent could misread

- Decide whether phase-primary actions appear twice. The mockup says yes by implementation, while “one wipe entry,” parity language, and scan-reduction goals suggest unique actions.

- Replace “44 descriptions” with “43 retained actions,” or retain `reviewTest` long enough to give all 44 descriptions. State whether `preserved` remains in the type union after retirement.

- Specify exact tooltip precedence:

  - Enabled: description?
  - Disabled: reason, description, or both?
  - Explain on: inline description plus reason via accessible help?
  - Keyboard/touch: how is the same information exposed?

- Define the Deep Wipe contract: endpoint, body, post-success selection cleanup, confirmation text, and whether typed confirmation intentionally replaces `window.confirm`. Current paths differ at `FeatureItem.tsx:716-724`, `CommandDeck/index.tsx:959-970`, and `useIssueActions.ts:346-363`.

- Give an explicit `reviewTest` migration list. `ReviewVerificationCard` likely needs product judgment: replacing it with `requestReview` may remove its test-failure recovery affordance because `requestReview` is disabled when review status exists.

- Clarify whether counts include phase duplicates, session extras, hidden `preserved`, and collapsed Danger items. The mockup counts only the 43 retained registry actions (`mockup:334-342`).

- Clarify menu width, maximum height, and scrolling. Forty-three registry actions plus repeated primaries, descriptions, and extras can exceed viewport height; the existing `ContextMenuContent` has `overflow-hidden` and no max height (`ContextMenu.tsx:8-16`).

- Specify Explain-state initialization safely for SSR/tests and malformed or unavailable `localStorage`.

- Reconcile “shared component” with “no new abstractions beyond `GroupedIssueActionMenu`.” A reusable body suitable for both a Radix context menu and PAN-1610’s cockpit popover will probably need a content-level boundary.

## UX concerns for operators brand-new to Overdeck

- Explain is off by default, so the stated newcomer aid is hidden precisely for first-time operators. Defaulting it on for first use, then remembering the choice, better matches the goal.

- Several “plain-language” descriptions still assume Overdeck knowledge: “stack unhealthy” (`mockup:302`), “troubled gate” (`:296`), “AI-inference artifact” (`:306`), and “review is haunted” (`:290`). The last is memorable but unsuitable as the sole operational explanation.

- The menu still exposes roughly 43 actions at once. Grouping helps orientation, but every non-Danger disabled item remains present. Consider group-level available counts or collapsing groups with zero enabled actions while retaining an explicit “Show unavailable actions” control.

- Putting destructive actions such as Reset to planned, Reset session, and Restart agent outside the collapsed Danger section (`mockup:286,299-300`) weakens the meaning of “Danger is collapsed, last.” New operators may reasonably assume that opening Danger is the only route to destructive operations.

- Disabled reasons cannot currently be discovered by hover because the primitives suppress pointer events. This harms both novices and accessibility (`ContextMenu.tsx:30-33,50-53`).

- The phase chip displays internal enum text such as `work running` (`mockup:340`) rather than the operator-facing pipeline vocabulary used elsewhere.

- “Wipe,” “Reset issue,” “Complete work reset,” and “Reset to planned” remain difficult to compare quickly. Their descriptions should use a consistent keep/delete matrix: workspace, branch, commits, plan, tasks, agent memory, and tracker state.

## Risks/conflicts with PAN-2499 (issue-view unification) and PAN-1610

- **PAN-2499 inventory mismatch:** PAN-2499 protects the `SessionNode` menu (`pan-2499.md:59-61`; mockup `three-issue-views-naming.html:354-355`), not `FeatureContextMenu`. PAN-2661 must add or update a distinct “Feature/issue-row context menu” inventory entry; otherwise PAN-2499’s no-loss gate will not protect this work.

- **Direct file collision with PAN-2499:** PAN-2499 repoints `IssueMissionControl` and expanded `FeatureItem` through `<IssueView>` (`pan-2499.md:105-113`) and may later retire shell code (`:115-116`). PAN-2661 edits both files. Establish merge order and require the grouped menu to remain mounted by the shared IssueView adapter.

- **Action relocation conflict:** PAN-2499 moves the nine-item per-agent SessionNode menu into `AgentStepRow` (`pan-2499.md:82-87,134-137`). PAN-2661 moves only issue-row actions. Calling both “rail context menu” risks accidentally merging session actions and issue actions or deleting one during extraction.

- **Future CTA parity conflict:** PAN-2499 introduces direct Start/Restart/Resume CTAs across five locations (`pan-2499.md:118-126`). PAN-1610 later requires zero surface-local issue actions and registry-driven presentation (`pan-1610.md:15-27,41-44`). PAN-2499 and PAN-1610 need an explicit rule that these CTAs are pinned presentations of registry actions, not separate endpoint-owning controls.

- **PAN-1610 sequencing is explicit:** it depends on both PAN-2499 and PAN-2661 (`pan-1610.md:5`) and expects to extract PAN-2661’s grouped body (`:32`). PAN-2661 should therefore shape `GroupedIssueActionMenu` so its content can be reused under non-Radix popover chrome without rewriting it.

- **Temporary extras are acceptable but must remain clearly temporary:** PAN-1610 explicitly removes PAN-2661’s `sessionExtras` props and registers them by surface (`pan-1610.md:16,26,35`). Avoid baking extras into the grouped component’s internal logic.

- **`reviewTest` retirement changes PAN-1610’s assumed registry baseline.** PAN-1610 says no action-semantic changes in its own work (`pan-1610.md:19`), so PAN-2661 must fully resolve every consumer and test before PAN-1610 begins; leaving aliases or divergent recovery behavior would make five-surface parity encode the wrong semantics.

- **Cockpit “unchanged” must mean chrome only.** PAN-2661 moves group constants but also asks for description tooltips; PAN-1610 later replaces the entire cockpit body with the shared renderer (`pan-1610.md:18,25,34`). Specify whether PAN-2661 changes cockpit tooltips now or defers all cockpit presentation changes to PAN-1610.
