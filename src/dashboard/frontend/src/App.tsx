import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KanbanBoard } from './components/KanbanBoard';
import { AgentList } from './components/AgentList';
import { TerminalView } from './components/TerminalView';
import { HealthDashboard } from './components/HealthDashboard';
import { SkillsList } from './components/SkillsList';
import { WorkspacePanel } from './components/WorkspacePanel';
import { IssueDetailPanel } from './components/IssueDetailPanel';
import { ActivityPanel } from './components/ActivityPanel';
import { ConvoyPanel } from './components/ConvoyPanel';
import { CloisterStatusBar } from './components/CloisterStatusBar';
import { HandoffsPage } from './components/HandoffsPage';
import { ConfirmationDialog, ConfirmationRequest } from './components/ConfirmationDialog';
import { MetricsSummary } from './components/MetricsSummary';
import { MetricsPage } from './components/MetricsPage';
import { SearchModal } from './components/search/SearchModal';
import { Eye, LayoutGrid, Users, Activity, BookOpen, Terminal, Maximize2, Minimize2, BarChart3, ArrowRightLeft } from 'lucide-react';
import { Agent, Issue } from './types';

type Tab = 'kanban' | 'agents' | 'skills' | 'health' | 'activity' | 'convoys' | 'metrics' | 'handoffs';

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
  const [activeTab, setActiveTab] = useState<Tab>('kanban');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentConfirmation, setCurrentConfirmation] = useState<ConfirmationRequest | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div className="h-screen bg-gray-900 flex flex-col overflow-hidden">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <Eye className="w-6 h-6 text-blue-400" />
              <h1 className="text-xl font-bold text-white">Panopticon</h1>
            </div>
            <CloisterStatusBar />
          </div>
          <nav className="flex gap-2">
            {([
              { id: 'kanban', label: 'Board', icon: LayoutGrid },
              { id: 'agents', label: 'Agents', icon: Users },
              { id: 'convoys', label: 'Convoys', icon: Users },
              { id: 'handoffs', label: 'Handoffs', icon: ArrowRightLeft },
              { id: 'activity', label: 'Activity', icon: Terminal },
              { id: 'metrics', label: 'Metrics', icon: BarChart3 },
              { id: 'skills', label: 'Skills', icon: BookOpen },
              { id: 'health', label: 'Health', icon: Activity },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activeTab === id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </nav>
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
            {selectedIssue && selectedIssueAgent && (
              <>
                {/* Resize handle */}
                <div
                  onMouseDown={handleMouseDown}
                  className={`w-1 hover:w-1.5 bg-gray-700 hover:bg-blue-500 cursor-col-resize transition-colors shrink-0 ${
                    isResizing ? 'bg-blue-500' : ''
                  }`}
                />
                <div style={{ width: actualPanelWidth }} className="relative shrink-0 h-full flex flex-col">
                  {/* Expand/collapse button */}
                  <button
                    onClick={toggleExpand}
                    className="absolute top-2 left-2 z-10 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                    title={isExpanded ? 'Collapse panel' : 'Expand panel'}
                  >
                    {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>
                  <WorkspacePanel
                    agent={selectedIssueAgent}
                    issueId={selectedIssue}
                    issueUrl={selectedIssueData?.url}
                    onClose={() => setSelectedIssue(null)}
                  />
                </div>
              </>
            )}
            {selectedIssue && !selectedIssueAgent && selectedIssueData && (
              <div className="w-[400px] shrink-0 h-full">
                <IssueDetailPanel
                  issue={selectedIssueData}
                  onClose={() => setSelectedIssue(null)}
                />
              </div>
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
        {activeTab === 'handoffs' && (
          <div className="w-full overflow-auto">
            <HandoffsPage />
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
