import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';
import { KanbanBoard } from './components/KanbanBoard';
import { AgentList } from './components/AgentList';
import { AgentOutputPanel } from './components/AgentOutputPanel';
import { HealthDashboard } from './components/HealthDashboard';
import { SkillsList } from './components/SkillsList';
import { ActivityPanel } from './components/ActivityPanel';
import { ConvoyPanel } from './components/ConvoyPanel';
import { HandoffsPage } from './components/HandoffsPage';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { EventRouter } from './components/EventRouter';
import { MetricsSummaryRow } from './components/MetricsSummaryRow';
import { MetricsPage } from './components/MetricsPage';
import { CostsPage } from './components/CostsPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { SearchModal } from './components/search/SearchModal';
import { MissionControl } from './components/MissionControl';
import { ResourcesPanel } from './components/ResourcesPanel';
import { GodViewPage } from './components/GodView';
import { Header, Tab } from './components/Header';
import { BootstrapGate } from './components/BootstrapGate';
import { KanbanSkeleton } from './components/skeletons/KanbanSkeleton';
import { AgentListSkeleton } from './components/skeletons/AgentListSkeleton';
import { GodViewSkeleton } from './components/skeletons/GodViewSkeleton';
import { DetailPanelLayout } from './components/DetailPanelLayout';
import { AlertTriangle } from 'lucide-react';
import { Agent, Issue } from './types';
import { useDashboardStore, selectAgentList, selectIssues } from './lib/store';

interface TrackerStatusItem {
  type: string;
  name: string;
  hasKey: boolean;
  envVar: string;
  isPrimary: boolean;
}

interface TrackerStatus {
  primary: string;
  secondary?: string;
  configured: TrackerStatusItem[];
}

const TAB_PATHS: Record<Tab, string> = {
  kanban: '/',
  'mission-control': '/mission-control',
  agents: '/agents',
  resources: '/resources',
  convoys: '/convoys',
  handoffs: '/handoffs',
  activity: '/activity',
  metrics: '/metrics',
  costs: '/costs',
  skills: '/skills',
  health: '/health',
  settings: '/settings',
  'god-view': '/god-view',
};

const PATH_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab])
) as Record<string, Tab>;

function getTabFromPath(): Tab {
  const path = window.location.pathname;
  return PATH_TO_TAB[path] || 'kanban';
}

async function fetchTrackerStatus(): Promise<TrackerStatus> {
  const res = await fetch('/api/tracker-status');
  if (!res.ok) throw new Error('Failed to fetch tracker status');
  return res.json();
}

async function fetchConfirmations(): Promise<ConfirmationRequest[]> {
  const res = await fetch('/api/confirmations');
  if (!res.ok) throw new Error('Failed to fetch confirmations');
  return res.json();
}

