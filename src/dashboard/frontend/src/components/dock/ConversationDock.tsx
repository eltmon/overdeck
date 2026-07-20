/**
 * PAN-2908 · C-CONVO — the conversation dock rail (level 2 · talk).
 *
 * Persistent right rail on every surface: open conversations as panels, each
 * with the agent's live feed (memory observations) and a steering composer.
 * Needs-you items pin to the top in amber. Deep-dive remains the issue
 * drawer — one renderer family, three depths (peek → dock → detail).
 */
import { useMemo, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { useConvoDock } from '../../lib/convoDock';
import { selectMemoryObservations, selectPendingInputSubjects, useDashboardStore } from '../../lib/store';
import type { Issue } from '../../types';
import type { AgentSnapshot } from '@overdeck/contracts';
import { useSimpleActions } from '../../lib/simple/useSimpleActions';
import { cn } from '../../lib/utils';

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

function DockPanel({ issueId, needsYou, onClose }: { issueId: string; needsYou: boolean; onClose: () => void }) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const agentsById = useDashboardStore((s) => s.agentsById);
  const observations = useDashboardStore(selectMemoryObservations(issueId));
  const actions = useSimpleActions();
  const [text, setText] = useState('');

  const issue = ((issuesRaw as Issue[]) ?? []).find((i) => i.identifier.toLowerCase() === issueId.toLowerCase());
  const agent = useMemo(() => {
    const agents = (Object.values(agentsById ?? {}) as AgentSnapshot[]).filter(
      (a) => a.issueId?.toLowerCase() === issueId.toLowerCase(),
    );
    return agents.find((a) => a.status === 'running' || a.status === 'starting')
      ?? agents.find((a) => !!a.pendingAskUserQuestion || (a.pendingInputCount ?? 0) > 0)
      ?? agents[0];
  }, [agentsById, issueId]);

  const feed = useMemo(
    () => [...(observations ?? [])].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 3).reverse(),
    [observations],
  );

  const send = () => {
    const message = text.trim();
    if (!message || !agent) return;
    actions.tell.mutate({ agentId: agent.id, message });
    setText('');
  };

  return (
    <div className={cn('rounded-xl border bg-card shadow-sm', needsYou ? 'border-warning/40' : 'border-border')} data-dock-panel={issueId}>
      <div className="flex items-center gap-2 px-3 py-2">
        {needsYou && <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-warning" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px]">{agent?.id ?? 'no agent'}</div>
          <div className="truncate text-[10.5px] text-muted-foreground">{issueId}{issue ? ` · ${issue.title}` : ''}</div>
        </div>
        <button onClick={onClose} className="flex-none text-muted-foreground hover:text-foreground" aria-label={`Close ${issueId}`}>
          <X size={13} />
        </button>
      </div>
      <div className="space-y-1.5 border-t border-border px-3 py-2">
        {feed.length === 0 && <div className="text-[11px] text-muted-foreground">No activity yet.</div>}
        {feed.map((obs) => (
          <div key={obs.id} className="text-[11.5px] leading-snug">
            <span className="mr-1.5 font-mono text-[9.5px] text-muted-foreground">{formatWhen(obs.timestamp)}</span>
            {obs.narrative || obs.summary}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 border-t border-border p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Message…"
          className="h-8 flex-1 rounded-md border border-input bg-muted px-2.5 text-xs text-foreground outline-none focus:border-ring"
        />
        <button
          onClick={send}
          disabled={!text.trim() || !agent || actions.tell.isPending}
          className="h-8 w-8 flex-none rounded-md bg-primary text-primary-foreground disabled:opacity-40"
          aria-label="Send"
        >
          ➤
        </button>
      </div>
    </div>
  );
}

export function ConversationDock() {
  const { items, expanded, remove, setExpanded } = useConvoDock();
  const pendingSubjects = useDashboardStore(selectPendingInputSubjects);
  const needsYouIds = useMemo(
    () => new Set((pendingSubjects ?? []).map((s) => s.issueId?.toLowerCase()).filter(Boolean)),
    [pendingSubjects],
  );
  const ordered = useMemo(
    () => [...items].sort((a, b) => Number(needsYouIds.has(b.issueId.toLowerCase())) - Number(needsYouIds.has(a.issueId.toLowerCase())) || b.addedAt - a.addedAt),
    [items, needsYouIds],
  );

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-component="conversation-dock-handle"
        className="fixed bottom-6 right-0 z-40 flex items-center gap-1.5 rounded-l-lg border border-r-0 border-border bg-card px-2.5 py-2 text-[11px] text-muted-foreground shadow-lg hover:text-foreground"
      >
        <MessageSquare size={13} />
        {items.length > 0 && <span className="font-mono text-[10px]">{items.length}</span>}
      </button>
    );
  }

  return (
    <aside
      data-component="conversation-dock"
      className="fixed bottom-0 right-0 top-12 z-40 flex w-[340px] flex-col border-l border-border bg-background/95 shadow-[-16px_0_48px_rgb(0_0_0/30%)] backdrop-blur"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-medium">Conversations</h2>
        {needsYouIds.size > 0 && (
          <span className="rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-warning-foreground">
            {needsYouIds.size} needs you
          </span>
        )}
        <button onClick={() => setExpanded(false)} className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Collapse dock">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {ordered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            Nothing docked. Hover an issue and "pop into dock" — conversations stay with you while you navigate.
          </div>
        )}
        {ordered.map((item) => (
          <DockPanel key={item.issueId} issueId={item.issueId} needsYou={needsYouIds.has(item.issueId.toLowerCase())} onClose={() => remove(item.issueId)} />
        ))}
      </div>
    </aside>
  );
}
