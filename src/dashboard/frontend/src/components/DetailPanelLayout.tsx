import { useState, useEffect, useCallback } from 'react';
// react-resizable-panels v4 exports: Group, Panel, Separator (NOT PanelGroup/PanelResizeHandle)
// v4 props: orientation (NOT direction), onLayoutChanged (NOT onLayout)
import { Panel, Group, Separator } from 'react-resizable-panels';
import { useQuery } from '@tanstack/react-query';
import { InspectorPanel } from './InspectorPanel';
import { TerminalPanel } from './TerminalPanel';
import { TerminalTabs, savePinState, loadPinState } from './inspector/TerminalTabs';
import { MergedSummaryCard } from './inspector/MergedSummaryCard';
import { usePipelinePhase } from './inspector/usePipelinePhase';
import { Agent, Issue } from '../types';
import type { ReviewStatus, WorkspaceInfo } from './inspector/types';
import { useDashboardStore, selectReviewStatus } from '../lib/store';

type PanelMode = 'closed' | 'inspector-only' | 'inspector+terminal';

interface PanelState {
  panelMode: PanelMode;
  inspectorDefaultSize: string; // e.g. "35%" of the panel group
  panelWidth?: number; // outer panel width in px, user-resizable
}

const DEFAULT_INSPECTOR_SIZE = '35%';

