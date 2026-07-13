/**
 * Issue View no-loss inventory — FR-0 surface-lock (PAN-2499).
 *
 * Source of truth: the "Complete component inventory — the no-loss checklist"
 * in docs/design/mockups/three-issue-views-naming.html (source-read 2026-07-08),
 * PLUS ReviewPolicyControl from PAN-1874. Today one issue's pipeline state is
 * rendered by three independently built views — Console (drawer/IssueDrawer),
 * Cockpit (Stage/cockpit/IssueMissionControl + AgentsLane), and Rail
 * (CommandDeck/ProjectTree/FeatureItem + SessionNode). This manifest enumerates
 * every section those views render so the upcoming unification (one
 * `<IssueView density>` family) cannot silently drop a surface. Nothing may be
 * removed without an explicit re-homing decision — that is what the gate test
 * in tests/unit/dashboard/frontend/issue-view-no-loss.test.ts enforces.
 *
 * `home` rule — the repo-relative path of the file that CURRENTLY renders the
 * section:
 *   - a section shipped as a dedicated, imported component → that component's
 *     own file (e.g. DrawerActiveAgent → drawer/DrawerActiveAgent.tsx);
 *   - a section rendered inline inside a shell (no component file of its own)
 *     → the shell file (IssueDrawer.tsx, IssueMissionControl.tsx,
 *     FeatureItem.tsx, SessionNode.tsx, AgentsLane.tsx, StatusNarrative.tsx);
 *   - a compound section ("A / B", or a multi-tab row) → the first listed
 *     component that ships as its own file; if none do, the shell.
 * Later beads update `home` as a cluster moves into the shared Issue View kit;
 * that is exactly the edit this manifest exists to make visible.
 */
export type IssueView = 'console' | 'cockpit' | 'rail';

export interface IssueViewInventoryEntry {
  /** Section name, taken 1:1 from the mockup's no-loss checklist `<li>` items. */
  section: string;
  /** Which of the three issue views the section belongs to today. */
  view: IssueView;
  /** Repo-relative path of the file currently rendering this section. */
  home: string;
}

