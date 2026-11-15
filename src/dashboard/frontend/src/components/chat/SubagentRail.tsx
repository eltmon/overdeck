import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import type { Conversation } from '../CommandDeck/ConversationList';
import type { SubagentSummary } from './chat-types';

/** Mirrors the Awareness rail's collapse persistence (PAN-1591 pattern). */
const AGENTS_RAIL_COLLAPSED_KEY = 'overdeck.ui.agentsRailCollapsed';

/** Below this host-pane width, the rail auto-collapses regardless of the stored preference (PAN-5329). */
export const NARROW_PANE_PX = 760;

interface SubagentRailProps {
  conversation: Conversation;
  subagents: SubagentSummary[];
  /** Currently selected subagent, or null while the main agent is shown. */
  selectedAgentId: string | null;
  /**
   * When set, the rail starts at this collapsed state instead of reading
   * localStorage, and toggling it never persists to localStorage (PAN-4222).
   * Used by embedded previews (Live, History) that should not fight the
   * user's own conversation-page rail preference.
   */
  defaultCollapsed?: boolean;
  /**
   * Each change after mount flips the rail, exactly as its own buttons do
   * (pane-local on a narrow pane, stored otherwise). The header's ⋯ →
   * Subagents item bumps it (PAN-5291 D1-6); the mount value never toggles.
   */
  toggleSignal?: number;
}

function readSelectedSubagent(): string | null {
  return new URLSearchParams(window.location.search).get('subagent');
}

export function updateSelectedSubagent(agentId: string | null): void {
  const searchParams = new URLSearchParams(window.location.search);
  if (agentId) searchParams.set('subagent', agentId);
  else searchParams.delete('subagent');
  const query = searchParams.toString();
  window.history.pushState({}, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * URL-backed selection (`?subagent=<id>`) shared by the rail and the conversation
 * body: the rail highlights the row, the body swaps to that agent's transcript.
 * `updateSelectedSubagent` dispatches popstate so every reader re-syncs.
 */
export function useSubagentSelection(subagents: readonly SubagentSummary[]) {
  const [selectedAgentId, setSelectedAgentId] = useState(readSelectedSubagent);
  useEffect(() => {
    const onPopState = () => setSelectedAgentId(readSelectedSubagent());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const clearSelection = useCallback(() => updateSelectedSubagent(null), []);
  const selectedSubagent = subagents.find((subagent) => subagent.agentId === selectedAgentId) ?? null;
  return { selectedAgentId, selectedSubagent, clearSelection };
}

export function SubagentRail({ conversation, subagents, selectedAgentId, defaultCollapsed, toggleSignal }: SubagentRailProps) {
  const select = useCallback((agentId: string | null) => updateSelectedSubagent(agentId), []);
  const [storedCollapsed, setStoredCollapsed] = useState(
    () => defaultCollapsed ?? (typeof window !== 'undefined' && localStorage.getItem(AGENTS_RAIL_COLLAPSED_KEY) === 'true'),
  );

  // Measures the rail's host pane (its parent) rather than itself: the rail's own
  // width is what we're deciding, so it can't be the measurement source.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const hostRef = useCallback((el: HTMLElement | null) => {
    if (el) setHost(el.parentElement);
  }, []);

  const [narrow, setNarrow] = useState(false);
  // Narrow-pane collapse override: null defers to storedCollapsed, otherwise wins
  // over it while the pane stays narrow. Never persisted — it's a transient
  // reaction to space, not a preference.
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last || last.contentRect.width <= 0) return;
      setNarrow(last.contentRect.width < NARROW_PANE_PX);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [host]);

  useEffect(() => {
    if (!narrow) setOverride(null);
  }, [narrow]);

  const collapsed = narrow ? (override ?? true) : storedCollapsed;

  const toggleCollapsed = useCallback((next: boolean) => {
    if (narrow) {
      setOverride(next);
      return;
    }
    setStoredCollapsed(next);
    if (defaultCollapsed !== undefined) return;
    try { localStorage.setItem(AGENTS_RAIL_COLLAPSED_KEY, String(next)); } catch { /* ignore */ }
  }, [narrow, defaultCollapsed]);

  const lastToggleSignal = useRef(toggleSignal);
  useEffect(() => {
    if (toggleSignal === undefined || toggleSignal === lastToggleSignal.current) return;
    lastToggleSignal.current = toggleSignal;
    toggleCollapsed(!collapsed);
  }, [toggleSignal, collapsed, toggleCollapsed]);

  if (subagents.length === 0) return null;

  if (collapsed) {
    return (
      <button
        ref={hostRef}
        type="button"
        className="flex w-[30px] min-w-[30px] shrink-0 cursor-pointer flex-col items-center gap-2.5 border-l border-border bg-card pt-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => toggleCollapsed(false)}
        title="Show Agents"
        aria-label="Show agents rail"
      >
        <ChevronLeft size={16} />
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] [writing-mode:vertical-rl]">
          Agents
        </span>
      </button>
    );
  }

  return (
    <aside
      ref={hostRef}
      aria-label="Conversation agents"
      className="flex min-h-0 w-64 min-w-0 shrink-0 flex-col border-l border-border bg-card"
    >
      <header className="flex h-11 shrink-0 items-center border-b border-border px-3 text-xs font-medium text-muted-foreground">
        Agents
        <button
          type="button"
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Collapse agents rail"
          onClick={() => toggleCollapsed(true)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentRow
          label="Main agent"
          description={conversation.title ?? conversation.name}
          /* Session liveness, not activity — so no halo: an idle conversation must not ping forever. */
          status={conversation.sessionAlive ? 'running' : 'done'}
          selected={selectedAgentId === null}
          onClick={() => select(null)}
        />
        {subagents.map((subagent) => (
          <AgentRow
            key={subagent.agentId}
            label={subagent.agentType}
            description={subagent.description}
            status={subagent.status}
            halo={subagent.status === 'running'}
            depth={subagent.spawnDepth}
            selected={selectedAgentId === subagent.agentId}
            onClick={() => select(subagent.agentId)}
          />
        ))}
      </div>
    </aside>
  );
}

interface AgentRowProps {
  label: string;
  description: string;
  status: 'running' | 'done';
  /** Draw the pulsing halo — reserved for real activity (a subagent with a pending tool call). */
  halo?: boolean;
  depth?: number;
  selected: boolean;
  onClick: () => void;
}

function AgentRow({ label, description, status, halo = false, depth, selected, onClick }: AgentRowProps) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full items-start gap-2 border-b border-l-2 border-b-border px-3 py-2 text-left transition-colors ${selected ? 'border-l-primary bg-accent' : 'border-l-transparent hover:bg-accent'}`}
      onClick={onClick}
    >
      <span aria-label={status} className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {/* Live halo: the core dot stays solid so the row reads as active even at the ping's faded phase. */}
        {halo && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        )}
        <span
          className={`relative inline-flex rounded-full ${status === 'running' ? 'h-2.5 w-2.5 bg-primary' : 'h-2 w-2 bg-muted-foreground/70'}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{label}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      {depth !== undefined && depth > 1 && (
        <span className="rounded-sm border border-border bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
          depth {depth}
        </span>
      )}
    </button>
  );
}
