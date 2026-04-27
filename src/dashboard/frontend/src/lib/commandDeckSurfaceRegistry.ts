import type { ActionKey } from './commandDeckActions';

export type SurfaceName = 'KanbanBoard' | 'ActionsSection' | 'AgentInfoSection';

export interface SurfaceActionRegistration {
  surface: SurfaceName;
  actionKey: ActionKey;
  source: string;
}

export const COMMAND_DECK_SURFACE_REGISTRY: readonly SurfaceActionRegistration[] = [
  // KanbanBoard.tsx card actions
  { surface: 'KanbanBoard', actionKey: 'beads', source: 'ArtifactLinks' },
  { surface: 'KanbanBoard', actionKey: 'vbrief', source: 'ArtifactLinks' },
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
  { surface: 'ActionsSection', actionKey: 'vbrief', source: 'ArtifactLinks' },
  { surface: 'ActionsSection', actionKey: 'reopen', source: 'inspector-reopen' },
  { surface: 'ActionsSection', actionKey: 'restartFromPlan', source: 'RestartFromPlanButton' },
  { surface: 'ActionsSection', actionKey: 'resetIssue', source: 'ResetIssueButton' },
  { surface: 'ActionsSection', actionKey: 'cancel', source: 'inspector-cancel-issue' },

  // inspector/AgentInfoSection.tsx git action
  { surface: 'AgentInfoSection', actionKey: 'syncMain', source: 'Sync with main' },
] as const;
