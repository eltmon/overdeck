/**
 * Issue-view no-loss inventory (PAN-2499).
 *
 * ISSUE_VIEW_INVENTORY is the FR-0 surface lock for every legacy issue-view
 * section. The render-section constants below support the shared components
 * that progressively take ownership of those legacy sections.
 */

export type IssueViewDensity = 'console' | 'cockpit' | 'rail';

export interface IssueViewInventoryEntry {
  section: string;
  view: IssueViewDensity;
  home: string;
}

export const ISSUE_VIEW_INVENTORY: readonly IssueViewInventoryEntry[] = [
  { section: 'DrawerActionBar', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerActionBar.tsx' },
  { section: 'PhaseTimeline', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/PhaseTimeline.tsx' },
  { section: 'DrawerTabs', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerTabs.tsx' },
  { section: 'DrawerPickupSection / PickupGateControls', view: 'console', home: 'src/dashboard/frontend/src/components/backlog/PickupGateControls.tsx' },
  { section: 'DrawerWorkspaceSection', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx' },
  { section: 'UatEnvironmentPanel', view: 'console', home: 'src/dashboard/frontend/src/components/CommandDeck/UatEnvironmentPanel.tsx' },
  { section: 'IssuePolicyStrip / PoliciesControl', view: 'console', home: 'src/dashboard/frontend/src/components/ReviewPolicyControl.tsx' },
  { section: 'DrawerActiveAgent', view: 'console', home: 'src/dashboard/frontend/src/components/issue-view/ActiveAgentPanel.tsx' },
  { section: 'DrawerPausedBanner', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx' },
  { section: 'DrawerVerificationGates', view: 'console', home: 'src/dashboard/frontend/src/components/issue-view/VerificationGates.tsx' },
  { section: 'DrawerReviewSpecialists', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerReviewSpecialists.tsx' },
  { section: 'DrawerTasksList', view: 'console', home: 'src/dashboard/frontend/src/components/TasksPanel.tsx' },
  { section: 'DrawerPlanPanel / VBriefViewer', view: 'console', home: 'src/dashboard/frontend/src/components/vbrief/VBriefViewer.tsx' },
  { section: 'DrawerArtifactsPanel', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerArtifactsPanel.tsx' },
  { section: 'DrawerActivityRail / DrawerActivityPanel', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerActivityRail.tsx' },
  { section: 'DrawerAgentSession', view: 'console', home: 'src/dashboard/frontend/src/components/drawer/DrawerAgentSession.tsx' },
  { section: 'StartAgentCta', view: 'console', home: 'src/dashboard/frontend/src/components/issue-view/StartAgentCta.tsx' },

  { section: 'Header bar', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'Stale-review warning', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'StatusNarrative', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/StatusNarrative.tsx' },
  { section: 'Pipeline Band', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/StatusNarrative.tsx' },
  { section: 'AgentsLane', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/AgentsLane.tsx' },
  { section: 'SessionPanel', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx' },
  { section: 'StackDrawer', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/AgentsLane.tsx' },
  { section: 'Detail Tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'CrewStage', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/CrewStage.tsx' },
  { section: 'UatEnvironmentPanel', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/UatEnvironmentPanel.tsx' },
  { section: 'HappenedFeed', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/HappenedFeed.tsx' },
  { section: 'NowPanel', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },
  { section: 'PickupGateCard', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/PickupGateCard.tsx' },
  { section: 'PlanMapCard', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/PlanMapCard.tsx' },
  { section: 'IssueBlockerSpotlight', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueBlockerSpotlight.tsx' },
  { section: 'Code tab', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/ChangedFilesView.tsx' },
  { section: 'PRD / Timeline / Discussion tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/ActivityTab.tsx' },
  { section: 'Costs / Artifacts / Ship tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/CostsTab.tsx' },
  { section: 'Conversation / Files / Terminal tabs', view: 'cockpit', home: 'src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx' },
  { section: 'TasksRail / TasksTab', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/TasksRail.tsx' },
  { section: 'Awareness rail', view: 'cockpit', home: 'src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx' },

  { section: 'Filter bar', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'Feature (issue) row', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'Badges', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'MergeButton', view: 'rail', home: 'src/dashboard/frontend/src/components/MergeButton.tsx' },
  { section: 'Pipeline pips', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'ResourceStrip', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'SessionNode', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },
  { section: 'SessionNode context menu', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },
  { section: 'ReviewGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'ShipDoorTreeRow', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'Conversation rows', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx' },
  { section: 'StackDrawer / UatStackTreeGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/UatStackTreeGroup.tsx' },
  { section: 'ResourcesGroup', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ResourcesGroup.tsx' },
  { section: 'ModelResolutionCard', view: 'rail', home: 'src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx' },
];

export const AGENT_ROW_SECTIONS = [
  'agent-row-caret',
  'agent-row-icon',
  'agent-row-label',
  'agent-row-model',
  'agent-row-status',
  'agent-row-duration',
  'agent-row-cost',
  'agent-row-verdict',
  'agent-row-context-menu',
  'agent-row-paused-reason',
] as const;

export type AgentRowSection = (typeof AGENT_ROW_SECTIONS)[number];

export const SHIP_PROGRESS_SECTIONS = [
  'ship-progress-full',
  'ship-progress-compact',
  'ship-progress-steps',
  'ship-progress-step',
  'ship-progress-log',
] as const;

export type ShipProgressSection = (typeof SHIP_PROGRESS_SECTIONS)[number];

export const VERIFICATION_GATES_SECTIONS = [
  'verification-gates',
  'verification-gate',
] as const;

export type VerificationGatesSection = (typeof VERIFICATION_GATES_SECTIONS)[number];

export const BEADS_PANEL_SECTIONS = ['beads-panel', 'beads-panel-compact'] as const;

export const ACTIVE_AGENT_PANEL_SECTIONS = [
  'active-agent-panel',
  'active-agent-panel-header',
  'active-agent-panel-stream',
  'active-agent-panel-stream-line',
  'active-agent-panel-resume',
  'active-agent-panel-tell',
] as const;

export type ActiveAgentPanelSection = (typeof ACTIVE_AGENT_PANEL_SECTIONS)[number];

/** Full inventory of all issue-view sections that participate in the no-loss gate. */
export const SECTION_INVENTORY: readonly string[] = [
  ...AGENT_ROW_SECTIONS,
  ...SHIP_PROGRESS_SECTIONS,
  ...VERIFICATION_GATES_SECTIONS,
  ...ACTIVE_AGENT_PANEL_SECTIONS,
];
