import { KanbanBoard } from '../components/KanbanBoard';
import { FleetAgentsView } from '../components/Agents/FleetAgentsView';
import { HealthDashboard } from '../components/HealthDashboard';
import { SkillsList } from '../components/SkillsList';
import { ActivityPanel } from '../components/ActivityPanel';
import { MetricsSummaryRow } from '../components/MetricsSummaryRow';
import { MetricsPage } from '../components/MetricsPage';
import { CostsPage } from '../components/CostsPage';
import { SettingsPage } from '../components/Settings/SettingsPage';
import { CommandDeck } from '../components/CommandDeck';
import { PipelineView } from '../components/Pipeline/PipelineView';
import { AwaitingMergePage } from '../components/AwaitingMergePage';
import { ResourcesPanel } from '../components/ResourcesPanel';
import { GodViewPage } from '../components/GodView';
import { DeaconActivityView } from '../components/DeaconActivityView';
import { ContextPage } from '../components/context/ContextPage';
import { ConversationsPage } from '../components/conversations/ConversationsPage';
import { AutoPresoView } from '../components/autopreso/AutoPresoView';
import { BootstrapGate } from '../components/BootstrapGate';
import { KanbanSkeleton } from '../components/skeletons/KanbanSkeleton';
import { AgentsSkeleton } from '../components/skeletons/AgentsSkeleton';
import { PipelineSkeleton } from '../components/skeletons/PipelineSkeleton';
import { GodViewSkeleton } from '../components/skeletons/GodViewSkeleton';
import { FlywheelPage } from '../pages/FlywheelPage';
import { BacklogSequencerPage } from '../pages/BacklogSequencerPage';
import { HomePage } from '../pages/HomePage';
import type { Tab } from '../components/Header';
import type { Issue } from '../types';
import type { ViewMode as ConversationViewMode } from '../components/chat/ConversationPanel';

export interface PendingConversationTarget {
  conversationName: string;
  messageId: string;
  messageIndex: number;
  nonce: number;
  label: string;
}

type SelectProjectHandler = (projectName: string | null, opts?: { updateUrl?: boolean }) => void;

interface AppRoutesProps {
  activeTab: Tab;
  issues: Issue[];
  selectedConvId: string | null;
  conversationViewMode: ConversationViewMode;
  selectedProjectKey: string | null;
  pendingConversationTarget: PendingConversationTarget | null;
  cockpitRoute: { project: string; issue: string } | null;
  onOpenWorkspaceHome: (issueId: string) => void;
  onNewProject: () => void;
  onSelectProject: SelectProjectHandler;
  onOpenSettings: () => void;
  onConvIdChange: (id: string | null) => void;
  onConversationViewModeChange: (viewMode: ConversationViewMode) => void;
  onPendingConversationTargetConsumed: () => void;
  onProjectPrefixChange: (prefix: string | null) => void;
  onCockpitChange: (projectKey: string | null, issueId: string | null) => void;
  onSearchOpen: () => void;
  onTabChange: (tab: Tab) => void;
  onOpenIssue: (issueId: string) => void;
  onPlanDialogChange: (issueId: string | null) => void;
  onSelectAgent: (agentId: string | null) => void;
  onBacklogIssueAction: (issueId: string, mode: 'browser' | 'modal' | 'panel') => void;
}

