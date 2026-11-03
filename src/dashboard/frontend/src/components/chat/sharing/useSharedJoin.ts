/**
 * The viewer page's join state (PAN-4475 WI-9): reads the join on mount, posts the join intent on
 * **Join** (D-1), subscribes to the join's event stream, and feeds `signal` events to one
 * `WebRtcViewer`. A join that leaves the live states closes the peer and the stream (D-10). A join
 * the server closed as `away` resumes without a second click (D-7).
 *
 * Drafts and prompts (PAN-4476 WI-13): `drafts` holds the other participants' drafts by author;
 * `setMyDraft` sends the viewer's own draft at most every DRAFT_SEND_MS (trailing); `submitPrompt`
 * posts a contributor prompt and clears the box. The viewer's own typing is not host content, so it
 * survives a reconnect, and every new negotiation re-sends it at once (`onReady`).
 *
 * `watchTerminal` (PAN-4477) registers the one terminal listener and turns the peer's terminal watch
 * on; terminal payloads go straight to that listener, never through React state (D-12). A peer
 * created while a listener is registered starts with the watch on.
 *
 * Control (PAN-4478 WI-6): the host's `identity` sets `selfGithubId`, and `isController` is true while
 * presence names this viewer as controller. `sendCommand` and `sendControllerPrompt` resolve on the
 * host's `command-ack`, reject with the refusal text, after COMMAND_ACK_TIMEOUT_MS without an ack, or
 * when the peer is reset.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sharedPromptRefusal,
  type DraftPayload,
  type JoinEvent,
  type JoinState,
  type JoinView,
  type PresencePayload,
  type SharedCommandRefusal,
  type SharedControllerCommand,
  type SharedMessage,
  type TerminalPayload,
} from '@overdeck/contracts';

import * as joinApi from './joinApi';
import { JoinApiError } from './joinApi';
import {
  WebRtcViewer,
  type CommandAck,
  type SubmitAck,
  type ViewerNotice,
  type ViewerPeerPhase,
  type WebRtcViewerCallbacks,
  type WebRtcViewerDeps,
} from './webrtc-viewer';

export type SharedJoinPhase = 'checking' | 'confirm' | 'joining' | 'live' | 'replaced-here' | 'error';

/** The longest wait between a keystroke and the draft snapshot it produces (D-11). */
export const DRAFT_SEND_MS = 150;
/** How long a controller command or send waits for the host's ack (D-13). */
export const COMMAND_ACK_TIMEOUT_MS = 10_000;

export interface SharedJoin {
  phase: SharedJoinPhase;
  view: JoinView | null;
  apiError: JoinApiError | null;
  peerPhase: ViewerPeerPhase;
  messages: readonly SharedMessage[];
  /** True once a `history` (or later content) arrived from the host on the current peer. */
  hasHistory: boolean;
  presence: PresencePayload | null;
  notices: readonly ViewerNotice[];
  /** The other participants' drafts, one per author. */
  drafts: readonly DraftPayload[];
  myDraft: string;
  setMyDraft(text: string): void;
  /** Contributors only: sends `myDraft` as a prompt and clears it. */
  submitPrompt(): void;
  submitStatus: SubmitAck | null;
  /** The host sent this viewer's suggestion. */
  draftSentNotice: boolean;
  /** This viewer's GitHub id, from the host's identity; null until it arrives. */
  selfGithubId: number | null;
  /** Presence names this viewer as the controller. */
  isController: boolean;
  /** Resolves when the host accepted the command; rejects with the reason text. */
  sendCommand(command: SharedControllerCommand): Promise<void>;
  /** Resolves to the 1-based queue position (0 when the host sent none). */
  sendControllerPrompt(text: string, draftGithubId?: number): Promise<number>;
  join(): void;
  leave(): void;
  reconnect(): void;
  /** Starts the host terminal stream for this listener; returns the function that stops it. */
  watchTerminal(listener: (payload: TerminalPayload) => void): () => void;
}

export type JoinApi = Pick<typeof joinApi, 'getJoin' | 'createJoin' | 'postSignal' | 'fetchJoinIceServers' | 'leaveJoin' | 'openJoinEvents'>;
export type ViewerPeer = Pick<
  WebRtcViewer,
  'onSignal' | 'close' | 'sendDraft' | 'submit' | 'setTerminalWatch' | 'command' | 'controllerSend'