export const ISSUE_VIEW_INVENTORY: readonly IssueViewInventoryEntry[] = [
  // ── Console (View 1 — drawer/IssueDrawer.tsx) — 14 sections ──────────────
  { section: 'DrawerActionBar', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerActionBar.tsx' },
  { section: 'PhaseTimeline', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/PhaseTimeline.tsx' },
  { section: 'DrawerTabs', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerTabs.tsx' },
  // DrawerPickupSection is an inline wrapper in IssueDrawer.tsx around the
  // shared PickupGateControls (PAN-2059) → home is the shared control's file.
  { section: 'DrawerPickupSection / PickupGateControls', view: 'console', home: 'src/dashboard/frontend/src/components/backlog/PickupGateControls.tsx' },
  // DrawerWorkspaceSection is defined inline in IssueDrawer.tsx.
  { section: 'DrawerWorkspaceSection', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx' },
  { section: 'DrawerActiveAgent', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerActiveAgent.tsx' },
  // ★ the live-agent panel you love. DrawerPausedBanner is inline in IssueDrawer.tsx.
  { section: 'DrawerPausedBanner', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx' },
  { section: 'DrawerVerificationGates', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerVerificationGates.tsx' },
  { section: 'DrawerReviewSpecialists', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerReviewSpecialists.tsx' },
  { section: 'DrawerBeadsList', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerBeadsList.tsx' },
  // DrawerPlanPanel is an inline wrapper in IssueDrawer.tsx around VBriefViewer.
  { section: 'DrawerPlanPanel / VBriefViewer', view: 'console', home: 'src/dashboard/frontend/src/components/vbrief/VBriefViewer.tsx' },
  { section: 'DrawerArtifactsPanel', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerArtifactsPanel.tsx' },
  // DrawerActivityRail is the dedicated right-pane feed; DrawerActivityPanel
  // (the Activity tab) is inline in IssueDrawer.tsx.
  { section: 'DrawerActivityRail / DrawerActivityPanel', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerActivityRail.tsx' },
  { section: 'DrawerAgentSession', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerAgentSession.tsx' },

  // ── Cockpit (View 2 — Stage/cockpit/IssueMissionControl.tsx) — 16 sections ─
  // Header bar (title, PENDING badge, HeaderStat, Merge button, Actions menu)
  // is composed inline in IssueMissionControl.tsx.
  { section: 'Header bar', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'StatusNarrative', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/StatusNarrative.tsx' },
  // The Pipeline Band (Planned/Building/Reviewing/Testing/Shipping journey
  // strip with glosses) renders inside StatusNarrative.tsx.
  { section: 'Pipeline Band', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/StatusNarrative.tsx' },
  { section: 'AgentsLane', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/AgentsLane.tsx' },
  // StackDrawer (PAN-1991 #8) is a function component defined inside AgentsLane.tsx.
  { section: 'StackDrawer', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/AgentsLane.tsx' },
  // The detail-tab strip + activeTab routing render inline in IssueMissionControl.tsx.
  { section: 'Detail Tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'CrewStage', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/CrewStage.tsx' },
  { section: 'HappenedFeed', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/HappenedFeed.tsx' },
  { section: 'PlanMapCard', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/PlanMapCard.tsx' },
  { section: 'IssueBlockerSpotlight', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueBlockerSpotlight.tsx' },
  // Code tab: GitHubCiPanel is inline in IssueMissionControl.tsx; ChangedFilesView is the dedicated diff view.
  { section: 'Code tab', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/ChangedFilesView.tsx' },
  // PRD/Timeline/Discussion tabs: PlanMissionTab is inline in IssueMissionControl.tsx;
  // ActivityTab and DiscussionsTab are dedicated → first dedicated is ActivityTab.
  { section: 'PRD / Timeline / Discussion tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/ActivityTab.tsx' },
  // Costs/Artifacts/Ship tabs: CostsTab, DrawerArtifactsPanel, ShipTab are all dedicated → first is CostsTab.
  { section: 'Costs / Artifacts / Ship tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/CostsTab.tsx' },
  // Conversation/Files/Terminal tabs: ConversationTab is inline in IssueMissionControl.tsx;
  // Files/Terminal open-pane cards render via SessionPanel.
  { section: 'Conversation / Files / Terminal tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx' },
  { section: 'BeadsRail / BeadsTab', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/BeadsRail.tsx' },
  // Awareness rail (Needs-you + activity feed) renders inline in IssueMissionControl.tsx.
  { section: 'Awareness rail', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },

  // ── Rail (View 3 — CommandDeck/ProjectTree/FeatureItem.tsx + SessionNode.tsx) — 13 sections ─
  // Most rail sections render inline inside FeatureItem.tsx (~1,358 lines) or
  // SessionNode.tsx; a handful are dedicated components invoked from them.
  { section: 'Filter bar', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'Feature (issue) row', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  // Ready/awaiting-merge, merge-train, UAT-stack badges render inline in FeatureItem.tsx;
  // TroubledBadges is the one dedicated badge component invoked from it.
  { section: 'Badges', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'MergeButton', view: 'rail', home: 'src/dashboard/frontend/src/components/MergeButton.tsx' },
  // Pipeline pips (plan·work·review·test·ship mini-strip) render inline in FeatureItem.tsx.
  { section: 'Pipeline pips', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  // ResourceStrip is an inline component in FeatureItem.tsx.
  { section: 'ResourceStrip', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'SessionNode', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },
  // SessionNode context menu (Stop/Pause/Unpause/Resume/Restart/Deep-wipe/…) renders inline in SessionNode.tsx.
  { section: 'SessionNode context menu', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },
  // ReviewGroup (nested review convoy sub-agents) is inline in FeatureItem.tsx.
  { section: 'ReviewGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  // ShipDoorTreeRow (live server-side merge, PAN-2487) is inline in FeatureItem.tsx.
  { section: 'ShipDoorTreeRow', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  // The rail's workspace-stack tree is UatStackTreeGroup (StackDrawer itself lives in cockpit/AgentsLane.tsx).
  { section: 'StackDrawer / UatStackTreeGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/UatStackTreeGroup.tsx' },
  { section: 'ResourcesGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ResourcesGroup.tsx' },
  // ModelResolutionCard (resolved model + harness on expand) renders inline in SessionNode.tsx (RestartModelSubmenu).
  { section: 'ModelResolutionCard', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },

  // ── PAN-1874 addition ────────────────────────────────────────────────────
  // ReviewPolicyControl is rendered by IssueMissionControl.tsx (the cockpit)
  // and IssueHeader.tsx; it is the +1 surface the mockup checklist names
  // alongside the 14/16/13 per-view counts.
  { section: 'ReviewPolicyControl', view: 'cockpit', home: 'src/dashboard/frontend/src/components/ReviewPolicyControl.tsx' },
];
