import { useState, useEffect, useCallback } from 'react';
// react-resizable-panels v4 exports: Group, Panel, Separator (NOT PanelGroup/PanelResizeHandle)
// v4 props: orientation (NOT direction), onLayoutChanged (NOT onLayout)
import { Panel, Group, Separator } from 'react-resizable-panels';
import { InspectorPanel } from './InspectorPanel';
import { TerminalPanel } from './TerminalPanel';
import { Agent, Issue } from '../types';

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
  issueId: string;
  issueUrl?: string;
  issue?: Issue;
  onClose: () => void;
  /** When true, don't render the terminal — another component (e.g. PlanDialog) owns it */
  suppressTerminal?: boolean;
}

export function DetailPanelLayout({ agent, issueId, issueUrl, issue, onClose, suppressTerminal }: DetailPanelLayoutProps) {
  const [panelState, setPanelState] = useState<PanelState>(() => loadPanelState(issueId));
  const [isResizing, setIsResizing] = useState(false);

  // Reset panel state when issue changes
  useEffect(() => {
    setPanelState(loadPanelState(issueId));
  }, [issueId]);

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

      {showTerminal ? (
        <Group
          orientation="horizontal"
          onLayoutChanged={(layout) => {
            // layout is a map of panel id -> flexGrow value
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
                issueId={issueId}
                issueUrl={issueUrl}
                issue={issue}
                onClose={onClose}
                onOpenTerminal={openTerminal}
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
            <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
              <TerminalPanel key={agent.id} agent={agent} onClose={closeTerminal} />
            </div>
          </Panel>
        </Group>
      ) : (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <InspectorPanel
            key={issueId}
            agent={agent}
            issueId={issueId}
            issueUrl={issueUrl}
            issue={issue}
            onClose={onClose}
            onOpenTerminal={agent ? openTerminal : undefined}
          />
        </div>
      )}
    </div>
  );
}
