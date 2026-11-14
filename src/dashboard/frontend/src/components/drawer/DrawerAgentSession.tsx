/**
 * DrawerAgentSession — renders one issue-scoped agent session as a transcript
 * or live terminal.
 *
 * The toolbar can expose the shared Conversation | Terminal selector through
 * `onChangeView`; its parent owns the active view mode. The component picks the
 * requested issue agent (defaulting to the active work agent) and renders its
 * JSONL transcript (`<ConversationPanel>`) or tmux terminal (`<XTerminal>`).
 * When an issue has multiple agents — e.g. a swarm — the compact picker changes
 * sessions independently, so the parent-owned selection survives view switches.
 *
 * A work agent's `id` is both its tmux session name and its session-file key,
 * so a `Conversation` can be synthesized from the `Agent` alone — the same
 * shape `SessionPanel` synthesizes from a `SessionNode`.
 *
 * Layouts: `toolbar` (default, the dock and page/rail density) shows the view
 * toggle, a `<select>` picker, the branch chip and the Tools button in one
 * row. `conversation-header` (PAN-5244, drawer density) shows a header row
 * (agent name with a menu of every agent, view toggle, Tools) and a meta row
 * (status, branch chip, model · harness, cost, agent id, start time).
 */

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitFork, TriangleAlert, AlertCircle, Wrench, ChevronDown } from 'lucide-react';

import { ConversationPanel } from '../chat/ConversationPanel';
import { StartAgentCta } from '../issue-view/StartAgentCta';
import { XTerminal } from '../XTerminal';
import { useConversationUiState } from '../../hooks/useConversationUiState';
import { agentDisplayName, agentToConversation, isEndedAgent, sortIssueAgents, type SessionAgent } from '../../lib/agentConversation';
import { getFriendlyModelName } from '../../lib/dashboard-utils';
import { selectAgentById, useDashboardStore } from '../../lib/store';
import { useAgentSessionOutcome } from '../../lib/useSessionOutcome';
import { SESSION_ENDED_FALLBACK } from '../../lib/sessionOutcome';
import { ViewToggle } from '../shared/ViewToggle';
import { MenuItemButton, MenuOverlay, MenuSurface } from '../shared/ContextMenu';
import styles from '../CommandDeck/styles/command-deck.module.css';

// Re-exported so existing importers (IssueDrawer, dock, tests) keep working —
// the definitions live in lib/agentConversation.ts (PAN-3090).
export { sortIssueAgents, type SessionAgent } from '../../lib/agentConversation';

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

/**
 * Pick the agent the drawer should show by default: the active work agent,
 * then any work agent, then any active agent, then whatever exists.
 */
export function pickDefaultDrawerAgent(agents: readonly SessionAgent[]): SessionAgent | null {
  const live = agents.filter((agent) => !isEndedAgent(agent));
  return (
    live.find((agent) => agent.role === 'work')
    ?? agents.find((agent) => agent.role === 'work')
    ?? live[0]
    ?? agents[0]
    ?? null
  );
}

function agentOptionLabel(agent: SessionAgent): string {
  const slotMatch = /^agent-[a-z]+-\d+-slot-(\d+)$/i.exec(agent.id);
  if (slotMatch) return `Slot ${slotMatch[1]} · ${agent.id}`;

  const role = agent.role ? `${agent.role[0]!.toUpperCase()}${agent.role.slice(1)}` : 'Agent';
  return `${role} · ${agent.id}`;
}

interface DrawerAgentSessionProps {
  view: 'conversation' | 'terminal';
  agents: readonly SessionAgent[];
  /** The agent to display — resolved by IssueDrawer, shared across both tabs. */
  agentId: string | null;
  onSelectAgent: (agentId: string) => void;
  /** Switch the shared session surface between transcript and terminal modes. */
  onChangeView?: (view: 'conversation' | 'terminal') => void;
  /** Needed for the no-agent start surface (StartAgentCta). */
  issueId?: string | null;
  /** Hide ConversationPanel's composer — the parent provides its own (simple mode). */
  hideComposer?: boolean;
  /** 'conversation-header' (PAN-5244, drawer density): header row, meta row and an agent menu instead of the toolbar and <select>. */
  layout?: 'toolbar' | 'conversation-header';
  /** conversation-header layout only: rendered between the meta row and the transcript (the reviewers row). */
  belowHeader?: ReactNode;
}

function AgentMenuRow({ agent, selected, onSelect }: { agent: SessionAgent; selected: boolean; onSelect: () => void }) {
  const outcome = useAgentSessionOutcome(agent);
  const status = isEndedAgent(agent) ? (outcome ?? SESSION_ENDED_FALLBACK).label : 'active';
  return (
    <MenuItemButton active={selected} data-testid={`drawer-agent-option-${agent.id}`} onClick={onSelect}>
      <span className="min-w-0 flex-1 truncate">{agentOptionLabel(agent)}</span>
      <span className="shrink-0 font-mono-ui text-[11.5px] text-muted-foreground">{status}</span>
    </MenuItemButton>
  );
}

