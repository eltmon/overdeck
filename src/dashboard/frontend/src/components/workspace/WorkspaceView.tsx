/**
 * PAN-1990 dashboard-workspace-view: /workspace/:id — terminal, workspace-
 * filtered conversations, and the memory surface for a single workspace.
 *
 * Terminal discovery: `agents.workspace_id` does not exist yet (see
 * src/lib/overdeck/infra.ts's PAN-1990 sentinel comment) — deferred
 * intentionally until agent-to-workspace linkage is built. Issue-kind
 * workspaces resolve their terminal via the existing agent.issueId match
 * (same join Sidebar.tsx already uses for the pipeline-phase badge);
 * main/scratch workspaces have no single canonical agent terminal — their
 * sessions live on individual conversations, reachable through the
 * conversations panel below.
 *
 * Conversation filtering: conversations are scoped to this workspace by
 * `conversation.workspaceId` (FR-15/AC-11) when set. A conversation that
 * predates the PAN-1990 linkage (workspaceId null) falls back to the
 * cwd-prefix match CommandDeck/index.tsx already uses for project scoping —
 * this is the only case cwd containment should decide membership, since a
 * main workspace's path is a prefix of every issue workspace path beneath it
 * (ConversationList's `includeIds` prop already supports this — no changes
 * needed to ConversationList or ConversationPanel).
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Group, Panel, Separator, useDefaultLayout, type LayoutStorage } from 'react-resizable-panels';
import { ConversationList, fetchConversations, type Conversation } from '../CommandDeck/ConversationList';
import { ConversationPanel } from '../chat/ConversationPanel';
import { XTerminal } from '../XTerminal';
import { WorkspaceActionBand, recallRunSession, rememberRunSession } from './WorkspaceActionBand';
import { XBriefViewer } from '../xbrief/XBriefViewer';
import type { XBriefDocument } from '../xbrief/types';
import { VerificationGates } from '../issue-view/VerificationGates';
import { useDashboardStore, selectAgents } from '../../lib/store';
import type { Agent } from '../../types';

interface WorkspacePipelineBadge {
  reviewStatus?: string;
  testStatus?: string;
  mergeStatus?: string;
  verificationStatus?: string;
  readyForMerge?: boolean;
}

interface WorkspaceRegistryDetail {
  id: string;
  projectId: string;
  kind: 'main' | 'issue' | 'scratch';
  name: string;
  path: string;
  issueId: string | null;
  layoutConfig: string | null;
  title: string | null;
  pipeline: WorkspacePipelineBadge | null;
  /** PAN-3331 quick-action band inputs. */
  isGitRepository?: boolean;
  runCommand?: string | null;
  runCommandDefault?: string | null;
  runCommandOptions?: Array<{ name: string; command: string }>;
  openInEditorConfigured?: boolean;
}

interface WorkspaceMemoryStatus {
  headline: string;
  summary: string;
  phase: string;
  /** Synthesis confidence, surfaced beside the phase in the Memory header (PAN-3286 FR-12). */
  confidence?: number;
  nextSteps: string[];
}

interface WorkspaceMemoryObservation {
  id: string;
  timestamp: string;
  summary: string;
  actionStatus: string | null;
}

interface WorkspaceMemoryResponse {
  headline: string | null;
  status: WorkspaceMemoryStatus | null;
  observations: WorkspaceMemoryObservation[];
}

export interface WorkspaceViewProps {
  workspaceId: string;
  onBack?: () => void;
}

function isUnderWorkspacePath(cwd: string, workspacePath: string): boolean {
  return cwd === workspacePath || cwd.startsWith(workspacePath.endsWith('/') ? workspacePath : `${workspacePath}/`);
}