>;
export type ViewerFactory = (deps: WebRtcViewerDeps, callbacks: WebRtcViewerCallbacks) => ViewerPeer;

export const LIVE_JOIN_STATES: ReadonlySet<JoinState> = new Set(['connecting', 'lobby', 'admitted', 'host-disconnected']);

const defaultViewer: ViewerFactory = (deps, callbacks) => new WebRtcViewer(deps, callbacks);

function asApiError(error: unknown): JoinApiError {
  if (error instanceof JoinApiError) return error;
  return new JoinApiError(0, 'join_failed', error instanceof Error ? error.message : String(error));
}

/** The message a rejected controller command or send shows. */
export function commandRefusalText(reason: SharedCommandRefusal | undefined): string {
  switch (reason) {
    case 'not_controller':
      return 'You no longer have control.';
    case 'unknown_participant':
      return 'That person is no longer in the room.';
    case 'invalid_target':
      return 'You cannot do that to yourself.';
    case 'invalid_command':
      return 'The host did not accept that action.';
    case 'not_connected':
      return 'The host is not connected to the share service.';
    case 'invalid_prompt':
      return 'Prompts cannot be empty or start with /, ! or #.';
    case 'too_long':
      return 'Prompts can be at most 8,000 characters.';
    case 'queue_full':
      return 'The queue is full. Try again later.';
    default:
      return 'The host did not accept that action.';
  }
}

