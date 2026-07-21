import { useQuery } from '@tanstack/react-query';
import { EventRouter } from '../components/EventRouter';
import { StandaloneTerminal } from '../components/StandaloneTerminal';
import { DiffPanel } from '../components/DiffPanel';
import { DiffWorkerPoolProvider } from '../components/DiffWorkerPoolProvider';
import type { TurnDiffSummary } from '../components/chat/chat-types';
import { ConversationPanel } from '../components/chat/ConversationPanel';
import type { ViewMode as ConversationViewMode } from '../components/chat/ConversationPanel';
import type { Conversation } from '../components/CommandDeck/ConversationList';
import { FlywheelConversationPane } from '../components/flywheel/FlywheelConversationPane';
import { useCodexAutoRetry } from '../hooks/useCodexAutoRetry';

export function StandaloneTerminalRoute({ sessionName, token }: { sessionName: string; token?: string }) {
  useCodexAutoRetry();
  return (
    <div className="h-screen overflow-hidden bg-[#0d1117]">
      <EventRouter />
      <StandaloneTerminal sessionName={sessionName} token={token} />
    </div>
  );
}

export function StandaloneFlywheelPopoutRoute() {
  useCodexAutoRetry();
  return (
    <div className="h-screen overflow-hidden bg-background">
      <EventRouter />
      <FlywheelConversationPane />
    </div>
  );
}

/**
 * Standalone conversation popout (/popout/conversation/<id>). Renders ONLY the
 * conversation — no sidebar, awareness rail, status pills, or other dashboard
 * chrome. This is the target for the in-pane "Detach" button, drag-to-detach
 * in the PaneBar, and the ⋮ → "Pop out to window" menu item; users want to
 * focus on one conversation, not duplicate the whole app.
 *
 * Fetches the conversation by numeric id via /api/conversations/<id> (the same
 * endpoint the host app uses), then mounts <ConversationPanel> directly. The
 * EventRouter is included so live updates (new messages, status changes) keep
 * flowing in via the existing WebSocket transport — standalone != disconnected.
 *
 * Optional query params:
 *   view=terminal   start in terminal mode (matches the /conv/<id>?view=... deep-link).
 */
export function StandaloneConversationPopoutRoute({ conversationId }: { conversationId: string }) {
  useCodexAutoRetry();
  const numericId = Number(conversationId);
  const viewParam = new URLSearchParams(window.location.search).get('view');
  const viewMode: ConversationViewMode = viewParam === 'terminal' ? 'terminal' : 'conversation';
  const { data: conversation, isError, isLoading } = useQuery({
    queryKey: ['popout-conversation', numericId],
    queryFn: async () => {
      const res = await fetch(`/api/conversations/${numericId}`);
      if (!res.ok) throw new Error(`Failed to load conversation: ${res.status}`);
      return (await res.json()) as Conversation;
    },
    enabled: Number.isFinite(numericId) && numericId > 0,
    // Same cadence as the inline panel — keeps status (sessionAlive, etc.) fresh
    // without hammering the server. The EventRouter handles the streaming path.
    refetchInterval: 5000,
  });

  return (
    <div className="h-screen overflow-hidden bg-background">
      <EventRouter />
      {!Number.isFinite(numericId) || numericId <= 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Invalid conversation id.
        </div>
      ) : isLoading && conversation === undefined ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Loading conversation…
        </div>
      ) : isError || conversation === undefined ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Couldn’t load this conversation. It may have been archived or deleted.
        </div>
      ) : (
        <ConversationPanel
          conversation={conversation}
          viewMode={viewMode}
          onArchived={() => window.close()}
        />
      )}
    </div>
  );
}

/**
 * Standalone diff popout (/popout/diff). Renders ONLY the diff — not the host
 * conversation/agent page. The pop-out button in DiffPanel passes `prefix` (the
 * diff fetch base, e.g. /api/conversations/<name>/diffs) plus the selected
 * turn/file via query params; this route refetches the turn summaries from that
 * base and mounts a bare full-width DiffPanel. Theme is applied at module load
 * from localStorage, and diffs are REST-driven, so no EventRouter is needed.
 */
export function StandaloneDiffPopoutRoute() {
  useCodexAutoRetry();
  const search = new URLSearchParams(window.location.search);
  const prefix = search.get('prefix') ?? '';
  const agentId = search.get('agentId') ?? prefix;
  const { data, isError } = useQuery({
    queryKey: ['popout-diff-summaries', prefix],
    queryFn: async () => {
      const res = await fetch(prefix);
      if (!res.ok) throw new Error(`Failed to load diff summaries: ${res.status}`);
      return (await res.json()) as { summaries: TurnDiffSummary[] };
    },
    enabled: prefix.length > 0,
    // Same cadence as the inline panel (ConversationPanel) — keeps summaries
    // fresh as turns complete AND self-heals after a transient backend outage
    // (e.g. a watchdog dashboard restart) instead of dead-ending on the error
    // state after the default 3 retries.
    refetchInterval: 5000,
  });
  return (
    <div className="h-screen overflow-hidden bg-background">
      {prefix.length === 0 || (isError && data === undefined) ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {prefix.length === 0 ? 'Missing diff source.' : 'Failed to load this diff — retrying…'}
        </div>
      ) : data === undefined ? (
        // The summaries endpoint shells out to git per turn and can take seconds
        // on a long conversation — without this gate, DiffPanel mounts with an
        // empty summary list and shows a misleading "No completed turns yet."
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          Loading diff…
        </div>
      ) : (
        <DiffWorkerPoolProvider>
          <DiffPanel
            mode="sheet"
            agentId={agentId}
            turnDiffSummaries={data.summaries}
            diffUrlPrefix={prefix}
          />
        </DiffWorkerPoolProvider>
      )}
    </div>
  );
}