export function WorkspaceView({ workspaceId, onBack }: WorkspaceViewProps) {
  const { data: workspace } = useQuery({
    queryKey: ['workspace-registry', workspaceId],
    queryFn: async (): Promise<WorkspaceRegistryDetail | null> => {
      const res = await fetch(`/api/workspace-registry/${workspaceId}`);
      if (!res.ok) return null;
      return res.json() as Promise<WorkspaceRegistryDetail>;
    },
  });

  const { data: memory } = useQuery({
    queryKey: ['workspace-registry', workspaceId, 'memory'],
    queryFn: async (): Promise<WorkspaceMemoryResponse | null> => {
      const res = await fetch(`/api/workspace-registry/${workspaceId}/memory`);
      if (!res.ok) return null;
      return res.json() as Promise<WorkspaceMemoryResponse>;
    },
    refetchInterval: 15000,
    enabled: !!workspace,
  });

  const { data: xbriefDoc } = useQuery({
    queryKey: ['workspace-plan', workspace?.issueId],
    queryFn: async (): Promise<XBriefDocument | null> => {
      if (!workspace?.issueId) return null;
      const res = await fetch(`/api/workspaces/${workspace.issueId}/plan`);
      if (!res.ok) return null;
      return res.json() as Promise<XBriefDocument>;
    },
    enabled: !!workspace?.issueId,
  });

  const { data: conversationsRaw } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
    refetchInterval: 10000,
  });
  const conversations: Conversation[] = Array.isArray(conversationsRaw) ? conversationsRaw : [];

  const [showAllConversations, setShowAllConversations] = useState(false);
  const includeIds = useMemo(() => {
    if (showAllConversations || !workspace) return undefined;
    const ids = new Set<number>();
    for (const conv of conversations) {
      const matches = conv.workspaceId != null
        ? conv.workspaceId === workspaceId
        : isUnderWorkspacePath(conv.cwd, workspace.path);
      if (matches) ids.add(conv.id);
    }
    return ids;
  }, [showAllConversations, workspace, workspaceId, conversations]);

  // Lifted so the band can start/stop the run session while its terminal lives
  // in the panel area below (PAN-3331 D-5).
  const [runSessionName, setRunSessionNameState] = useState<string | null>(() => recallRunSession(workspaceId));
  const setRunSessionName = useCallback((sessionName: string | null) => {
    rememberRunSession(workspaceId, sessionName);
    setRunSessionNameState(sessionName);
  }, [workspaceId]);

  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const selectedConversationObj = conversations.find((c) => c.name === selectedConversation) ?? null;

  const agents = useDashboardStore(selectAgents) as unknown as Agent[];
  const workspaceAgent = useMemo(() => {
    if (!workspace?.issueId) return null;
    const key = workspace.issueId.toLowerCase();
    return agents.find((a) => a.issueId?.toLowerCase() === key) ?? null;
  }, [agents, workspace]);

  const layoutStorage = useMemo<LayoutStorage>(() => {
    let cached: string | null = workspace?.layoutConfig ?? null;
    return {
      getItem: () => cached,
      setItem: (_key: string, value: string) => {
        cached = value;
        let layout: unknown;
        try {
          layout = JSON.parse(value);
        } catch {
          return;
        }
        void fetch(`/api/workspace-registry/${workspaceId}/layout`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout }),
        });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- layoutConfig read only once on first successful workspace fetch, not on every change
  }, [workspaceId, workspace !== undefined]);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: `workspace-${workspaceId}`, storage: layoutStorage });

  if (!workspace) {
    return <div className="p-6 text-sm text-muted-foreground" data-testid="workspace-view-loading">Loading workspace…</div>;
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" data-testid="workspace-view">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
        {onBack && (
          <button type="button" onClick={onBack} data-testid="workspace-view-back" className="text-muted-foreground hover:text-foreground text-sm">
            ← Back
          </button>
        )}
        <span className="text-sm font-medium text-foreground truncate">{workspace.title ?? workspace.name}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{workspace.kind}</span>
      </div>

      <WorkspaceActionBand
        workspaceId={workspaceId}
        kind={workspace.kind}
        issueId={workspace.issueId}
        isGitRepository={workspace.isGitRepository !== false}
        runCommand={workspace.runCommand ?? null}
        runCommandDefault={workspace.runCommandDefault ?? null}
        runCommandOptions={workspace.runCommandOptions ?? []}
        openInEditorConfigured={workspace.openInEditorConfigured === true}
        runSessionName={runSessionName}
        onRunSessionChange={setRunSessionName}
      />

      {workspace.kind === 'issue' && workspace.issueId && (
        <div className="border-b border-border p-3 space-y-3 shrink-0 max-h-64 overflow-y-auto" data-testid="workspace-view-issue-panels">
          <VerificationGates issueId={workspace.issueId} />
          <XBriefViewer doc={xbriefDoc ?? null} showTabBar={false} />
        </div>
      )}

      <Group
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        className="flex-1 min-h-0"
        id={`workspace-${workspaceId}`}
      >
        <Panel id="terminal" defaultSize={34} minSize={15} className="min-w-0 h-full overflow-hidden flex flex-col">
          {/* The run session (PAN-3331) shares this panel with the agent
              terminal rather than displacing it: main/scratch workspaces have
              no agent terminal, so the run session simply fills the panel. */}
          {workspaceAgent ? (
            <div className="flex-1 min-h-0">
              <XTerminal sessionName={workspaceAgent.id} embedded />
            </div>
          ) : !runSessionName ? (
            <div className="p-4 text-xs text-muted-foreground" data-testid="workspace-view-no-terminal">
              No active agent terminal for this workspace.
            </div>
          ) : null}
          {runSessionName && (
            <div className="flex-1 min-h-0 flex flex-col border-t border-border first:border-t-0" data-testid="workspace-view-run-terminal">
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground px-3 py-1 shrink-0">
                Run
              </span>
              <div className="flex-1 min-h-0">
                <XTerminal sessionName={runSessionName} embedded />
              </div>
            </div>
          )}
        </Panel>
        <Separator className="w-px bg-border" />
        <Panel id="conversations" defaultSize={33} minSize={15} className="min-w-0 h-full overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Conversations</span>
            <button
              type="button"
              data-testid="workspace-view-all-conversations-toggle"
              onClick={() => setShowAllConversations((prev) => !prev)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              {showAllConversations ? 'This workspace' : 'All conversations'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selectedConversationObj ? (
              <div className="flex flex-col h-full">
                <button
                  type="button"
                  data-testid="workspace-view-conversation-back"
                  onClick={() => setSelectedConversation(null)}
                  className="text-left px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground border-b border-border shrink-0"
                >
                  ← All conversations
                </button>
                <div className="flex-1 min-h-0">
                  <ConversationPanel conversation={selectedConversationObj} embedded />
                </div>
              </div>
            ) : (
              <ConversationList
                selectedConversation={selectedConversation}
                onSelectConversation={setSelectedConversation}
                includeIds={includeIds}
              />
            )}
          </div>
        </Panel>
        <Separator className="w-px bg-border" />
        <Panel id="memory" defaultSize={33} minSize={15} className="min-w-0 h-full overflow-y-auto p-3">
          {/* PAN-3286 FR-12: the memory-synthesized phase and its confidence sit
              in the section header, so the panel says what this workspace is
              doing before you read the headline. */}
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Memory
            {memory?.status && (
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70" data-testid="workspace-view-memory-phase">
                {memory.status.phase}
                {typeof memory.status.confidence === 'number' && ` · confidence ${memory.status.confidence}`}
              </span>
            )}
          </p>
          {memory?.status ? (
            <div className="space-y-2" data-testid="workspace-view-memory-status">
              <p className="text-sm text-foreground">{memory.status.headline}</p>
              <p className="text-xs text-muted-foreground">{memory.status.summary}</p>
              {memory.status.nextSteps.length > 0 && (
                <ul className="text-xs text-muted-foreground list-disc pl-4">
                  {memory.status.nextSteps.map((step) => <li key={step}>{step}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70">No memory status yet.</p>
          )}
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-4 mb-2">Observations</p>
          <ul className="space-y-2" data-testid="workspace-view-observation-timeline">
            {(memory?.observations ?? []).map((obs) => (
              <li key={obs.id} className="text-xs text-muted-foreground border-l-2 border-border pl-2">
                <span className="text-[10px] text-muted-foreground/70">{obs.timestamp}</span>
                <p className="text-foreground">{obs.actionStatus ?? obs.summary}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </Group>
    </div>
  );
}
