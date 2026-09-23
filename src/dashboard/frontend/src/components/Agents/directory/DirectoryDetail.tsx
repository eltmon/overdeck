/**
 * Right pane of the Agents Directory (PAN-3920 W7, FR-5): the entry header,
 * its issue context (D10) and its transcript (D8) with the composer policy of
 * D9. Workers get a "Message worker" button that reveals the shared tell
 * composer instead of a conversation composer.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DirectoryEntry } from '@overdeck/contracts';

import { formatRelativeTime } from '../../../lib/formatRelativeTime';
import { useSharedTick } from '../../../lib/useSharedTick';
import { conversationMessagesQueryKey } from '../../chat/useConversationMessagesStream';
import { TellComposer } from '../../issue-view/TellComposer';
import { DirectoryIssueContext } from './DirectoryIssueContext';
import { DirectoryStateDot } from './DirectoryStateDot';
import { DirectoryTranscript } from './DirectoryTranscript';
import { isLiveState } from './directory-tree';

function formatCost(value: number): string {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

/**
 * Cost for kinds the list does not price (D-cost): the agent transcript's
 * `totalCost`, read from the cache ConversationPanel already fills — never a
 * second transcript fetch and no second observer on that query.
 */
function useTranscriptCost(entry: DirectoryEntry): number | null {
  const queryClient = useQueryClient();
  const agentId = entry.costUsd === null && entry.transcript?.route === 'agent' ? entry.transcript.agentId : null;
  const read = useCallback((): number | null => {
    if (!agentId) return null;
    const data = queryClient.getQueryData(conversationMessagesQueryKey(agentId));
    const total = (data as { totalCost?: unknown } | null | undefined)?.totalCost;
    return typeof total === 'number' && total > 0 ? total : null;
  }, [agentId, queryClient]);
  const subscribe = useCallback((onChange: () => void) => queryClient.getQueryCache().subscribe(onChange), [queryClient]);
  const transcriptCost = useSyncExternalStore(subscribe, read, read);
  return entry.costUsd ?? transcriptCost;
}

interface DirectoryDetailProps {
  entry: DirectoryEntry | null;
  entriesById: ReadonlyMap<string, DirectoryEntry>;
  onSelectEntry: (entryId: string) => void;
}

export function DirectoryDetail({ entry, entriesById, onSelectEntry }: DirectoryDetailProps) {
  if (!entry) {
    return <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">Select an agent to see its transcript.</div>;
  }
  return <DirectoryDetailBody key={entry.id} entry={entry} entriesById={entriesById} onSelectEntry={onSelectEntry} />;
}

function DirectoryDetailBody({ entry, entriesById, onSelectEntry }: { entry: DirectoryEntry } & Omit<DirectoryDetailProps, 'entry'>) {
  const now = useSharedTick();
  const cost = useTranscriptCost(entry);
  const [tellOpen, setTellOpen] = useState(false);
  const parent = entry.parentId ? entriesById.get(entry.parentId) : undefined;
  const isWorker = entry.role === 'worker' && entry.kind === 'agent' && entry.source === 'overdeck';

  return (
    <div className="flex h-full min-h-0 flex-col @container/detail" data-component="directory-detail">
      <header className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <DirectoryStateDot state={entry.state} />
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{entry.label}</h2>
          <span className="shrink-0 text-[12px] text-muted-foreground">{entry.state}</span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          <span className="font-mono-ui">{entry.id}</span>
          <span className="font-mono-ui">· {entry.harness} · {entry.model}</span>
          {entry.startedAt && <span>· started {formatRelativeTime(entry.startedAt, now)}</span>}
          {entry.lastActivityAt && <span>· active {formatRelativeTime(entry.lastActivityAt, now)}</span>}
          {cost !== null && <span className="font-mono-ui tabular-nums text-signal-cost">· {formatCost(cost)}</span>}
        </div>
        {entry.parentId && (
          <button
            type="button"
            onClick={() => parent && onSelectEntry(parent.id)}
            disabled={!parent}
            className="mt-1 text-[11px] text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
          >
            Spawned by {parent?.label ?? entry.parentId}
          </button>
        )}
        {isWorker && (
          <div className="mt-2">
            <button
              type="button"
              aria-expanded={tellOpen}
              onClick={() => setTellOpen((open) => !open)}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Message worker
            </button>
            {tellOpen && <TellComposer agentId={entry.id} isEffectivelyLive={isLiveState(entry.state)} />}
          </div>
        )}
      </header>
      {entry.issueId && <DirectoryIssueContext issueId={entry.issueId} />}
      <div className="flex min-h-0 flex-1 flex-col">
        <DirectoryTranscript entry={entry} onSelectEntry={onSelectEntry} />
      </div>
    </div>
  );
}