async function respondToConfirmation(id: string, confirmed: boolean): Promise<void> {
  const res = await fetch(`/api/confirmations/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmed }),
  });
  if (!res.ok) throw new Error('Failed to respond to confirmation');
}

export default function App() {
  const [activeTab, setActiveTabState] = useState<Tab>(getTabFromPath);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [trackerBannerDismissed, setTrackerBannerDismissed] = useState(false);

  // Check tracker status for missing API keys
  const { data: trackerStatus } = useQuery({
    queryKey: ['tracker-status'],
    queryFn: fetchTrackerStatus,
    refetchInterval: 60000,
    retry: false,
  });

  const missingKeyTrackers = trackerStatus?.configured.filter(t => !t.hasKey) || [];

  // URL-synced tab navigation
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    const path = TAB_PATHS[tab];
    if (window.location.pathname !== path) {
      window.history.pushState({ tab }, '', path);
    }
  }, []);

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      setActiveTabState(getTabFromPath());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Agents from Zustand store (event-sourced — no polling)
  // Cast to Agent[] since AgentSnapshot is a compatible subset for the fields used here
  const agents = useDashboardStore(selectAgentList) as unknown as Agent[];

  // Issues from Zustand store (event-sourced via snapshot — no polling)
  const issues = useDashboardStore(selectIssues) as unknown as Issue[];

  // Poll for pending confirmations
  const { data: confirmations = [] } = useQuery({
    queryKey: ['confirmations'],
    queryFn: fetchConfirmations,
    refetchInterval: 10000,
  });

  // Show the most recent confirmation request
  useEffect(() => {
    if (confirmations.length > 0 && !currentConfirmation) {
      setCurrentConfirmation(confirmations[0]);
    }
  }, [confirmations, currentConfirmation]);

  // Track which planning agents have already fired an INPUT toast to avoid spam
  const notifiedPlanningInputRef = useRef<Set<string>>(new Set());

  // Toast notification when a planning agent needs user input
  useEffect(() => {
    const planningAgentsNeedingInput = agents.filter(
      (a) => a.agentPhase === 'planning' && a.hasPendingQuestion && a.status !== 'stopped'
    );

    for (const agent of planningAgentsNeedingInput) {
      const key = `${agent.id}-input`;
      if (!notifiedPlanningInputRef.current.has(key)) {
        notifiedPlanningInputRef.current.add(key);
        toast.info(`Planning agent needs input for ${agent.issueId || agent.id}`, {
          description: 'The planning agent has a question for you. Open the Plan dialog to respond.',
          duration: 10000,
        });
      }
    }

    for (const key of notifiedPlanningInputRef.current) {
      const agentId = key.replace('-input', '');
      const agent = agents.find((a) => a.id === agentId);
      if (!agent || !agent.hasPendingQuestion || agent.status === 'stopped') {
        notifiedPlanningInputRef.current.delete(key);
      }
    }
  }, [agents]);

  // Find agent for selected issue
  const selectedIssueAgent = selectedIssue
    ? agents.find((a) => a.issueId?.toLowerCase() === selectedIssue.toLowerCase())
    : null;

  // Find issue URL for selected issue
  const selectedIssueData = selectedIssue
    ? issues.find((i) => i.identifier.toLowerCase() === selectedIssue.toLowerCase())
    : null;


  const handleConfirm = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, true);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to confirm:', error);
    }
  }, [currentConfirmation]);

  const handleDeny = useCallback(async () => {
    if (!currentConfirmation) return;
    try {
      await respondToConfirmation(currentConfirmation.id, false);
      setCurrentConfirmation(null);
    } catch (error) {
      console.error('Failed to deny:', error);
    }
  }, [currentConfirmation]);

  const handleCloseConfirmation = useCallback(() => {
    setCurrentConfirmation(null);
  }, []);

  // Global keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSelectIssueFromSearch = useCallback((issueId: string) => {
    setSelectedIssue(issueId);
    setActiveTab('kanban');
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden transition-colors duration-150" style={{ backgroundColor: '#101622' }}>
      {/* Event-sourced state: connects WsTransport → DashboardStore (PAN-428 B4) */}
      <EventRouter />
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSearchOpen={() => setIsSearchOpen(true)}
      />

      {/* Missing Tracker API Key Banner */}
      {missingKeyTrackers.length > 0 && !trackerBannerDismissed && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center gap-3 shrink-0">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="text-amber-400 text-sm flex-1">
            <span className="font-semibold">Missing API key{missingKeyTrackers.length > 1 ? 's' : ''}:</span>{' '}
            {missingKeyTrackers.map(t => (
              <span key={t.type}>
                {t.name} (<code className="font-mono text-xs bg-amber-500/20 px-1 rounded">{t.envVar}</code>)
              </span>
            )).reduce((prev, curr, i) => i === 0 ? [curr] : [...prev, ', ', curr], [] as React.ReactNode[])}.{' '}
            <button
              onClick={() => setActiveTab('settings')}
              className="underline hover:text-amber-300 font-semibold"
            >
              Configure in Settings
            </button>
          </p>
          <button
            onClick={() => setTrackerBannerDismissed(true)}
            className="text-amber-400/60 hover:text-amber-400 shrink-0"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'mission-control' && (
          <div className="w-full h-full">
            <MissionControl issues={issues} />
          </div>
        )}
        {activeTab === 'kanban' && (
          <BootstrapGate fallback={
            <div className="flex-1 overflow-auto p-6 w-full">
              <KanbanSkeleton />
            </div>
          }>
            <>
              <div className={`flex-1 overflow-auto p-6 ${selectedIssue ? '' : 'w-full'}`}>
                <MetricsSummaryRow />
                <KanbanBoard
                  selectedIssue={selectedIssue}
                  onSelectIssue={setSelectedIssue}
                />
              </div>
              {selectedIssue && selectedIssueData && (
                <DetailPanelLayout
                  agent={selectedIssueAgent ?? undefined}
                  issueId={selectedIssue}
                  issueUrl={selectedIssueData.url}
                  issue={selectedIssueData}
                  onClose={() => setSelectedIssue(null)}
                />
              )}
            </>
          </BootstrapGate>
        )}
        {activeTab === 'agents' && (
          <BootstrapGate fallback={<AgentListSkeleton />}>
            <div className="p-6 w-full">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <AgentList
                  selectedAgent={selectedAgent}
                  onSelectAgent={setSelectedAgent}
                />
                {selectedAgent && <AgentOutputPanel agentId={selectedAgent} />}
              </div>
            </div>
          </BootstrapGate>
        )}
        {activeTab === 'resources' && (
          <div className="w-full h-full overflow-hidden">
            <ResourcesPanel
              onNavigateToAgents={(agentId) => {
                setSelectedAgent(agentId);
                setActiveTab('agents');
              }}
            />
          </div>
        )}
        {activeTab === 'skills' && (
          <div className="p-6 w-full overflow-auto">
            <SkillsList />
          </div>
        )}
        {activeTab === 'health' && (
          <div className="p-6 w-full overflow-auto">
            <HealthDashboard />
          </div>
        )}
        {activeTab === 'activity' && (
          <div className="w-full h-full">
            <ActivityPanel onClose={() => setActiveTab('kanban')} />
          </div>
        )}
        {activeTab === 'convoys' && (
          <div className="w-full h-full">
            <ConvoyPanel onClose={() => setActiveTab('kanban')} />
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
        {activeTab === 'handoffs' && (
          <div className="w-full overflow-auto">
            <HandoffsPage />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="p-6 w-full overflow-auto">
            <SettingsPage />
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
      </main>

      {/* Confirmation Dialog */}
      <ConfirmationDialog
        request={currentConfirmation}
        isOpen={!!currentConfirmation}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
        onClose={handleCloseConfirmation}
      />

      {/* Search Modal */}
      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectIssue={handleSelectIssueFromSearch}
        cycleFilter="current"
        includeCompletedFilter={false}
      />

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}
