/**
 * The conversation TERMINAL view (PAN-3974).
 *
 * Harnesses without a companion terminal render exactly what TERMINAL always
 * rendered: the owner session's pane. Harnesses with one (OpenCode's
 * `opencode attach`, PAN-3974; Codex's `codex resume --remote`, PAN-3835) get
 * two panes:
 *
 * - Native CLI — a companion terminal the server opens (or reuses) running
 *   the harness's own client attached to the same session. Leaving the view or
 *   closing the tab only detaches the browser; Close stops the companion.
 * - Runtime log — the owner pane, as before.
 *
 * Dashboard messages never go through the companion; the composer keeps using
 * the structured delivery path.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { companionTerminalKindFor, type CompanionTerminalUnavailableReason } from '@overdeck/contracts';
import { XTerminal } from '../XTerminal';
import { ViewToggle } from '../shared/ViewToggle';
import { closeCompanionTerminal, openCompanionTerminal } from './companionTerminalApi';
import styles from '../CommandDeck/styles/command-deck.module.css';

export interface ConversationTerminalViewProps {
  conversation: {
    name: string;
    tmuxSession: string;
    harness?: string | null;
  };
}

type Pane = 'native' | 'runtime';

type CompanionPhase =
  | { phase: 'opening' }
  | { phase: 'attached'; sessionName: string; generation: string }
  | { phase: 'unavailable'; reason: CompanionTerminalUnavailableReason; message: string }
  | { phase: 'closed' }
  | { phase: 'ended' }
  | { phase: 'error'; message: string };

const PANE_OPTIONS: Array<{ id: Pane; label: string }> = [
  { id: 'native', label: 'Native CLI' },
  { id: 'runtime', label: 'Runtime log' },
];

export function ConversationTerminalView({ conversation }: ConversationTerminalViewProps) {
  if (!companionTerminalKindFor(conversation)) {
    return <XTerminal sessionName={conversation.tmuxSession} />;
  }
  return <CompanionTerminalView key={conversation.name} conversation={conversation} />;
}

function CompanionTerminalView({ conversation }: ConversationTerminalViewProps) {
  const [pane, setPane] = useState<Pane>('native');
  const [ownPaneFirst, setOwnPaneFirst] = useState(false);
  const runtimeFirst = useRef(false);
  const [state, setState] = useState<CompanionPhase>({ phase: 'opening' });
  const [closing, setClosing] = useState(false);
  // Only the newest request may write state: a slow response from an earlier
  // open must not replace a newer one.
  const requestSeq = useRef(0);

  const open = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'opening' });
    try {
      const result = await openCompanionTerminal(conversation.name);
      if (seq !== requestSeq.current) return;
      if (result.status === 'attached') {
        setState({ phase: 'attached', sessionName: result.sessionName, generation: result.generation });
      } else if (result.status === 'unavailable') {
        setState({ phase: 'unavailable', reason: result.reason, message: result.message });
        // A harness whose own pane is the interactive CLI (legacy
        // `codex.transport: tui`) opens straight on Runtime log, as before the
        // companion existed. Only on the first answer, so choosing Native CLI
        // afterwards still shows why it is unavailable.
        if (result.reason === 'unsupported' && !runtimeFirst.current) {
          runtimeFirst.current = true;
          setOwnPaneFirst(true);
          setPane('runtime');
        }
      } else {
        setState({ phase: 'closed' });
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [conversation.name]);

  // Opening the Native CLI pane opens or reuses the companion. Unmounting
  // (Conversation view, another conversation, a closed tab) never closes it.
  useEffect(() => {
    if (pane === 'native') void open();
    return () => {
      requestSeq.current += 1;
    };
  }, [pane, open]);

  const close = useCallback(async () => {
    if (state.phase !== 'attached') return;
    const seq = ++requestSeq.current;
    setClosing(true);
    try {
      const result = await closeCompanionTerminal(conversation.name, state.generation);
      if (seq !== requestSeq.current) return;
      if (result.status === 'stale-generation') {
        setState({ phase: 'unavailable', reason: 'owner-changed', message: result.message });
      } else {
        setState({ phase: 'closed' });
      }
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setClosing(false);
    }
  }, [conversation.name, state]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="companion-terminal-view">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <ViewToggle ariaLabel="Terminal pane" value={pane} onChange={setPane} options={ownPaneFirst ? [...PANE_OPTIONS].reverse() : PANE_OPTIONS} />
        {pane === 'native' && state.phase === 'attached' && (
          <button
            type="button"
            className={styles.conversationAboutToggle}
            onClick={() => void close()}
            disabled={closing}
            title="Stop the native CLI. The conversation keeps running."
          >
            {closing ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            <span>Close native CLI</span>
          </button>
        )}
      </div>
      {pane === 'runtime' ? (
        <XTerminal sessionName={conversation.tmuxSession} />
      ) : state.phase === 'attached' ? (
        <XTerminal
          key={`${state.sessionName}:${state.generation}`}
          sessionName={state.sessionName}
          onDisconnect={() => setState({ phase: 'ended' })}
        />
      ) : (
        <CompanionNotice state={state} onOpen={() => void open()} onRuntimeLog={() => setPane('runtime')} />
      )}
    </div>
  );
}

function CompanionNotice({
  state,
  onOpen,
  onRuntimeLog,
}: {
  state: Exclude<CompanionPhase, { phase: 'attached' }>;
  onOpen: () => void;
  onRuntimeLog: () => void;
}) {
  if (state.phase === 'opening') {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 size={14} className="animate-spin" />
        <span>Attaching the native CLI…</span>
      </div>
    );
  }
  const { title, message, canOpen } = noticeCopy(state);
  return (
    <div className="flex flex-1 items-start justify-center overflow-auto p-6">
      <div className="max-w-xl rounded-md border border-border bg-card p-4" role="status" data-testid="companion-terminal-notice">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
        <div className="mt-3 flex gap-2">
          {canOpen && (
            <button type="button" className={styles.conversationAboutToggle} onClick={onOpen}>
              {state.phase === 'closed' || state.phase === 'ended' ? 'Open native CLI' : 'Try again'}
            </button>
          )}
          <button type="button" className={styles.conversationAboutToggle} onClick={onRuntimeLog}>
            Show runtime log
          </button>
        </div>
      </div>
    </div>
  );
}

function unavailableTitle(reason: CompanionTerminalUnavailableReason): string {
  if (reason === 'restart-required') return 'Restart required for the native CLI';
  if (reason === 'cli-unsupported') return 'Upgrade required for the native CLI';
  if (reason === 'session-not-started') return 'Native CLI not available yet';
  return 'Native CLI unavailable';
}

function noticeCopy(state: Exclude<CompanionPhase, { phase: 'attached' | 'opening' }>): {
  title: string;
  message: string;
  canOpen: boolean;
} {
  switch (state.phase) {
    case 'closed':
      return { title: 'Native CLI closed', message: 'The conversation is still running.', canOpen: true };
    case 'ended':
      return {
        title: 'Native CLI exited',
        message: 'The native CLI stopped. The conversation is unaffected.',
        canOpen: true,
      };
    case 'error':
      return { title: 'Could not attach the native CLI', message: state.message, canOpen: true };
    case 'unavailable':
      return {
        title: unavailableTitle(state.reason),
        message: state.message,
        // Restarting, upgrading, or a harness without a companion cannot be
        // fixed by retrying the attach. Everything else can be retried.
        canOpen: state.reason !== 'restart-required' && state.reason !== 'unsupported' && state.reason !== 'cli-unsupported',
      };
  }
}
