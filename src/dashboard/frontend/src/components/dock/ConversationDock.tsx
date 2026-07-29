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
import { useDashboardStore } from '../../lib/store';
import { usePendingInputSubjects } from '../../lib/useDecisions';
import type { Issue } from '../../types';
import type { Agent } from '../../types';
import { DrawerAgentSession, pickDefaultDrawerAgent } from '../drawer/DrawerAgentSession';
import { cn } from '../../lib/utils';

function DockPanel({ item, needsYou, onClose }: { item: { type: 'issue'; issueId: string; agents: Agent[] } | { type: 'conversation'; conversationName: string; issueId: string }; needsYou: boolean; onClose: () => void }) {
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  if (item.type === 'conversation') {
    const issue = ((issuesRaw as Issue[]) ?? []).find((i) => i.identifier.toLowerCase() === item.issueId.toLowerCase());
    return (
      <div className={cn('rounded-xl border bg-card shadow-sm', needsYou ? 'border-warning/40' : 'border-border')} data-dock-panel={`conv-${item.conversationName}`}>
        <div className="flex items-center gap-2 px-3 py-2">
          {needsYou && <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-warning" />}
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px]">{item.conversationName}</div>
            <div className="truncate text-[10.5px] text-muted-foreground">{item.issueId}{issue ? ` · ${issue.title}` : ''}</div>
          </div>
          {/* Close button removed: conversation-only entries have no close action on dock */}
        </div>
        <div className="h-[420px] border-t border-border p-2">
          <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground">
            <div>Pending conversation</div>
            <div className="text-[10px] mt-1">Answer from Needs You strip</div>
          </div>
        </div>
      </div>
    );
  }

  const agents = item.agents;
  const effectiveAgentId = selectedAgentId && agents.some((a) => a.id === selectedAgentId)
    ? selectedAgentId
    : pickDefaultDrawerAgent(agents)?.id ?? null;
  const issue = ((issuesRaw as Issue[]) ?? []).find((i) => i.identifier.toLowerCase() === item.issueId.toLowerCase());

  return (
    <div className={cn('rounded-xl border bg-card shadow-sm', needsYou ? 'border-warning/40' : 'border-border')} data-dock-panel={item.issueId}>
      <div className="flex items-center gap-2 px-3 py-2">
        {needsYou && <span className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-warning" />}
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px]">{effectiveAgentId ?? 'no agent'}</div>
          <div className="truncate text-[10.5px] text-muted-foreground">{item.issueId}{issue ? ` · ${issue.title}` : ''}</div>
        </div>
        <button onClick={onClose} className="flex-none text-muted-foreground hover:text-foreground" aria-label={`Close ${item.issueId}`}>
          <X size={13} />
        </button>
      </div>
      {/* PAN-2908 C-CONVO v2: the full rich transcript in the dock — same
          renderer as the drawer's conversation tab, not a summary feed. */}
      <div className="h-[420px] border-t border-border p-2">
        <DrawerAgentSession
          view="conversation"
          agents={agents}
          agentId={effectiveAgentId}
          onSelectAgent={setSelectedAgentId}
          issueId={item.issueId}
        />
      </div>
    </div>
  );
}

type DockItem = { type: 'issue'; issueId: string; agents: Agent[] } | { type: 'conversation'; conversationName: string; issueId: string };

export function ConversationDock() {
  const { items, expanded, remove, setExpanded } = useConvoDock();
  const pendingSubjects = usePendingInputSubjects();
  const agentsById = useDashboardStore((s) => s.agentsById);
  const issuesRaw = useDashboardStore((s) => s.issuesRaw);

  const needsYouIds = useMemo(
    () => new Set((pendingSubjects ?? []).map((s) => s.issueId?.toLowerCase()).filter(Boolean)),
    [pendingSubjects],
  );

  const allDockItems = useMemo(() => {
    const issues = (issuesRaw as Issue[]) ?? [];
    const agents = Object.values(agentsById ?? {}) as Agent[];
    const agentsByIssue = new Map<string, Agent[]>();
    for (const a of agents) {
      const key = a.issueId?.toLowerCase();
      if (!key) continue;
      const list = agentsByIssue.get(key) ?? [];
      list.push(a);
      agentsByIssue.set(key, list);
    }

    // Collect all pending conversations by issue
    const conversationsByIssue = new Map<string, Array<{ agentId: string; issueId: string }>>();
    for (const s of pendingSubjects ?? []) {
      if (s.pendingAskUserQuestion && s.issueId && !agentsByIssue.has(s.issueId.toLowerCase())) {
        const issueKey = s.issueId.toLowerCase();
        const conversations = conversationsByIssue.get(issueKey) ?? [];
        conversations.push({ agentId: s.agentId, issueId: s.issueId });
        conversationsByIssue.set(issueKey, conversations);
      }
    }

    const result: DockItem[] = [];
    const replacedIssueIds = new Set<string>();

    // Add explicitly docked issues
    for (const item of items) {
      const key = item.issueId.toLowerCase();
      const issue = issues.find((i) => i.identifier.toLowerCase() === key);
      if (!issue) continue;

      // If this issue has pending conversations, add them instead of the empty issue panel
      if (conversationsByIssue.has(key)) {
        const conversations = conversationsByIssue.get(key) ?? [];
        for (const conv of conversations) {
          result.push({
            type: 'conversation',
            conversationName: conv.agentId,
            issueId: conv.issueId,
          });
        }
        replacedIssueIds.add(key);
      } else {
        // No pending conversations, add the issue entry
        result.push({
          type: 'issue',
          issueId: item.issueId,
          agents: agentsByIssue.get(key) ?? [],
        });
      }
    }

    // Add standalone pending conversations (not already docked)
    for (const [issueKey, conversations] of conversationsByIssue.entries()) {
      if (!replacedIssueIds.has(issueKey)) {
        const issue = issues.find((i) => i.identifier.toLowerCase() === issueKey);
        if (issue) {
          for (const conv of conversations) {
            result.push({
              type: 'conversation',
              conversationName: conv.agentId,
              issueId: conv.issueId,
            });
          }
        }
      }
    }

    return result;
  }, [items, pendingSubjects, agentsById, issuesRaw]);

  const ordered = useMemo(
    () => [...allDockItems].sort((a, b) => {
      const aIssue = a.type === 'issue' ? a.issueId : a.issueId;
      const bIssue = b.type === 'issue' ? b.issueId : b.issueId;
      return Number(needsYouIds.has(bIssue.toLowerCase())) - Number(needsYouIds.has(aIssue.toLowerCase())) || (a.type === 'conversation' ? 1 : 0) - (b.type === 'conversation' ? 1 : 0);
    }),
    [allDockItems, needsYouIds],
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
        {allDockItems.length > 0 && <span className="font-mono text-[10px]">{allDockItems.length}</span>}
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
        {ordered.map((item) => {
          const issueId = item.type === 'issue' ? item.issueId : item.issueId;
          const key = item.type === 'conversation' ? `${item.issueId}-${item.conversationName}` : item.issueId;
          return (
            <DockPanel
              key={key}
              item={item}
              needsYou={needsYouIds.has(issueId.toLowerCase())}
              onClose={() => {
                if (item.type === 'issue') {
                  remove(item.issueId);
                }
                // Conversation-only items are removed by NeedsYouStrip answer action
              }}
            />
          );
        })}
      </div>
    </aside>
  );
}
