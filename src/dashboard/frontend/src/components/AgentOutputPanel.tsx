/**
 * AgentOutputPanel - Activity/Terminal split view for agents and specialists.
 *
 * For specialists:
 *   - Running: shows live XTerminal (same as review agent in Image 1)
 *   - Down: shows ConversationPanel with JSONL (same as Command Deck in Image 2)
 *
 * For work agents: Activity shows the issue conversation, Terminal shows XTerminal.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Folder, GitFork, TriangleAlert, AlertCircle } from 'lucide-react';
import { XTerminal } from './XTerminal';
import { ActivityView } from './CommandDeck/ActivityView';
import { ConversationPanel } from './chat/ConversationPanel';
import type { Conversation } from './CommandDeck/ConversationList';
import { useDashboardStore, selectAgentById } from '../lib/store';
import styles from './CommandDeck/styles/command-deck.module.css';

async function fetchAgentConversation(agentId: string): Promise<Conversation | null> {
  // The list endpoint (/api/conversations) filters out agent/planning/specialist
  // rows so the human conversations sidebar stays clean. AgentOutputPanel needs
  // the row anyway for its liveness signal — fetch it directly by name.
  const res = await fetch(`/api/conversations/${encodeURIComponent(agentId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch conversation for ${agentId}`);
  return res.json();
}

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

interface AgentOutputPanelProps {
  agentId: string;
}

// Parse specialist/role-run tmux session names.
//
// New pattern (PAN-1048+): agent-{projectKey}-{issueId}(-{subrole})?
//   e.g. agent-pan-1069-review, agent-pan-1069-review-correctness, agent-pan-1069-test
//
// Legacy pattern: specialist-{projectKey}-{issueId}-review-{role}
//   e.g. specialist-overdeck-PAN-1069-review-correctness
function parseSpecialistSession(agentId: string): { projectKey: string; issueId: string; type: string } | null {
  // Try new agent- pattern first
  const newMatch = agentId.match(/^agent-(.+)-([A-Z]+-\d+)(?:-(review|correctness|security|performance|requirements|test|ship|merge))?$/);
  if (newMatch) {
    const subrole = newMatch[3];
    const type = subrole && subrole !== 'review'
      ? `review-${subrole}`
      : 'orchestrator';
    return { projectKey: newMatch[1], issueId: newMatch[2], type };
  }

  // Try legacy specialist- pattern
  const legacyMatch = agentId.match(/^specialist-(.+)-([A-Z]+-\d+)-review-(correctness|security|performance|requirements|synthesis)$/);
  if (legacyMatch) {
    return { projectKey: legacyMatch[1], issueId: legacyMatch[2], type: `review-${legacyMatch[3]}` };
  }

  return null;
}

// Derive issueId for role runs: agent-pan-505 → PAN-505, agent-pan-505-test → PAN-505.
export function deriveAgentIssueId(agentId: string, agentIssueId?: string): string | null {
  if (agentIssueId) return agentIssueId;
  const issuePattern = '((?:[a-z]+-\\d+|(?:f|us|de|ta|tc)\\d+))';
  const match = agentId.match(new RegExp(`^(?:agent|planning)-${issuePattern}(?:-(?:\\d+|plan|review|test|ship))?$`, 'i'));
  return match ? match[1]!.toUpperCase() : null;
}

export function AgentOutputPanel({ agentId }: AgentOutputPanelProps) {
  const [viewMode, setViewMode] = useState<'activity' | 'terminal'>('activity');

  const agent = useDashboardStore(selectAgentById(agentId));
  const specialist = parseSpecialistSession(agentId);
  const [_terminalFailed, setTerminalFailed] = useState(false);

  // Reset view mode when agent changes
  const [prevAgent, setPrevAgent] = useState(agentId);
  if (agentId !== prevAgent) {
    setPrevAgent(agentId);
    setViewMode('activity');
    setTerminalFailed(false);
  }

  // Liveness for specialist agents must come from the conversation-lifecycle
  // service's tmux poll (the ground-truth probe), NOT from `agent.status` —
  // the latter is a state-machine field that lags during dashboard restarts,
  // snapshot refresh gaps, and recovery cycles, and made active synthesizers
  // render as "Starting…" when the snapshot was stale.
  //
  // Specialist rows are created at spawn (src/lib/agents.ts spawnRun) and
  // backfilled by the conversation-lifecycle service for any tmux session
  // that's missing one. They're excluded from the public list endpoint so
  // they don't clutter the sidebar, so we fetch by name directly here.
  const { data: realConversation } = useQuery({
    queryKey: ['conversation', agentId],
    queryFn: () => fetchAgentConversation(agentId),
    enabled: !!specialist,
    refetchInterval: (query) => {
      // Poll faster while the row is still missing (just-spawned race) and
      // slower once we have it (lifecycle poll handles the alive/ended
      // transitions server-side).
      const data = query.state.data as Conversation | null | undefined;
      if (data == null) return 2000;
      if (data.sessionAlive) return 5000;
      return 10000;
    },
  });

  // PAN-1523: work agents have no conversation row to enrich, so the panel
  // queries a dedicated /api/agents/:id/git-info endpoint. Specialists fall
  // back to the conversation row's branch/isWorktree fields (cwd-derived).
  const { data: agentGitInfo } = useQuery({
    queryKey: ['agent-git-info', agentId],
    queryFn: () => fetchAgentGitInfo(agentId),
    enabled: !!agentId && !specialist,
    // The underlying git enricher caches for 30s and invalidates on HEAD
    // mtime change. No need to poll harder than that from the client.
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  // If the row hasn't appeared yet (brief race after spawn, or pre-fix
  // orchestrator agents that were spawned before this code shipped), fall
  // back to a presence signal that's stronger than `agent.status`: the
  // snapshot knowing about the agent at all is evidence the spawn happened.
  const specialistIsRunning = specialist && (
    realConversation ? realConversation.sessionAlive : !!agent
  );

  // Build a Conversation object for ConversationPanel. Prefer the real row;
  // synthesize only when we have no row yet so the JSONL replay path still has
  // something to render.
  const specialistConversation = useMemo<Conversation | null>(() => {
    if (!specialist) return null;
    if (realConversation) return realConversation;
    return {
      id: 0,
      name: agentId,
      tmuxSession: agentId,
      status: specialistIsRunning ? 'active' : 'ended',
      cwd: '',
      issueId: null,
      createdAt: new Date().toISOString(),
      endedAt: specialistIsRunning ? null : new Date().toISOString(),
      lastAttachedAt: null,
      sessionAlive: !!specialistIsRunning,
      sessionFile: null,
    };
  }, [specialist, agentId, realConversation, specialistIsRunning]);

  // Role runs are identified by the persisted role field; the planning- prefix is
  // retained only as a fallback for sessions missing from the dashboard store.
  const isPlanningAgent = agent?.role === 'plan' || (!agent && agentId.startsWith('planning-'));
  const roleRunIssueId = agent?.role === 'test' ? agent.issueId : undefined;
  const workAgentIssueId = specialist ? null : deriveAgentIssueId(agentId, roleRunIssueId ?? agent?.issueId);

  // Build display label for specialist sessions
  const label = specialist
    ? specialist.type === 'orchestrator'
      ? `${specialist.projectKey} / review orchestrator`
      : `${specialist.projectKey} / ${specialist.type.replace('review-', 'review: ')}`
    : agentId;

  // PAN-1523: derive branch/worktree state for the header chip.
  //
  // Two data paths:
  //   - Specialist  → backed by the conversation row (cwd-derived branch +
  //                   isWorktree from the conversation enricher).
  //   - Work agent  → backed by /api/agents/:id/git-info because work agents
  //                   don't have a public conversation row.
  //
  // The expected branch for both is feature/<lowercased-issue-id> — for a
  // specialist we parse it out of the session name, for a work agent the
  // git-info endpoint returns it.
  const expectedAgentBranch = useMemo(() => {
    if (agentGitInfo?.expectedBranch) return agentGitInfo.expectedBranch;
    const expectedIssueId = specialist?.issueId ?? workAgentIssueId;
    return expectedIssueId ? `feature/${expectedIssueId.toLowerCase()}` : null;
  }, [agentGitInfo, specialist, workAgentIssueId]);

  const actualAgentBranch = specialist
    ? (realConversation?.branch ?? null)
    : (agentGitInfo?.actualBranch ?? null);
  const agentCwd = specialist
    ? (realConversation?.cwd ?? null)
    : (agentGitInfo?.workspacePath ?? null);
  const isAgentWorktree = specialist
    ? (realConversation?.isWorktree ?? false)
    // Work-agent workspaces are always secondary worktrees of the project repo.
    : Boolean(agentGitInfo?.actualBranch);
  const agentBranchDrifted = specialist
    ? Boolean(
        expectedAgentBranch && actualAgentBranch && expectedAgentBranch !== actualAgentBranch,
      )
    : Boolean(agentGitInfo?.branchDrifted);
  const agentWorkspaceMissing = specialist
    ? Boolean(
        realConversation && realConversation.cwd && !actualAgentBranch && expectedAgentBranch !== null,
      )
    : Boolean(agentGitInfo?.workspaceMissing);

  return (
    <div className="bg-card rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
        <span className="font-medium text-foreground text-sm flex-1 truncate">{label}</span>
        {(actualAgentBranch || agentWorkspaceMissing) && (
          <span
            className={`${styles.terminalBranchBar} ${
              agentWorkspaceMissing
                ? styles.terminalBranchBarMissing
                : agentBranchDrifted
                  ? styles.terminalBranchBarDrift
                  : ''
            }`}
            title={
              agentWorkspaceMissing
                ? `Workspace missing on disk: ${agentCwd ?? '(unknown path)'}`
                : agentBranchDrifted
                  ? `Expected ${expectedAgentBranch}, on ${actualAgentBranch} · ${agentCwd ?? ''}`
                  : `${isAgentWorktree ? 'Worktree' : 'Local'} · ${agentCwd ?? ''}`
            }
          >
            {agentWorkspaceMissing ? (
              <>
                <AlertCircle size={12} />
                <span className={styles.terminalBranchBarMode}>Worktree missing</span>
              </>
            ) : (
              <>
                {agentBranchDrifted ? <TriangleAlert size={12} /> : isAgentWorktree ? <GitFork size={12} /> : <Folder size={12} />}
                <span className={styles.terminalBranchBarMode}>
                  {agentBranchDrifted ? 'Drifted' : isAgentWorktree ? 'Worktree' : 'Local'}
                </span>
                <span className={styles.terminalBranchBarText}>{actualAgentBranch}</span>
              </>
            )}
          </span>
        )}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === 'activity' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setViewMode('activity')}
          >
            Activity
          </button>
          <button
            className={`${styles.viewToggleBtn} ${viewMode === 'terminal' ? styles.viewToggleBtnActive : ''}`}
            onClick={() => setViewMode('terminal')}
          >
            Terminal
          </button>
        </div>
      </div>

      {/* Activity view */}
      {viewMode === 'activity' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          {specialist ? (
            specialistIsRunning ? (
              // Live specialist → show XTerminal
              <XTerminal
                sessionName={agentId}
                onDisconnect={() => setTerminalFailed(true)}
              />
            ) : specialistConversation ? (
              // Down specialist → show JSONL conversation (same as Command Deck)
              <ConversationPanel conversation={specialistConversation} agentId={agentId} />
            ) : null
          ) : workAgentIssueId ? (
            <ActivityView issueId={workAgentIssueId} />
          ) : isPlanningAgent ? (
            // Planning agent with non-derivable issueId → fall back to raw terminal
            <XTerminal sessionName={agentId} onDisconnect={() => setTerminalFailed(true)} />
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No issue associated with this session
            </div>
          )}
        </div>
      )}

      {/* Terminal view — always XTerminal */}
      {viewMode === 'terminal' && (
        <div className="flex-1 min-h-0">
          <XTerminal sessionName={agentId} />
        </div>
      )}
    </div>
  );
}
