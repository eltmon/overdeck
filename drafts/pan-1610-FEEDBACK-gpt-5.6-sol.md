# GPT-5.6 feedback on drafts/pan-1610.md

> Model: gpt-5.6-sol via codex-cli 0.144.4 (read-only) · 2026-07-15 · requested by the operator; feedback only, no changes applied by the reviewer.

## Verdict

**Request changes before implementation.** The central direction—one action registry with shared presentation modes—is sound, and the board/drawer/cockpit drift is real. However, the PRD currently overstates what the registry owns, treats metadata catalogs as executable registry entries, and leaves the merge and Zone B contracts undefined. The binding mockup also conflicts with the real 11-phase, 44-action model.

## Reference-check findings

- The board and drawer do share the current `hybrid` renderer, as claimed. The board mounts it at [KanbanCards.tsx:840](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/KanbanBoard/cards/KanbanCards.tsx:840); the drawer uses it with `viewPr` pinned at [DrawerActionBar.tsx:12](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/drawer/DrawerActionBar.tsx:12). The overflow is a flat list at [IssueActionMenu.tsx:59](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssueActionMenu/IssueActionMenu.tsx:59), assembled without groups at [IssueActionMenu.tsx:278](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssueActionMenu/IssueActionMenu.tsx:278).

- The drawer’s merge control is indeed bolted on beside the shared menu at [DrawerActionBar.tsx:19](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/drawer/DrawerActionBar.tsx:19). But `merge` is not an `IssueActionKey`; the union ends without it at [issueActions.ts:19](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:19), and `MergeButton` owns separate readiness, stuck-retry, mutation, and confirmation behavior at [MergeButton.tsx:23](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/MergeButton.tsx:23) and [MergeButton.tsx:50](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/MergeButton.tsx:50). Therefore `pinned: ['merge']` cannot be an ordinary registry declaration as written in PRD D-3 at [pan-1610.md:17](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-1610.md:17).

- The cockpit drift claim is correct. It owns local `GROUP_LABELS` and `GROUP_ORDER` at [IssueMissionControl.tsx:86](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx:86), then rebuilds groups from `ISSUE_ACTIONS` at [IssueMissionControl.tsx:188](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx:188).

- The rail currently flattens hook output at [FeatureItem.tsx:711](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:711) and appends Open State Dir, View JSONL, and a second wipe flow at [FeatureItem.tsx:734](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:734). PAN-2661 correctly owns removal of that duplicate and introduces temporary `sessionExtras` [pan-2661.md:42](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2661.md:42).

- The PRD’s Zone B claim is materially inaccurate. `ZONE_B_SESSION_ACTIONS` is a metadata array of `{key,label,scope,ownerSurface}` at [issueActions.ts:107](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:107), not part of executable `ISSUE_ACTIONS`. It has no predicate, description, handler, confirmation, or dialog contract. Zone B hardcodes its mutations and rendering independently—for example stop confirmation at [ZoneBActionStrip.tsx:130](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:130) and overflow labels at [ZoneBActionStrip.tsx:355](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:355). The existing test explicitly proves those keys are absent from `ISSUE_ACTIONS` at [issueActions.no-actions-lost.test.ts:166](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/__tests__/issueActions.no-actions-lost.test.ts:166). Zone B is an inventory precedent, not proof of the proposed executable mechanism.

- Open State Dir, View JSONL, and Deep Wipe are already present in the non-issue metadata array at [issueActions.ts:123](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:123). D-2 should say they are being promoted into an executable surface-action contract, not newly registered.

- The proposed `ownerSurface: 'rail-session'` is not accepted by the current type, which permits only `ProjectNode | ContainerNode | FeatureItem | ZoneBActionStrip` at [issueActions.ts:109](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:109). Likewise, the current scope is `session-artifact`, not `session`.

- The binding mockup is not registry-accurate. It models four phases and roughly twenty actions at [issue-actions-one-registry-pan-1610.html:158](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:158), while production has eleven phases at [issueActions.ts:6](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:6) and 44 entries beginning at [issueActions.ts:218](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:218). Its backlog primaries include Auto-plan [issue-actions-one-registry-pan-1610.html:170](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:170), whereas production uses Plan and Start agent [issueActions.ts:193](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/lib/issueActions.ts:193).

## Gaps

- Define one executable action schema. The PRD must say whether session actions join `ISSUE_ACTIONS` through a discriminated union or use a parallel registry with equivalent fields. Without `enabledWhen`, invocation, description, kind, group, and confirmation metadata, FR-5 cannot compare gating or confirm flows.

