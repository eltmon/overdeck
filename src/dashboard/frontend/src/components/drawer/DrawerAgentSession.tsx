/**
 * DrawerAgentSession — wires the IssueDrawer's Conversation and Terminal tabs
 * to a real agent session.
 *
 * The drawer is issue-scoped, so it picks one of the issue's agents (defaulting
 * to the active work agent) and renders either its JSONL transcript
 * (`<ConversationPanel>`) or its live tmux terminal (`<XTerminal>`). When the
 * issue has more than one agent — e.g. a swarm — a compact picker lets the user
 * switch between sessions; the selection is owned by `<IssueDrawer>` so it
 * survives a Conversation ⇄ Terminal tab switch.
 *
 * A work agent's `id` is both its tmux session name and its session-file key,
 * so a `Conversation` can be synthesized from the `Agent` alone — the same
 * shape `SessionPanel` synthesizes from a `SessionNode`.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitFork, TriangleAlert, AlertCircle, Wrench } from 'lucide-react';

import { ConversationPanel } from '../chat/ConversationPanel';
import type { Conversation } from '../CommandDeck/ConversationList';
import { XTerminal } from '../XTerminal';
import type { Agent } from '../../types';
import { useConversationUiState } from '../../hooks/useConversationUiState';
import styles from '../CommandDeck/styles/command-deck.module.css';

interface AgentGitInfo {
  actualBranch: string | null;
  branchDrifted: boolean;
  workspaceMissing: boolean;
  expectedBranch: string | null;
  workspacePath?: string | null;
}

async function fetchAgentGitInfo(agentId: string): Promise<AgentGitInfo | null> {
  const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/git-info`);
  if (!res.ok) return null;
  return res.json();
}

const ENDED_AGENT_STATUSES = new Set<Agent['status']>(['stopped', 'dead', 'failed']);

function isEndedAgent(agent: Agent): boolean {
  return ENDED_AGENT_STATUSES.has(agent.status);
}

/**
 * Pick the agent the drawer should show by default: the active work agent,
 * then any work agent, then any active agent, then whatever exists.
 */
export function pickDefaultDrawerAgent(agents: readonly Agent[]): Agent | null {
  const live = agents.filter((agent) => !isEndedAgent(agent));
  return (
    live.find((agent) => agent.role === 'work')
    ?? agents.find((agent) => agent.role === 'work')
    ?? live[0]
    ?? agents[0]
    ?? null
  );
}

/** Synthesize a Conversation from an Agent so ConversationPanel can render it. */
function agentToConversation(agent: Agent): Conversation {
  const ended = isEndedAgent(agent);
  return {
    id: -1,
    name: agent.id,
    tmuxSession: agent.id,
    status: ended ? 'ended' : 'active',
    cwd: agent.workspace ?? '',
    issueId: agent.issueId ?? null,
    createdAt: agent.startedAt,
    // ConversationPanel reads `!sessionAlive && !endedAt` as "still spawning"
    // and shows a "Starting…" placeholder over the transcript — an ended agent
    // must report a non-null endedAt, so fall back to lastActivity/startedAt.
    endedAt: ended ? (agent.lastActivity ?? agent.startedAt) : null,
    lastAttachedAt: null,
    sessionAlive: !ended,
    sessionFile: agent.id,
    model: agent.model,
    // The agent snapshot carries the harness in `runtime` (claude-code|pi|codex);
    // `harness` itself is not on AgentSnapshot. Fall back to runtime so the
    // synthetic conversation is correctly tagged — this drives the RPC terminal
    // notice and pi/codex live streaming (PAN-1908).
    harness: ((agent.harness ?? agent.runtime) as Conversation['harness']) ?? null,
  };
}

function agentOptionLabel(agent: Agent): string {
  const slotMatch = /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(agent.id);
  if (slotMatch) return `Slot ${slotMatch[1]} · ${agent.id}`;

  const role = agent.role ? `${agent.role[0]!.toUpperCase()}${agent.role.slice(1)}` : 'Agent';
  return `${role} · ${agent.id}`;
}

interface DrawerAgentSessionProps {
  view: 'conversation' | 'terminal';
  agents: readonly Agent[];
  /** The agent to display — resolved by IssueDrawer, shared across both tabs. */
  agentId: string | null;
  onSelectAgent: (agentId: string) => void;
}

