import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KanbanBoard } from './components/KanbanBoard';
import { AgentList } from './components/AgentList';
import { TerminalView } from './components/TerminalView';
import { HealthDashboard } from './components/HealthDashboard';
import { SkillsList } from './components/SkillsList';
import { ActivityPanel } from './components/ActivityPanel';
import { ConvoyPanel } from './components/ConvoyPanel';
import { HandoffsPage } from './components/HandoffsPage';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { MetricsSummaryRow } from './components/MetricsSummaryRow';
import { MetricsPage } from './components/MetricsPage';
import { CostsPage } from './components/CostsPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { SearchModal } from './components/search/SearchModal';
import { MissionControl } from './components/MissionControl';
import { Header, Tab } from './components/Header';
import { DetailPanelLayout } from './components/DetailPanelLayout';
import { AlertTriangle } from 'lucide-react';
import { Agent, Issue } from './types';
import { useTheme } from './hooks/useTheme';
import { useSocketIssues } from './hooks/useSocketIssues';

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
  'mission-control': '/',
  kanban: '/kanban',
  agents: '/agents',
  convoys: '/convoys',
  handoffs: '/handoffs',
  activity: '/activity',
  metrics: '/metrics',
  costs: '/costs',
  skills: '/skills',
  health: '/health',
  settings: '/settings',
};

const PATH_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab])
) as Record<string, Tab>;

function getTabFromPath(): Tab {
  const path = window.location.pathname;
  return PATH_TO_TAB[path] || 'mission-control';
}

async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch('/api/agents');
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

async function fetchIssues(): Promise<Issue[]> {
  const res = await fetch('/api/issues');
  if (!res.ok) throw new Error('Failed to fetch issues');
  return res.json();
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

  const { initTheme } = useTheme();
  useSocketIssues();

  const { data: trackerStatus } = useQuery({
    queryKey: ['tracker-status'],
    queryFn: fetchTrackerStatus,
    refetchInterval: 60000,
    retry: false,
  });

  const missingKeyTrackers = trackerStatus?.configured.filter(t => !t.hasKey) || [];

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    const path = TAB_PATHS[tab];
    if (window.location.pathname !== path) {
      window.history.pushState({ tab }, '', path);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveTabState(getTabFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 5000,
  });

  const { data: issues = [] } = useQuery({
    queryKey: ['issues'],
    queryFn: fetchIssues,
  });

  const { data: confirmations = [] } = useQuery({
    queryKey: ['confirmations'],
    queryFn: fetchConfirmations,
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (confirmations.length > 0 && !currentConfirmation) {
      setCurrentConfirmation(confirmations[0]);
    }
  }, [confirmations, currentConfirmation]);

  const selectedIssueAgent = selectedIssue
    ? agents.find((a) => a.issueId?.toLowerCase() === selectedIssue.toLowerCase())
    : null;

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

  const handleCloseConfirmation = useCallback(() => setCurrentConfirmation(null), []);

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
  }, [setActiveTab]);

  return (
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: '#101622' }}
    >
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
            <span className="material-symbols-outlined text-[18px]">close</span>
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
          <div className="flex-1 flex overflow-hidden">
            {/* Kanban board area */}
            <div className="flex-1 overflow-auto p-6 min-w-0">
              <MetricsSummaryRow />
              <KanbanBoard
                selectedIssue={selectedIssue}
                onSelectIssue={setSelectedIssue}
              />
            </div>

            {/* Detail panel (Inspector + Terminal) */}
            {selectedIssue && selectedIssueData && (
              <DetailPanelLayout
                agent={selectedIssueAgent ?? undefined}
                issueId={selectedIssue}
                issueUrl={selectedIssueData.url}
                issue={selectedIssueData}
                onClose={() => setSelectedIssue(null)}
              />
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="p-6 w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <AgentList
                selectedAgent={selectedAgent}
                onSelectAgent={setSelectedAgent}
              />
              {selectedAgent && <TerminalView agentId={selectedAgent} />}
            </div>
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
      </main>

      <ConfirmationDialog
        request={currentConfirmation}
        isOpen={!!currentConfirmation}
        onConfirm={handleConfirm}
        onDeny={handleDeny}
        onClose={handleCloseConfirmation}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelectIssue={handleSelectIssueFromSearch}
        cycleFilter="current"
        includeCompletedFilter={false}
      />
    </div>
  );
}