export function AppRoutes({
  activeTab,
  issues,
  selectedConvId,
  conversationViewMode,
  selectedProjectKey,
  pendingConversationTarget,
  cockpitRoute,
  onOpenWorkspaceHome,
  onNewProject,
  onSelectProject,
  onOpenSettings,
  onConvIdChange,
  onConversationViewModeChange,
  onPendingConversationTargetConsumed,
  onProjectPrefixChange,
  onCockpitChange,
  onSearchOpen,
  onTabChange,
  onOpenIssue,
  onPlanDialogChange,
  onSelectAgent,
  onBacklogIssueAction,
}: AppRoutesProps) {
  return (
    <>
      {activeTab === 'home' && (
        <div className="w-full h-full overflow-hidden">
          <HomePage onOpenWorkspaceHome={onOpenWorkspaceHome} onNewProject={onNewProject} onSelectProject={onSelectProject} onOpenSettings={onOpenSettings} />
        </div>
      )}
      {activeTab === 'command-deck' && (
        <div className="w-full h-full">
          <CommandDeck
            issues={issues}
            convId={selectedConvId}
            conversationViewMode={conversationViewMode}
            onConvIdChange={onConvIdChange}
            onConversationViewModeChange={onConversationViewModeChange}
            pendingConversationTarget={pendingConversationTarget}
            onPendingConversationTargetConsumed={onPendingConversationTargetConsumed}
            selectedProject={selectedProjectKey}
            onSelectProject={onSelectProject}
            onProjectPrefixChange={onProjectPrefixChange}
            cockpitIssue={cockpitRoute}
            onCockpitChange={onCockpitChange}
          />
        </div>
      )}
      {activeTab === 'pipeline' && (
        <BootstrapGate fallback={<PipelineSkeleton />}>
          <div className="w-full h-full overflow-hidden">
            <PipelineView onSearchOpen={onSearchOpen} onTabChange={(tab) => onTabChange(tab as Tab)} />
          </div>
        </BootstrapGate>
      )}
      {activeTab === 'awaiting-merge' && (
        <div className="w-full h-full overflow-auto">
          <AwaitingMergePage />
        </div>
      )}
      {activeTab === 'kanban' && (
        <BootstrapGate fallback={
          <div className="flex-1 overflow-auto p-6 w-full">
            <KanbanSkeleton />
          </div>
        }>
          <>
            <div className="flex-1 overflow-auto p-6 w-full">
              <MetricsSummaryRow />
              <KanbanBoard
                selectedIssue={null}
                onSelectIssue={(issueId) => {
                  if (issueId) onOpenIssue(issueId);
                }}
                onPlanDialogChange={onPlanDialogChange}
              />
            </div>
          </>
        </BootstrapGate>
      )}
      {activeTab === 'agents' && (
        <BootstrapGate fallback={<AgentsSkeleton />}>
          <div className="h-full w-full overflow-y-auto">
            <FleetAgentsView onNavigateToIssues={() => onTabChange('kanban')} />
          </div>
        </BootstrapGate>
      )}
      {activeTab === 'resources' && (
        <div className="w-full h-full overflow-hidden">
          <ResourcesPanel
            onNavigateToAgents={(agentId) => {
              onSelectAgent(agentId);
              onTabChange('agents');
            }}
          />
        </div>
      )}
      {activeTab === 'skills' && (
        <div className="p-6 w-full overflow-auto">
          <SkillsList />
        </div>
      )}
      {activeTab === 'context' && (
        <div className="w-full h-full overflow-hidden">
          <ContextPage />
        </div>
      )}
      {activeTab === 'health' && (
        <div className="p-6 w-full overflow-auto">
          <HealthDashboard />
        </div>
      )}
      {activeTab === 'activity' && (
        <div className="w-full h-full">
          <ActivityPanel onClose={() => onTabChange('kanban')} />
        </div>
      )}
      {activeTab === 'metrics' && (
        <div className="w-full overflow-auto">
          <MetricsPage />
        </div>
      )}
      {activeTab === 'costs' && (
        <div className="w-full overflow-auto">
          <CostsPage />
        </div>
      )}
      {activeTab === 'autopreso' && (
        <div className="w-full h-full overflow-hidden">
          <AutoPresoView />
        </div>
      )}
      {activeTab === 'flywheel' && (
        <div className="w-full h-full overflow-hidden">
          <FlywheelPage
            onOpenSettings={onOpenSettings}
            onNavigateAgent={(agentId) => {
              onSelectAgent(agentId);
              onTabChange('agents');
            }}
            onNavigateIssue={(issueId) => onOpenIssue(issueId)}
          />
        </div>
      )}
      {activeTab === 'backlog' && (
        <div className="w-full h-full overflow-hidden">
          <BacklogSequencerPage onIssueAction={onBacklogIssueAction} />
        </div>
      )}
      {activeTab === 'settings' && (
        <div className="p-6 w-full overflow-auto">
          <SettingsPage />
        </div>
      )}
      {activeTab === 'sessions' && (
        <div className="w-full h-full overflow-hidden">
          <ConversationsPage />
        </div>
      )}
      {activeTab === 'god-view' && (
        <BootstrapGate fallback={
          <div className="w-full h-full overflow-hidden">
            <GodViewSkeleton />
          </div>
        }>
          <div className="w-full h-full overflow-hidden">
            <GodViewPage />
          </div>
        </BootstrapGate>
      )}
      {activeTab === 'deacon' && (
        <div className="w-full h-full overflow-hidden">
          <DeaconActivityView />
        </div>
      )}
    </>
  );
}
