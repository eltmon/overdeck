import { useState, useEffect, useCallback } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import { InspectorPanel } from './InspectorPanel';
import { TerminalPanel } from './TerminalPanel';
import { Agent, Issue } from '../types';

type PanelMode = 'closed' | 'inspector-only' | 'inspector+terminal';

interface PanelState {
  panelMode: PanelMode;
  inspectorDefaultSize: string; // e.g. "35%" of the panel group
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
  return { panelMode: 'inspector-only', inspectorDefaultSize: DEFAULT_INSPECTOR_SIZE };
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
}

export function DetailPanelLayout({ agent, issueId, issueUrl, issue, onClose }: DetailPanelLayoutProps) {
  const [panelState, setPanelState] = useState<PanelState>(() => loadPanelState(issueId));

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

  const showTerminal = panelState.panelMode === 'inspector+terminal' && !!agent;

  return (
    <div
      className="flex h-full border-l shrink-0"
      style={{
        borderColor: '#232f48',
        width: showTerminal ? '760px' : '360px',
        minWidth: showTerminal ? '480px' : '280px',
        maxWidth: showTerminal ? '1100px' : '520px',
        transition: 'width 200ms ease',
      }}
    >
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
              <TerminalPanel agent={agent} onClose={closeTerminal} />
            </div>
          </Panel>
        </Group>
      ) : (
        <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
          <InspectorPanel
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