function loadPanelState(issueId: string): PanelState {
  try {
    const key = `pan-panel-state-${issueId}`;
    const raw = localStorage.getItem(key) || localStorage.getItem('pan-panel-state-default');
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return { panelMode: 'inspector+terminal', inspectorDefaultSize: DEFAULT_INSPECTOR_SIZE };
}

function savePanelState(issueId: string, state: Partial<PanelState>): void {
  try {
    const key = `pan-panel-state-${issueId}`;
    const existing = loadPanelState(issueId);
    localStorage.setItem(key, JSON.stringify({ ...existing, ...state }));
  } catch {
    // ignore storage errors
  }
}

export interface DetailPanelLayoutProps {
  agent?: Agent;
  workAgents?: Agent[];
  issueId: string;
  issueUrl?: string;
  issue?: Issue;
  onClose: () => void;
  /** When true, don't render the terminal — another component (e.g. PlanDialog) owns it */
  suppressTerminal?: boolean;
  /** When true, render as inline content (no border-l, drag handle, or fixed width) */
  inline?: boolean;
}

export function DetailPanelLayout({ agent, workAgents = [], issueId, issueUrl, issue, onClose, suppressTerminal, inline }: DetailPanelLayoutProps) {
  const [panelState, setPanelState] = useState<PanelState>(() => loadPanelState(issueId));
  const [isResizing, setIsResizing] = useState(false);

  // Read review status from the Zustand store — populated by Effect RPC domain
  // events (review.status_changed). Single source of truth, no polling.
  const reviewStatus = useDashboardStore(selectReviewStatus(issueId)) as ReviewStatus | undefined;
  const reviewStatusLoading = false;

  const { data: costData } = useQuery<{ totalCost?: number }>({
    queryKey: ['issueCosts', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/issues/${issueId}/costs`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: reviewStatus?.mergeStatus === 'merged',
    staleTime: 60000,
  });

  // Use repo name from sourceRepo (e.g. "eltmon/panopticon-cli" → "panopticon-cli")
  // as the specialist session key. project.id includes "github-{owner}-" prefix which
  // doesn't match the tmux session naming used by getTmuxSessionName.
  const projectKey = issue?.sourceRepo ? issue.sourceRepo.split('/')[1] : undefined;
  const { phase, activeSession, availableTerminals, markSessionDead } = usePipelinePhase({
    issueId,
    agent,
    workAgents,
    reviewStatus,
    projectKey,
  });

  // Shares cache key with InspectorPanel's workspace query — no extra network request
  const { data: workspaceData } = useQuery<WorkspaceInfo>({
    queryKey: ['workspace', issueId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${issueId}`);
      if (!res.ok) throw new Error('Failed to fetch workspace info');
      return res.json();
    },
    enabled: phase === 'merged',
    staleTime: 30000,
  });

  // Pinned session state: null = auto-follow, string = pinned to that session
  const [pinnedSession, setPinnedSession] = useState<string | null>(() =>
    loadPinState(issueId),
  );
  const [pinned, setPinned] = useState(() => loadPinState(issueId) !== null);

  // The currently displayed session: pinned overrides auto
  const selectedSession = pinned ? pinnedSession : activeSession;

  const handleSelectSession = useCallback((sessionName: string | null) => {
    setPinnedSession(sessionName);
    savePinState(issueId, sessionName);
  }, [issueId]);

  const handleTogglePin = useCallback(() => {
    setPinned(prev => {
      const next = !prev;
      if (!next) {
        // Un-pinning: clear pin from localStorage
        savePinState(issueId, null);
        setPinnedSession(null);
      } else if (activeSession) {
        // Engaging pin: capture the currently-displayed session and persist it
        setPinnedSession(activeSession);
        savePinState(issueId, activeSession);
      } else {
        // No active session to pin — no-op, stay in auto-follow mode
        return prev;
      }
      return next;
    });
  }, [issueId, activeSession]);


  // Reset panel state when issue changes
  useEffect(() => {
    setPanelState(loadPanelState(issueId));
  }, [issueId]);

  // Reset pin state when issue changes
  useEffect(() => {
    const saved = loadPinState(issueId);
    setPinnedSession(saved);
    setPinned(saved !== null);
  }, [issueId]);

  // Validate pinned session against available terminals. If the pinned session
  // is no longer in the tabs (e.g. review ended, merge session changed from
  // merge-agent to work-agent for monorepo), fall back to auto-follow.
  useEffect(() => {
    if (!pinned || !pinnedSession) return;
    if (availableTerminals.length === 0) return; // loading state — don't clear
    const tab = availableTerminals.find(t => t.sessionName === pinnedSession);
    if (!tab || tab.disabled) {
      setPinned(false);
      setPinnedSession(null);
      savePinState(issueId, null);
    }
  }, [availableTerminals, pinned, pinnedSession, issueId]);

  const openTerminal = useCallback(() => {
    setPanelState(prev => {
      const newState: PanelState = { ...prev, panelMode: 'inspector+terminal' };
      savePanelState(issueId, newState);
      return newState;
    });
  }, [issueId]);

  const closeTerminal = useCallback(() => {
    setPanelState(prev => {
      const newState: PanelState = { ...prev, panelMode: 'inspector-only' };
      savePanelState(issueId, newState);
      return newState;
    });
  }, [issueId]);

  const onViewMergeLog = useCallback(() => {
    const mergeTab = availableTerminals.find(t => t.id === 'merging' && !t.disabled);
    if (!mergeTab?.sessionName) return;
    openTerminal();
    handleSelectSession(mergeTab.sessionName);
    setPinned(true);
  }, [availableTerminals, openTerminal, handleSelectSession]);

  if (panelState.panelMode === 'closed') return null;

  const showTerminal = panelState.panelMode === 'inspector+terminal' && !!agent && !suppressTerminal;
  const defaultWidth = showTerminal ? 760 : 360;
  const minWidth = showTerminal ? 480 : 280;
  const maxWidth = 1200;
  const currentWidth = Math.max(minWidth, Math.min(maxWidth, panelState.panelWidth ?? defaultWidth));

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentWidth;
    let latestWidth = startWidth;
    setIsResizing(true);

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX; // dragging left = growing the panel
      latestWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta));
      setPanelState(prev => ({ ...prev, panelWidth: latestWidth }));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      savePanelState(issueId, { panelWidth: latestWidth });
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const innerContent = showTerminal ? (
    <Group
      orientation="horizontal"
      onLayoutChanged={(layout) => {
        const inspectorSize = layout['inspector'];
        if (inspectorSize != null) {
          savePanelState(issueId, { inspectorDefaultSize: `${inspectorSize}%` });
        }
      }}
      style={{ width: '100%', height: '100%' }}
    >
      <Panel
        id="inspector"
        defaultSize={panelState.inspectorDefaultSize}
        minSize="20%"
        maxSize="60%"
      >
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <InspectorPanel
            key={issueId}
            agent={agent}
            workAgents={workAgents}
            issueId={issueId}
            issueUrl={issueUrl}
            issue={issue}
            phase={phase}
            reviewStatus={reviewStatus}
            reviewStatusLoading={reviewStatusLoading}
            onClose={onClose}
            onOpenTerminal={openTerminal}
            onViewMergeLog={onViewMergeLog}
          />
        </div>
      </Panel>

      <Separator
        style={{
          width: '4px',
          backgroundColor: '#232f48',
          cursor: 'col-resize',
          flexShrink: 0,
        }}
      />

      <Panel id="terminal" minSize="30%">
        <div className="flex flex-col" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          {availableTerminals.length > 0 && (
            <TerminalTabs
              issueId={issueId}
              tabs={availableTerminals}
              selectedSession={selectedSession}
              activePhase={phase}
              pinned={pinned}
              onSelectSession={handleSelectSession}
              onTogglePin={handleTogglePin}
            />
          )}
          <div className="flex-1 min-h-0">
            {phase === 'merged' && !(pinned && pinnedSession) ? (
              <MergedSummaryCard
                mergedAt={reviewStatus?.updatedAt ?? new Date().toISOString()}
                prUrl={workspaceData?.mrUrl ?? null}
                totalCost={costData?.totalCost}
                onViewLastLog={
                  availableTerminals.some(t => t.id === 'merging' && !t.disabled)
                    ? () => {
                        const mergeTab = availableTerminals.find(t => t.id === 'merging');
                        if (mergeTab?.sessionName) {
                          handleSelectSession(mergeTab.sessionName);
                          setPinned(true);
                        }
                      }
                    : null
                }
              />
            ) : selectedSession ? (
              <TerminalPanel
                key={selectedSession}
                agent={agent}
                onClose={closeTerminal}
                sessionName={selectedSession}
                title={selectedSession}
                onSessionEnded={markSessionDead}
              />
            ) : (
              <TerminalPanel key={agent.id} agent={agent} onClose={closeTerminal} />
            )}
          </div>
        </div>
      </Panel>
    </Group>
  ) : (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <InspectorPanel
        key={issueId}
        agent={agent}
        workAgents={workAgents}
        issueId={issueId}
        issueUrl={issueUrl}
        issue={issue}
        phase={phase}
        reviewStatus={reviewStatus}
        reviewStatusLoading={reviewStatusLoading}
        onClose={onClose}
        onOpenTerminal={agent ? openTerminal : undefined}
        onViewMergeLog={onViewMergeLog}
      />
    </div>
  );

  if (inline) {
    return innerContent;
  }

  return (
    <div
      className="relative flex h-full border-l shrink-0"
      style={{
        borderColor: '#232f48',
        width: `${currentWidth}px`,
        transition: isResizing ? 'none' : 'width 200ms ease',
      }}
    >
      {/* Drag handle on left edge */}
      <div
        className="absolute top-0 bottom-0 z-10 hover:bg-[#2769ec]/30 active:bg-[#2769ec]/50 transition-colors"
        style={{ left: -2, width: 4, cursor: 'col-resize' }}
        onMouseDown={handleResizeMouseDown}
      />

      {innerContent}
    </div>
  );
}
