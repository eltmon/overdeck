import type { IssueViewDensity } from './inventory';

export const DENSITY_SECTIONS: Readonly<Record<IssueViewDensity, readonly string[]>> = {
  console: ['DrawerActionBar', 'PhaseTimeline', 'DrawerTabs', 'DrawerPickupSection / PickupGateControls', 'DrawerWorkspaceSection', 'UatEnvironmentPanel', 'IssuePolicyStrip / PoliciesControl', 'DrawerActiveAgent', 'DrawerPausedBanner', 'DrawerVerificationGates', 'DrawerReviewSpecialists', 'DrawerTasksList', 'DrawerPlanPanel / VBriefViewer', 'DrawerArtifactsPanel', 'DrawerActivityRail / DrawerActivityPanel', 'DrawerAgentSession', 'StartAgentCta'],
  cockpit: ['Header bar', 'Stale-review warning', 'StatusNarrative', 'Pipeline Band', 'AgentsLane', 'SessionPanel', 'StackDrawer', 'Detail Tabs', 'CrewStage', 'UatEnvironmentPanel', 'HappenedFeed', 'NowPanel', 'PickupGateCard', 'PlanMapCard', 'IssueBlockerSpotlight', 'Code tab', 'PRD / Timeline / Discussion tabs', 'Costs / Artifacts / Ship tabs', 'Conversation / Files / Terminal tabs', 'TasksRail / TasksTab', 'Awareness rail'],
  rail: ['Filter bar', 'Feature (issue) row', 'Badges', 'MergeButton', 'Pipeline pips', 'ResourceStrip', 'SessionNode', 'SessionNode context menu', 'ReviewGroup', 'ShipDoorTreeRow', 'Conversation rows', 'StackDrawer / UatStackTreeGroup', 'ResourcesGroup', 'ModelResolutionCard'],
};

export function sectionsForDensity(density: IssueViewDensity): readonly string[] {
  return DENSITY_SECTIONS[density];
}
