import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KanbanBoard } from './components/KanbanBoard';
import { AgentList } from './components/AgentList';
import { TerminalView } from './components/TerminalView';
import { HealthDashboard } from './components/HealthDashboard';
import { SkillsList } from './components/SkillsList';
import { WorkspacePanel } from './components/WorkspacePanel';
// IssueDetailPanel functionality is now unified into WorkspacePanel
import { ActivityPanel } from './components/ActivityPanel';
import { ConvoyPanel } from './components/ConvoyPanel';
import { CloisterStatusBar } from './components/CloisterStatusBar';
import { HandoffsPage } from './components/HandoffsPage';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { MetricsSummary } from './components/MetricsSummary';
import { MetricsPage } from './components/MetricsPage';
import { CostsPage } from './components/CostsPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { SearchModal } from './components/search/SearchModal';
import { Eye, LayoutGrid, Users, Activity, BookOpen, Terminal, Maximize2, Minimize2, BarChart3, DollarSign, ArrowRightLeft, Settings, Sun, Moon } from 'lucide-react';
import { Agent, Issue } from './types';
import { useTheme } from './hooks/useTheme';

type Tab = 'kanban' | 'agents' | 'skills' | 'health' | 'activity' | 'convoys' | 'metrics' | 'costs' | 'handoffs' | 'settings';

const TAB_PATHS: Record<Tab, string> = {
  kanban: '/',
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
  return PATH_TO_TAB[path] || 'kanban';
}

const MIN_PANEL_WIDTH = 400;
const MAX_PANEL_WIDTH = 1200;
const DEFAULT_PANEL_WIDTH = 700;

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
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Theme management
  const { theme, toggleTheme, initTheme } = useTheme();

  // Initialize theme on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

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

  // Fetch agents to find if selected issue has an agent
  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 5000,
  });

  // Fetch issues to get issue URLs
  const { data: issues = [] } = useQuery({
    queryKey: ['issues'],
    queryFn: fetchIssues,
  });

  // Poll for pending confirmations
  const { data: confirmations = [] } = useQuery({
    queryKey: ['confirmations'],
    queryFn: fetchConfirmations,
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Show the most recent confirmation request
  useEffect(() => {
    if (confirmations.length > 0 && !currentConfirmation) {
      setCurrentConfirmation(confirmations[0]);
    }
  }, [confirmations, currentConfirmation]);

  // Find agent for selected issue
  const selectedIssueAgent = selectedIssue
    ? agents.find((a) => a.issueId?.toLowerCase() === selectedIssue.toLowerCase())
    : null;

  // Find issue URL for selected issue
  const selectedIssueData = selectedIssue
    ? issues.find((i) => i.identifier.toLowerCase() === selectedIssue.toLowerCase())
    : null;

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const newWidth = containerRect.right - e.clientX;
    setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, newWidth)));
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

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
      // Open search with '/' key (but not when typing in an input/textarea)
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
    setActiveTab('kanban'); // Switch to kanban tab if not already there
  }, []);

  // Calculate actual panel width (expanded = full width minus a small margin for kanban)
  const actualPanelWidth = isExpanded ? 'calc(100% - 300px)' : `${panelWidth}px`;

  return (
    <div className="h-screen bg-surface flex flex-col overflow-hidden transition-colors duration-150">
      <header className="bg-surface-raised border-b border-divider px-4 py-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab('kanban')}
            className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
            title="Go to Board"
          >
            <Eye className="w-5 h-5 text-blue-400" />
            <h1 className="text-lg font-bold text-content whitespace-nowrap">Panopticon</h1>
          </button>
          <CloisterStatusBar />
          <nav className="flex gap-0.5 overflow-x-auto min-w-0 scrollbar-hide">
            {([
              { id: 'kanban', label: 'Board', icon: LayoutGrid },
              { id: 'agents', label: 'Agents', icon: Users },
              { id: 'convoys', label: 'Convoys', icon: Users },
              { id: 'handoffs', label: 'Handoffs', icon: ArrowRightLeft },
              { id: 'activity', label: 'Activity', icon: Terminal },
              { id: 'metrics', label: 'Metrics', icon: BarChart3 },
              { id: 'costs', label: 'Costs', icon: DollarSign },
              { id: 'skills', label: 'Skills', icon: BookOpen },
              { id: 'health', label: 'Health', icon: Activity },
              { id: 'settings', label: 'Settings', icon: Settings },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
                  activeTab === id
                    ? 'bg-blue-600 text-white'
                    : 'text-content-subtle hover:text-content hover:bg-surface-overlay'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </nav>
          <button
            onClick={toggleTheme}
            className="ml-auto px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors text-content-subtle hover:text-content hover:bg-surface-overlay"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      <main ref={containerRef} className="flex-1 flex overflow-hidden">
        {activeTab === 'kanban' && (
          <>
            <div className={`flex-1 overflow-auto p-6 ${selectedIssue ? '' : 'w-full'}`}>
              <MetricsSummary />
              <KanbanBoard
                selectedIssue={selectedIssue}
                onSelectIssue={setSelectedIssue}
              />
            </div>
            {selectedIssue && selectedIssueData && (
              <>
                {/* Resize handle */}
                <div
                  onMouseDown={handleMouseDown}
                  className={`w-1 hover:w-1.5 bg-surface-overlay hover:bg-blue-500 cursor-col-resize transition-colors shrink-0 ${
                    isResizing ? 'bg-blue-500' : ''
                  }`}
                />
                <div style={{ width: actualPanelWidth }} className="relative shrink-0 h-full flex flex-col">
                  {/* Expand/collapse button */}
                  <button
                    onClick={toggleExpand}
                    className="absolute top-2 left-2 z-10 p-1.5 bg-surface-overlay hover:bg-surface-emphasis rounded text-content-subtle hover:text-content"
                    title={isExpanded ? 'Collapse panel' : 'Expand panel'}
                  >
                    {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                  <WorkspacePanel
                    agent={selectedIssueAgent ?? undefined}
                    issueId={selectedIssue}
                    issueUrl={selectedIssueData.url}
                    issue={selectedIssueData}
                    onClose={() => setSelectedIssue(null)}
                  />
                </div>
              </>
            )}
          </>
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
    </div>
  );
}
