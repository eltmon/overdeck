import type { IssueViewDensity } from './inventory';

export const DENSITY_SECTIONS: Readonly<Record<IssueViewDensity, readonly string[]>> = {
  console: ['StartAgentCta', 'DrawerActionBar', 'PhaseTimeline', 'DrawerTabs', 'DrawerPickupSection / PickupGateControls', 'DrawerWorkspaceSection', 'DrawerActiveAgent', 'DrawerPausedBanner', 'DrawerVerificationGates', 'DrawerReviewSpecialists', 'DrawerBeadsList', 'DrawerPlanPanel / VBriefViewer', 'DrawerArtifactsPanel', 'DrawerActivityRail / DrawerActivityPanel', 'DrawerAgentSession', 'ReviewPolicyControl'],
  cockpit: ['StartAgentCta', 'Header bar', 'StatusNarrative', 'Pipeline Band', 'AgentsLane', 'StackDrawer', 'Detail Tabs', 'CrewStage', 'HappenedFeed', 'PlanMapCard', 'IssueBlockerSpotlight', 'Code tab', 'PRD / Timeline / Discussion tabs', 'Costs / Artifacts / Ship tabs', 'Conversation / Files / Terminal tabs', 'BeadsRail / BeadsTab', 'Awareness rail', 'ReviewPolicyControl'],
  rail: ['StartAgentCta', 'Filter bar', 'Feature (issue) row', 'Badges', 'MergeButton', 'Pipeline pips', 'ResourceStrip', 'SessionNode', 'SessionNode context menu', 'ReviewGroup', 'ShipDoorTreeRow', 'StackDrawer / UatStackTreeGroup', 'ResourcesGroup', 'ModelResolutionCard'],
};

export function sectionsForDensity(density: IssueViewDensity): readonly string[] {
  return DENSITY_SECTIONS[density];
}