export function DrawerAgentSession({ view, agents, agentId, onSelectAgent, onChangeView, issueId, hideComposer = false, layout = 'toolbar', belowHeader }: DrawerAgentSessionProps) {
  const testId = `drawer-tab-panel-${view}`;
  const orderedAgents = useMemo(() => sortIssueAgents(agents), [agents]);

  const agent = useMemo(
    () => orderedAgents.find((candidate) => candidate.id === agentId) ?? null,
    [agentId, orderedAgents],
  );
  const conversation = useMemo(() => (agent ? agentToConversation(agent) : null), [agent]);
  const outcome = useAgentSessionOutcome(agent);

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

  // conversation-header layout: the agent menu, and the read-model snapshot
  // (it carries `paused` and `costSoFar`, which SessionAgent does not).
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const snapshot = useDashboardStore(selectAgentById(agent?.id ?? ''));

  const terminalDisabledReason = !agent
    ? 'No agent selected — start work to attach a terminal'
    : isEndedAgent(agent)
      ? `${(outcome ?? SESSION_ENDED_FALLBACK).label} — no live terminal to attach`
      : undefined;
  const viewToggle = onChangeView ? (
    <ViewToggle
      ariaLabel="Agent session view"
      value={view}
      onChange={onChangeView}
      options={[
        { id: 'conversation', label: 'Conversation' },
        {
          id: 'terminal',
          label: 'Terminal',
          disabled: Boolean(terminalDisabledReason),
          disabledReason: terminalDisabledReason,
        },
      ]}
    />
  ) : null;

  if (!agent || !conversation) {
    if (layout === 'conversation-header') {
      return (
        <div data-testid={testId} className="flex min-h-0 flex-1 flex-col">
          <div data-section="StartAgentCta" data-testid="drawer-start-surface" className="m-auto w-full max-w-[440px] px-[20px] py-[32px]">
            <div className="mb-[4px] text-[15px] font-semibold text-foreground">No agent has run on this issue yet</div>
            <p className="mb-[16px] text-[13px] leading-[1.6] text-body-foreground">
              {view === 'conversation'
                ? "Plan it first, or start work directly. Overdeck creates the workspace, and each agent's conversation appears here while it works."
                : "Plan it first, or start work directly. Overdeck creates the workspace, and the agent's live terminal appears here while it works."}
            </p>
            {issueId && <StartAgentCta issueId={issueId} density="console" />}
          </div>
        </div>
      );
    }
    return (
      <div
        data-testid={testId}
        className="rounded-[var(--radius)] border border-dashed border-border bg-card/60 p-[18px]"
      >
        {viewToggle && <div className="mb-[12px] flex items-center">{viewToggle}</div>}
        <div className="mb-[8px] text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {view === 'conversation' ? 'Conversation' : 'Terminal'}
        </div>
        <p className="text-[12px] font-medium text-foreground">
          Nothing here yet — no agent has started on this issue.
        </p>
        <p className="mt-[4px] text-[12px] leading-5 text-muted-foreground">
          Start work and the live {view === 'conversation' ? 'conversation' : 'terminal'} appears here. Everything else about the issue is one tab away (Overview).
        </p>
        {issueId && (
          <div className="mt-[12px]">
            <StartAgentCta issueId={issueId} density="console" />
          </div>
        )}
      </div>
    );
  }

  const showBranchChip = Boolean(gitInfo?.actualBranch || gitInfo?.workspaceMissing);
  const drifted = Boolean(gitInfo?.branchDrifted);
  const missing = Boolean(gitInfo?.workspaceMissing);

  const branchChip = showBranchChip ? (
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
  ) : null;
  const toolsButton = (extraClass: string) => (
    <button
      type="button"
      className={`${extraClass}${styles.conversationAboutToggle} ${hideToolCalls ? styles.conversationAboutToggleActive : ''}`}
      onClick={toggleHideToolCalls}
      title={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
      aria-label={hideToolCalls ? 'Show tool calls' : 'Hide tool calls'}
      aria-pressed={hideToolCalls}
    >
      <Wrench size={14} />
      <span>Tools</span>
    </button>
  );
  const sessionBody = view === 'conversation' ? (
    <ConversationPanel
      key={agent.id}
      conversation={conversation}
      viewMode="conversation"
      embedded
      agentId={agent.id}
      hideToolCalls={hideToolCalls}
      onToggleHideToolCalls={toggleHideToolCalls}
      hideComposer={hideComposer}
    />
  ) : isEndedAgent(agent) ? (
    <div className={`flex h-full items-center justify-center p-[18px] text-[13px] ${outcome?.tone === 'attention' ? 'text-destructive' : 'text-muted-foreground'}`}>
      {(outcome ?? SESSION_ENDED_FALLBACK).label} — no live terminal to attach.
    </div>
  ) : (
    <XTerminal key={agent.id} sessionName={agent.id} />
  );

  if (layout === 'conversation-header') {
    const ended = isEndedAgent(agent);
    const paused = snapshot?.paused === true;
    const cost = snapshot?.costSoFar;
    const started = agent.startedAt ? new Date(agent.startedAt) : null;
    const startedValid = started !== null && !Number.isNaN(started.getTime());
    const harness = agent.harness ?? agent.runtime;
    const status = paused ? (
      <span data-testid="drawer-agent-status" className="text-warning-foreground">paused</span>
    ) : !ended ? (
      <span data-testid="drawer-agent-status" className="text-info-foreground">active</span>
    ) : (
      <span data-testid="drawer-agent-status" className={outcome?.tone === 'attention' ? 'text-destructive' : 'text-body-foreground'}>
        {(outcome ?? SESSION_ENDED_FALLBACK).label}
      </span>
    );
    const metaItems: ReactNode[] = [
      status,
      branchChip,
      <span>{getFriendlyModelName(agent.model)}{harness ? ` · ${harness}` : ''}</span>,
      typeof cost === 'number' && cost > 0 ? (
        <span data-testid="drawer-agent-cost" className="font-mono-ui tabular-nums text-signal-cost-foreground">{`$${cost.toFixed(2)}`}</span>
      ) : null,
      <span className="font-mono-ui">{agent.id}</span>,
      startedValid ? (
        <span data-testid="drawer-agent-started" title={agent.startedAt ?? undefined}>
          started {started.toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </span>
      ) : null,
    ].filter((item) => item !== null);
    const name = (
      <>
        {!ended && <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-info motion-reduce:animate-none" />}
        {agentDisplayName(agent)}
      </>
    );
    return (
      <div data-testid={testId} className="flex min-h-0 flex-1 flex-col">
        <div data-testid="drawer-agent-header" className="relative flex shrink-0 items-center gap-[8px] px-[20px] pt-[9px]">
          {orderedAgents.length > 1 ? (
            <button
              ref={pickerRef}
              type="button"
              data-testid="drawer-agent-picker"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              title="Every agent on this issue, workers included"
              onClick={() => setPickerOpen((open) => !open)}
              className="-ml-[6px] inline-flex items-center gap-[8px] whitespace-nowrap rounded-[var(--radius)] px-[6px] py-[2px] text-[13.5px] font-semibold text-foreground transition-colors hover:bg-accent"
            >
              {name}<ChevronDown aria-hidden className="h-[14px] w-[14px] text-muted-foreground" />
            </button>
          ) : (
            <span data-testid="drawer-agent-name" className="inline-flex items-center gap-[8px] whitespace-nowrap text-[13.5px] font-semibold text-foreground">{name}</span>
          )}
          {pickerOpen && (
            <>
              <MenuOverlay onClick={() => setPickerOpen(false)} />
              <MenuSurface
                aria-label={`${orderedAgents.length} agents on this issue`}
                data-testid="drawer-agent-menu"
                onClose={() => setPickerOpen(false)}
                returnFocusRef={pickerRef}
                className="absolute left-[14px] top-full z-[1000] mt-1 w-[340px]"
              >
                {orderedAgents.map((candidate) => (
                  <AgentMenuRow
                    key={candidate.id}
                    agent={candidate}
                    selected={candidate.id === agent.id}
                    onSelect={() => { setPickerOpen(false); onSelectAgent(candidate.id); }}
                  />
                ))}
              </MenuSurface>
            </>
          )}
          {viewToggle}
          <span className="flex-1" />
          {toolsButton('')}
        </div>
        <div data-testid="drawer-agent-meta" className="flex shrink-0 items-center gap-[8px] overflow-hidden whitespace-nowrap border-b border-border px-[20px] pb-[9px] pt-[7px] text-[12px] text-muted-foreground">
          {metaItems.map((item, index) => (
            <Fragment key={index}>
              {index > 0 && <span aria-hidden>·</span>}
              {item}
            </Fragment>
          ))}
        </div>
        {ended && issueId ? (
          // D-13: the Conversation tab's resume path (Resume, Start with
          // overrides, or nothing, by StartAgentCta's own rules).
          <div data-testid="drawer-agent-restart-row" className="shrink-0 border-b border-border px-[20px] py-[8px] empty:hidden">
            <StartAgentCta issueId={issueId} density="console" />
          </div>
        ) : null}
        {belowHeader}
        <div className="min-h-0 flex-1 overflow-hidden">
          {sessionBody}
        </div>
      </div>
    );
  }

  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 flex-col gap-[10px]">
      <div className="flex shrink-0 items-center gap-[8px]">
        {viewToggle}
        {orderedAgents.length > 1 && (
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
              {orderedAgents.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {agentOptionLabel(candidate)}
                </option>
              ))}
            </select>
          </>
        )}
        {branchChip}
        {toolsButton('ml-auto ')}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-[var(--radius)] border border-border">
        {sessionBody}
      </div>
    </div>
  );
}