- Define merge as either:

  - a first-class registry action, including its special ready/stuck states; or
  - a typed pinned-component slot such as `{ key: 'merge', render: MergeButton }`.

  The latter preserves D-5 but means the registry does not “own everything,” so D-1 and parity exclusions must say so explicitly.

- Preserve or deliberately retire the drawer’s current `pinRight={['viewPr']}` behavior [DrawerActionBar.tsx:15](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/drawer/DrawerActionBar.tsx:15). The PRD only discusses pinning merge.

- Bound “surface parity.” The five surfaces should not all expose identical sets: rail and Zone B have session-dependent extras, while merge is drawer-specific. Specify an oracle such as `expectedActions(registry, state, surface, context)` and test each surface against that result.

- Clarify whether disabled phase-primary actions remain inline. The current hook includes primary entries without filtering their gates [useIssueActions.ts:377](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssueActionMenu/useIssueActions.ts:377), while the mockup filters them out [issue-actions-one-registry-pan-1610.html:182](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:182). That is a semantic/presentation change despite D-5.

- AC-1’s label-literal grep is too broad. The board contains a separate hardcoded Unpause action and endpoint at [KanbanCards.tsx:607](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/KanbanBoard/cards/KanbanCards.tsx:607) and [KanbanCards.tsx:733](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/KanbanBoard/cards/KanbanCards.tsx:733). Zone B contains many more local actions than its six metadata entries. Either migrate these too or narrowly define which action mount and literals AC-1 covers.

- Replace the mockup’s approximate action data with the actual phase/action appendix or label it explicitly as conceptual. “Binding” and knowingly divergent gating cannot coexist.

## UX concerns for new users

- An icon-only `⋯` overflow is weak discovery for the main source of actions. The mockup’s “N more (grouped)” treatment at [issue-actions-one-registry-pan-1610.html:182](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:182) is more informative than the current unlabeled icon at [IssueActionMenu.tsx:85](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssueActionMenu/IssueActionMenu.tsx:85). The PRD should bind one behavior.

- Rail actions remain discoverable primarily through right-click. PAN-2661 specifies keyboard operation inside the menu, but neither PRD defines a visible or keyboard-accessible way for a newcomer to open the rail menu.

- Collapsing Danger is appropriate, but destructive actions also exist in non-Danger groups. PAN-2661 preserves that distinction [pan-2661.md:21](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2661.md:21); PAN-1610 should ensure newcomers receive the same destructive styling and confirmation cues everywhere.

- The mockup says Danger is collapsed and last [issue-actions-one-registry-pan-1610.html:143](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:143), but its rendered demonstration simply prints Danger inline through `groupedLines()` [issue-actions-one-registry-pan-1610.html:174](/home/eltmon/Projects/overdeck/docs/design/mockups/issue-actions-one-registry-pan-1610.html:174). That binding ambiguity should be removed.

## Risks/conflicts (PAN-2499, PAN-2661 sequencing)

- **PAN-2661 must land first.** PAN-1610 explicitly depends on artifacts that do not yet exist: exported groups, required descriptions, `GroupedIssueActionMenu`, and `sessionExtras`. PAN-2661 defines those changes at [pan-2661.md:19](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2661.md:19) and [pan-2661.md:42](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2661.md:42). Implementing PAN-1610 earlier would duplicate or preempt its work.

- **PAN-2499 changes the target architecture and mount locations.** Its end state is one `IssueView` family across rail, cockpit, and console [pan-2499.md:47](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2499.md:47), while PAN-1610 names today’s `IssueMissionControl`, `FeatureItem`, and `DrawerActionBar` files. The PAN-1610 work list must require a post-PAN-2499 inventory and path refresh, not merely update old inventory rows afterward.

- PAN-2499 also plans local agent/session row actions and a shared recovery CTA across densities and kanban [pan-2499.md:85](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2499.md:85) and [pan-2499.md:125](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2499.md:125). Those controls conflict with PAN-1610’s “zero out-of-registry items” unless PAN-1610 explicitly distinguishes issue-menu actions from contextual recovery/session controls.

- Recommended sequence: **PAN-2661 → PAN-2499 → rebase and refresh PAN-1610’s surface inventory/contracts → PAN-1610**. Treat the dependency merge points as specification refresh gates, because both predecessors change the files and action taxonomy that PAN-1610 proposes to consolidate.
