import type { ActionKey } from './commandDeckActions';

export type SurfaceName =
  | 'KanbanBoard'
  | 'ActionsSection'
  | 'AgentInfoSection'
  | 'ReviewPipelineSection'
  | 'ContainerSection'
  | 'BadgeBar'
  | 'StatusFlowControl'
  | 'WorkspacePane';

export interface SurfaceDescriptor {
  surface: SurfaceName;
  file: string;
}

export interface SurfaceActionRegistration {
  surface: SurfaceName;
  actionKey: ActionKey;
  source: string;
}

export const COMMAND_DECK_PARITY_SURFACES: readonly SurfaceDescriptor[] = [
  { surface: 'KanbanBoard', file: 'src/dashboard/frontend/src/components/KanbanBoard.tsx' },
  { surface: 'ActionsSection', file: 'src/dashboard/frontend/src/components/inspector/ActionsSection.tsx' },
  { surface: 'AgentInfoSection', file: 'src/dashboard/frontend/src/components/inspector/AgentInfoSection.tsx' },
  { surface: 'ReviewPipelineSection', file: 'src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx' },
  { surface: 'ContainerSection', file: 'src/dashboard/frontend/src/components/inspector/ContainerSection.tsx' },
  { surface: 'BadgeBar', file: 'src/dashboard/frontend/src/components/CommandDeck/FeatureMetadata/BadgeBar.tsx' },
  { surface: 'StatusFlowControl', file: 'src/dashboard/frontend/src/components/WorkspaceStatusOverview.tsx' },
  { surface: 'WorkspacePane', file: 'src/dashboard/frontend/src/components/InspectorPanel.tsx' },
] as const;

export const COMMAND_DECK_SURFACE_REGISTRY: readonly SurfaceActionRegistration[] = [
  // KanbanBoard.tsx card actions
  { surface: 'KanbanBoard', actionKey: 'beads', source: 'ArtifactLinks' },
  { surface: 'KanbanBoard', actionKey: 'recover', source: 'RecoverButton' },
  { surface: 'KanbanBoard', actionKey: 'merge', source: 'MergeButton' },
  { surface: 'KanbanBoard', actionKey: 'resetIssue', source: 'ResetIssueButton' },
  { surface: 'KanbanBoard', actionKey: 'stopAgent', source: 'StopAgentButton' },
  { surface: 'KanbanBoard', actionKey: 'startAgent', source: 'handleStartAgent' },
  { surface: 'KanbanBoard', actionKey: 'resumeSession', source: 'handleResumeSession' },
  { surface: 'KanbanBoard', actionKey: 'reopen', source: 'ReopenSection' },

  // inspector/ActionsSection.tsx workspace + issue actions
  { surface: 'ActionsSection', actionKey: 'merge', source: 'MergeButton' },
  { surface: 'ActionsSection', actionKey: 'reviewTest', source: 'review-test-btn' },
  { surface: 'ActionsSection', actionKey: 'stopAgent', source: 'StopAgentButton' },
  { surface: 'ActionsSection', actionKey: 'recover', source: 'RecoverButton' },
  { surface: 'ActionsSection', actionKey: 'startAgent', source: 'inspector-start-agent' },
  { surface: 'ActionsSection', actionKey: 'resumeSession', source: 'inspector-resume-session' },
  { surface: 'ActionsSection', actionKey: 'resetSession', source: 'inspector-reset-session' },
  { surface: 'ActionsSection', actionKey: 'createWorkspace', source: 'inspector-create-workspace' },
  { surface: 'ActionsSection', actionKey: 'copySettings', source: 'Copy Settings' },
  { surface: 'ActionsSection', actionKey: 'beads', source: 'ArtifactLinks' },
  { surface: 'ActionsSection', actionKey: 'reopen', source: 'inspector-reopen' },
  { surface: 'ActionsSection', actionKey: 'restartFromPlan', source: 'RestartFromPlanButton' },
  { surface: 'ActionsSection', actionKey: 'resetIssue', source: 'ResetIssueButton' },
  { surface: 'ActionsSection', actionKey: 'cancel', source: 'inspector-cancel-issue' },

  // inspector/AgentInfoSection.tsx git action
  { surface: 'AgentInfoSection', actionKey: 'syncMain', source: 'Sync with main' },

  // inspector/ReviewPipelineSection.tsx pipeline actions/state transitions
  { surface: 'ReviewPipelineSection', actionKey: 'reviewTest', source: 'Build Gate / Review / Tests pipeline' },
  { surface: 'ReviewPipelineSection', actionKey: 'recover', source: 'Failed or blocked pipeline states' },

  // inspector/ContainerSection.tsx workspace controls
  { surface: 'ContainerSection', actionKey: 'createWorkspace', source: 'Refresh DB / container controls' },

  // CommandDeck/FeatureMetadata/BadgeBar.tsx planning artifact actions
  { surface: 'BadgeBar', actionKey: 'beads', source: 'Tasks badge' },
  { surface: 'BadgeBar', actionKey: 'statusReview', source: 'Status badge' },
  { surface: 'BadgeBar', actionKey: 'inference', source: 'Inference badge' },
  { surface: 'BadgeBar', actionKey: 'discussions', source: 'Discussions badge' },
  { surface: 'BadgeBar', actionKey: 'transcripts', source: 'Transcripts badge' },
  { surface: 'BadgeBar', actionKey: 'upload', source: 'Upload badge' },
  { surface: 'BadgeBar', actionKey: 'syncDiscussions', source: 'Sync badge' },

  // WorkspaceStatusOverview.tsx compact card workflow controls
  { surface: 'StatusFlowControl', actionKey: 'merge', source: 'Compact MERGE button' },
  { surface: 'StatusFlowControl', actionKey: 'reviewTest', source: 'Compact Review & Test button' },
  { surface: 'StatusFlowControl', actionKey: 'recover', source: 'Compact Recover button' },
  { surface: 'StatusFlowControl', actionKey: 'stopAgent', source: 'Compact Stop Agent button' },
  { surface: 'StatusFlowControl', actionKey: 'startAgent', source: 'Compact Start Agent button' },
  { surface: 'StatusFlowControl', actionKey: 'resumeSession', source: 'Compact Resume Session button' },
  { surface: 'StatusFlowControl', actionKey: 'resetSession', source: 'Compact Reset Session button' },
  { surface: 'StatusFlowControl', actionKey: 'createWorkspace', source: 'Compact Create Workspace button' },
  { surface: 'StatusFlowControl', actionKey: 'reopen', source: 'Compact Reopen button' },

  // InspectorPanel.tsx workspace pane sections
  { surface: 'WorkspacePane', actionKey: 'syncMain', source: 'AgentInfoSection mount point' },
  { surface: 'WorkspacePane', actionKey: 'reviewTest', source: 'ActionsSection mount point' },
  { surface: 'WorkspacePane', actionKey: 'createWorkspace', source: 'Workspace creation state' },
] as const;