interface PendingCommand {
  resolve(ack: CommandAck): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const CONNECTION_LOST = 'Connection to the host was lost.';

function sameNotice(a: ViewerNotice, b: ViewerNotice): boolean {
  return a.kind === b.kind && (a.kind !== 'hello_failed' || (b.kind === 'hello_failed' && a.code === b.code));
}

export function useSharedJoin(code: string, deps: { api?: JoinApi; viewer?: ViewerFactory } = {}): SharedJoin {
  const api = deps.api ?? joinApi;
  const makeViewer = deps.viewer ?? defaultViewer;
  const apiRef = useRef(api);
  const viewerFactoryRef = useRef(makeViewer);
  apiRef.current = api;
  viewerFactoryRef.current = makeViewer;

  const [phase, setPhase] = useState<SharedJoinPhase>('checking');
  const [view, setView] = useState<JoinView | null>(null);
  const [apiError, setApiError] = useState<JoinApiError | null>(null);
  const [peerPhase, setPeerPhase] = useState<ViewerPeerPhase>('waiting');
  const [messages, setMessages] = useState<readonly SharedMessage[]>([]);
  const [hasHistory, setHasHistory] = useState(false);
  const [presence, setPresence] = useState<PresencePayload | null>(null);
  const [notices, setNotices] = useState<readonly ViewerNotice[]>([]);
  const [drafts, setDrafts] = useState<readonly DraftPayload[]>([]);
  const [myDraft, setMyDraftState] = useState('');
  const [submitStatus, setSubmitStatus] = useState<SubmitAck | null>(null);
  const [draftSentNotice, setDraftSentNotice] = useState(false);
  const [selfGithubId, setSelfGithubId] = useState<number | null>(null);
  const pendingRef = useRef(new Map<string, PendingCommand>());
  const myDraftRef = useRef('');
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contributorRef = useRef(false);
  contributorRef.current = view?.contributor === true;

  const viewerRef = useRef<ViewerPeer | null>(null);
  const streamRef = useRef<{ close(): void } | null>(null);
  const terminalListenerRef = useRef<((payload: TerminalPayload) => void) | null>(null);
  const aliveRef = useRef(true);

  /** Rejects and forgets every command still waiting for its ack. */
  const failPending = useCallback((message: string) => {
    const pending = [...pendingRef.current.values()];
    pendingRef.current.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
  }, []);

  const closeViewer = useCallback(() => {
    viewerRef.current?.close();
    viewerRef.current = null;
    failPending(CONNECTION_LOST);
  }, [failPending]);

  const closeLive = useCallback(() => {
    closeViewer();
    streamRef.current?.close();
    streamRef.current = null;
  }, [closeViewer]);

  const cancelDraftTimer = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
  }, []);

  /** Clears the box locally; the caller decides whether the host needs an empty snapshot. */
  const clearMyDraft = useCallback(() => {
    cancelDraftTimer();
    myDraftRef.current = '';
    setMyDraftState('');
  }, [cancelDraftTimer]);

  const resetContent = useCallback(() => {
    setPeerPhase('waiting');
    setMessages([]);
    setHasHistory(false);
    setPresence(null);
    setNotices([]);
    setDrafts([]);
    setSubmitStatus(null);
    setDraftSentNotice(false);
    setSelfGithubId(null);
    failPending(CONNECTION_LOST);
  }, [failPending]);

  const ensureViewer = useCallback((): ViewerPeer => {
    if (viewerRef.current) return viewerRef.current;
    const created = viewerFactoryRef.current(
      {
        sendSignal: (data) => apiRef.current.postSignal(code, data),
        fetchIceServers: () => apiRef.current.fetchJoinIceServers(code),
      },
      {
        onMessages: (list) => {
          if (viewerRef.current !== created || !aliveRef.current) return;
          setMessages(list);
          setHasHistory(true);
        },
        onPresence: (next) => {
          if (viewerRef.current === created && aliveRef.current) setPresence(next);
        },
        onPhase: (next) => {
          if (viewerRef.current === created && aliveRef.current) setPeerPhase(next);
        },
        onNotice: (notice) => {
          if (viewerRef.current !== created || !aliveRef.current) return;
          setNotices((prev) => (prev.some((n) => sameNotice(n, notice)) ? prev : [...prev, notice]));
        },
        onDraft: (draft) => {
          if (viewerRef.current !== created || !aliveRef.current) return;
          setDrafts((prev) => {
            const index = prev.findIndex((d) => d.authorGithubId === draft.authorGithubId);
            if (draft.text === '') return index < 0 ? prev : prev.filter((_, i) => i !== index);
            return index < 0 ? [...prev, draft] : prev.map((d, i) => (i === index ? draft : d));
          });
        },
        onSubmitAck: (ack) => {
          if (viewerRef.current === created && aliveRef.current) setSubmitStatus(ack);
        },
        onDraftSent: () => {
          if (viewerRef.current !== created || !aliveRef.current) return;
          setDraftSentNotice(true);
          clearMyDraft();
          // A trailing snapshot sent just before the host took the draft would recreate it there.
          created.sendDraft('');
        },
        onReady: () => {
          if (viewerRef.current === created && aliveRef.current) created.sendDraft(myDraftRef.current);
        },
        onTerminal: (payload) => {
          if (viewerRef.current === created && aliveRef.current) terminalListenerRef.current?.(payload);
        },
        onIdentity: (githubId) => {
          if (viewerRef.current === created && aliveRef.current) setSelfGithubId(githubId);
        },
        onCommandAck: (ack) => {
          if (viewerRef.current !== created) return;
          const entry = pendingRef.current.get(ack.clientId);
          if (!entry) return;
          pendingRef.current.delete(ack.clientId);
          clearTimeout(entry.timer);
          if (ack.status === 'accepted') entry.resolve(ack);
          else entry.reject(new Error(commandRefusalText(ack.reason)));
        },
      },
    );
    viewerRef.current = created;
    if (terminalListenerRef.current) created.setTerminalWatch(true);
    return created;
  }, [clearMyDraft, code]);

  const setMyDraft = useCallback((text: string) => {
    myDraftRef.current = text;
    setMyDraftState(text);
    setDraftSentNotice(false);
    if (draftTimerRef.current) return;
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      viewerRef.current?.sendDraft(myDraftRef.current);
    }, DRAFT_SEND_MS);
  }, []);

  const submitPrompt = useCallback(() => {
    const viewer = viewerRef.current;
    const text = myDraftRef.current;
    if (!viewer || !contributorRef.current || sharedPromptRefusal(text) !== null) return;
    const clientId = crypto.randomUUID();
    if (!viewer.submit(clientId, text)) {
      // The channel is not open: keep the text and say the prompt did not go out.
      setSubmitStatus({ clientId, status: 'rejected' });
      return;
    }
    clearMyDraft();
    setSubmitStatus(null);
    viewer.sendDraft('');
  }, [clearMyDraft]);

  /** Sends one controller message and waits for its ack. */
  const awaitAck = useCallback((send: (viewer: ViewerPeer, clientId: string) => boolean): Promise<CommandAck> => {
    const viewer = viewerRef.current;
    const clientId = crypto.randomUUID();
    if (!viewer || !send(viewer, clientId)) return Promise.reject(new Error('Not connected to the host.'));
    return new Promise<CommandAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(clientId);
        reject(new Error('The host did not answer.'));
      }, COMMAND_ACK_TIMEOUT_MS);
      pendingRef.current.set(clientId, { resolve, reject, timer });
    });
  }, []);

  const sendCommand = useCallback(
    (command: SharedControllerCommand) => awaitAck((viewer, clientId) => viewer.command(clientId, command)).then(() => undefined),
    [awaitAck],
  );

  const sendControllerPrompt = useCallback(
    (text: string, draftGithubId?: number) =>
      awaitAck((viewer, clientId) => viewer.controllerSend(clientId, text, draftGithubId)).then((ack) => ack.position ?? 0),
    [awaitAck],
  );

  const subscribe = useCallback(() => {
    closeLive();
    const stream = apiRef.current.openJoinEvents(code, {
      onEvent: (event: JoinEvent) => {
        if (streamRef.current !== stream || !aliveRef.current) return;
        if (event.type === 'state') {
          setView(event.view);
          if (!LIVE_JOIN_STATES.has(event.view.state)) closeLive();
        } else if (event.type === 'signal') {
          ensureViewer().onSignal(event.data);
        } else if (event.type === 'replaced') {
          closeLive();
          setPhase('replaced-here');
        }
      },
      onError: (closed) => {
        if (streamRef.current !== stream || !aliveRef.current || !closed) return;
        // A non-200 answer (for example 404 after the viewer server restarted): EventSource gives up.
        closeLive();
        setApiError(new JoinApiError(0, 'events_closed', 'Lost the connection to your Overdeck.'));
        setPhase('error');
      },
    });
    streamRef.current = stream;
    setPhase('live');
  }, [closeLive, code, ensureViewer]);

  const join = useCallback(() => {
    closeLive();
    resetContent();
    setApiError(null);
    setPhase('joining');
    apiRef.current.createJoin(code).then(
      (joined) => {
        if (!aliveRef.current) return;
        setView(joined);
        subscribe();
      },
      (error: unknown) => {
        if (!aliveRef.current) return;
        setApiError(asApiError(error));
        setPhase('error');
      },
    );
  }, [closeLive, code, resetContent, subscribe]);

  const leave = useCallback(() => {
    closeLive();
    resetContent();
    clearMyDraft();
    apiRef.current.leaveJoin(code).then(
      () => {
        if (!aliveRef.current) return;
        setView((prev) => (prev ? { ...prev, state: 'left' } : prev));
        setPhase('live');
      },
      (error: unknown) => {
        if (!aliveRef.current) return;
        setApiError(asApiError(error));
        setPhase('error');
      },
    );
  }, [clearMyDraft, closeLive, code, resetContent]);

  const reconnect = useCallback(() => {
    // A new event stream is a new subscriber; the viewer server restarts the socket so the host
    // offers again (D-5, D-11).
    resetContent();
    subscribe();
  }, [resetContent, subscribe]);

  const watchTerminal = useCallback((listener: (payload: TerminalPayload) => void) => {
    terminalListenerRef.current = listener;
    viewerRef.current?.setTerminalWatch(true);
    return () => {
      // A newer listener owns the watch now; leave it on.
      if (terminalListenerRef.current !== listener) return;
      terminalListenerRef.current = null;
      viewerRef.current?.setTerminalWatch(false);
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    apiRef.current.getJoin(code).then(
      (current) => {
        if (cancelled) return;
        setView(current);
        if (current === null || (!LIVE_JOIN_STATES.has(current.state) && current.state !== 'away')) setPhase('confirm');
        else if (current.state === 'away') join();
        else subscribe();
      },
      (error: unknown) => {
        if (cancelled) return;
        setApiError(asApiError(error));
        setPhase('error');
      },
    );
    return () => {
      cancelled = true;
      aliveRef.current = false;
      closeLive();
      cancelDraftTimer();
    };
    // Mount-only per code: join and subscribe are stable for a given code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return {
    phase,
    view,
    apiError,
    peerPhase,
    messages,
    hasHistory,
    presence,
    notices,
    drafts,
    myDraft,
    setMyDraft,
    submitPrompt,
    submitStatus,
    draftSentNotice,
    selfGithubId,
    isController: selfGithubId !== null && presence?.controllerGithubId === selfGithubId,
    sendCommand,
    sendControllerPrompt,
    join,
    leave,
    reconnect,
    watchTerminal,
  };
}