export function DrawerAgentSession({ view, agents, agentId, onSelectAgent }: DrawerAgentSessionProps) {
  const testId = `drawer-tab-panel-${view}`;

  const agent = useMemo(
    () => agents.find((candidate) => candidate.id === agentId) ?? null,
    [agents, agentId],
  );
  const conversation = useMemo(() => (agent ? agentToConversation(agent) : null), [agent]);

  // Tool-call visibility toggle for the embedded ConversationPanel. Keyed by
  // agent.id (== session name) so it matches SessionPanel's key for the same
  // agent and the standalone conversation view. (PAN-XXXX)
  const { hideToolCalls, toggleHideToolCalls } = useConversationUiState(agent?.id ?? '');

  // PAN-1523: surface the agent's actual branch + drift/missing-workspace
  // state. ConversationPanel is embedded here so its own header is hidden;
  // the chip lives in the drawer toolbar instead.
  const { data: gitInfo } = useQuery({
    queryKey: ['agent-git-info', agent?.id],
    queryFn: () => (agent ? fetchAgentGitInfo(agent.id) : Promise.resolve(null)),
    enabled: !!agent,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  if (!agent || !conversation) {
    return (
      <div
        data-testid={testId}
        className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px]"
      >
        <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {view === 'conversation' ? 'Conversation' : 'Terminal'}
        </div>
        <p className="text-[13px] leading-6 text-muted-foreground">
          No agent session for this issue yet. The {view === 'conversation' ? 'transcript' : 'live terminal'} appears here once an agent starts.
        </p>
      </div>
    );
  }

  const showBranchChip = Boolean(gitInfo?.actualBranch || gitInfo?.workspaceMissing);
  const drifted = Boolean(gitInfo?.branchDrifted);
  const missing = Boolean(gitInfo?.workspaceMissing);

  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col gap-[10px]">
      <div className="flex shrink-0 items-center gap-[8px]">
        {agents.length > 1 && (
          <>
            <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Agent
            </span>
            <select
              value={agent.id}
              onChange={(event) => onSelectAgent(event.target.value)}
              aria-label="Select agent session"
              className="rounded-[var(--radius-sm)] border border-border bg-card px-[8px] py-[4px] text-[12px] text-foreground"
            >
              {agents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {agentOptionLabel(candidate)}
                </option>
              ))}
            </select>
          </>
        )}
        {showBranchChip && (
          <span
            className={`${styles.terminalBranchBar} ${
              missing
                ? styles.terminalBranchBarMissing
                : drifted
                  ? styles.terminalBranchBarDrift
                  : ''
            }`}
            title={
              missing
                ? `Workspace missing on disk: ${gitInfo?.workspacePath ?? '(unknown path)'}`
                : drifted
                  ? `Expected ${gitInfo?.expectedBranch ?? '(none)'}, on ${gitInfo?.actualBranch ?? '(none)'}`
                  : `${gitInfo?.workspacePath ?? ''}`
            }
            data-testid="drawer-agent-branch-chip"
          >
            {missing ? (
              <>
                <AlertCircle size={12} />
                <span className={styles.terminalBranchBarMode}>Worktree missing</span>
              </>
            ) : (
              <>
                {drifted ? <TriangleAlert size={12} /> : <GitFork size={12} />}
                <span className={styles.terminalBranchBarMode}>
                  {drifted ? 'Drifted' : 'Worktree'}
                </span>
                <span className={styles.terminalBranchBarText}>{gitInfo?.actualBranch}</span>
              </>
            )}
          </span>
        )}
        <button
          type="button"
          className={`ml-auto ${styles.conversationAboutToggle} ${hideToolCalls ? styles.conversationAboutToggleActive : ''}`}
          onClick={toggleHideToolCalls}
          title={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
          aria-label={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
          aria-pressed={hideToolCalls}
        >
          <Wrench size={14} />
          <span>Tools</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-border">
        {view === 'conversation' ? (
          <ConversationPanel
            key={agent.id}
            conversation={conversation}
            viewMode="conversation"
            embedded
            agentId={agent.id}
            hideToolCalls={hideToolCalls}
            onToggleHideToolCalls={toggleHideToolCalls}
          />
        ) : isEndedAgent(agent) ? (
          <div className="flex h-full items-center justify-center p-[18px] text-[13px] text-muted-foreground">
            Session ended — no live terminal to attach.
          </div>
        ) : (
          <XTerminal key={agent.id} sessionName={agent.id} />
        )}
      </div>
    </div>
  );
}
