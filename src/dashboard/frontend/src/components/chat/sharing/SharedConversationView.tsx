/**
 * The viewer page for a Shared Session at `/#/shared/<code>` (PAN-4475 WI-9, FR-7 … FR-10).
 *
 * `SharedConversationView` is presentational: one screen per join state, with **Leave** while the
 * join is live. A lobby viewer never mounts the timeline and never renders host content (FR-9).
 * Once admitted and a history arrived, the host conversation renders through `MessagesTimeline`
 * with an empty work log (D-13); the header shows the stream label, the host and the watcher
 * count (D-19). `SharedConversationRoute` binds it to `useSharedJoin`.
 *
 * Under the timeline, `SharedComposer` (PAN-4476 WI-13) shows the queue line, the other
 * participants' drafts and the viewer's own draft box. A contributor also gets **Send prompt**
 * (and Ctrl/Cmd+Enter); everyone else's box is a suggestion the host can pick.
 *
 * Once the peer is connected, a **Conversation** / **Terminal** toggle switches the admitted screen
 * to `SharedTerminalView`, the host's read-only terminal (PAN-4477). Conversation is the default.
 *
 * Control (PAN-4478 WI-9): while presence names this viewer as controller, `SharedControllerPanel`
 * shows **You have control** with **Hand control back** and the lobby roster's controller actions
 * (no Blocked section, no un-revoke), each sent over `control` and answered by the host's ack. The
 * controller's composer sends prompts as controller sends and can pick the others' suggestions.
 * Every viewer's header says who has control while a viewer holds it.
 */
import {
  sharedPromptRefusal,
  type PresencePayload,
  type ShareCommand,
  type SharedMessage,
  type SharedSubmitReason,
} from '@overdeck/contracts';
import { useState, type ReactNode } from 'react';

import type { ChatMessage } from '../chat-types';
import { MessagesTimeline } from '../MessagesTimeline';
import { SharedTerminalView } from './SharedTerminalView';
import { LobbyRoster } from './SharingLobbyPanel';
import { queueStatusText, SuggestionList, type SuggestionItem } from './SuggestionList';
import { LIVE_JOIN_STATES, useSharedJoin, type SharedJoin } from './useSharedJoin';
import type { SubmitAck, ViewerNotice } from './webrtc-viewer';

const NEUTRAL_BUTTON =
  'rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON =
  'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50';
const BANNER = 'flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground';

/** Copies the fields the timeline reads, field by field (D-13), including a shared prompt's `author`. */
export function toChatMessage(m: SharedMessage): ChatMessage {
  const message: ChatMessage = { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt };
  if (m.turnId !== undefined) message.turnId = m.turnId;
  if (m.completedAt !== undefined) message.completedAt = m.completedAt;
  if (m.streaming !== undefined) message.streaming = m.streaming;
  if (m.sequence !== undefined) message.sequence = m.sequence;
  if (m.author !== undefined) message.author = { login: m.author.login, avatarUrl: m.author.avatarUrl };
  return message;
}

export function submitReasonText(reason: SharedSubmitReason | undefined): string {
  switch (reason) {
    case 'not_contributor':
    case 'grant_revoked':
      return 'You can no longer send prompts directly.';
    case 'queue_full': return 'The queue is full. Try again later.';
    case 'invalid_prompt': return 'Prompts cannot be empty or start with /, ! or #.';
    case 'too_long': return 'Prompts can be at most 8,000 characters.';
    case 'delivery_refused': return 'The host could not deliver your prompt.';
    case 'delivery_unknown': return 'The host may not have delivered your prompt.';
    default: return 'Your prompt was not sent.';
  }
}

function submitStatusText(status: SubmitAck): string {
  if (status.status === 'queued') return status.position ? `Queued (#${status.position})` : 'Queued';
  if (status.status === 'sent') return 'Sent';
  return submitReasonText(status.reason);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The host did not accept that action.';
}

/** The viewer-controller's lobby (FR-12): hand control back, and the roster's controller actions. */
function SharedControllerPanel(props: SharedJoin) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presence = props.presence;
  const self = props.selfGithubId;
  if (!props.isController || !presence || self === null) return null;
  const host = presence.participants.find((p) => p.isHost) ?? null;

  const run = (command: ShareCommand) => {
    // A viewer-controller cannot un-revoke (D-7); the roster never offers it here.
    if (command.type === 'unrevoke') return;
    setPending(true);
    setError(null);
    props.sendCommand(command).then(
      () => setPending(false),
      (failure: unknown) => {
        setPending(false);
        setError(errorText(failure));
      },
    );
  };

  return (
    <div data-component="shared-controller" className="space-y-3 border-t border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">You have control</h2>
        {host ? (
          <button
            type="button"
            className={`${NEUTRAL_BUTTON} ml-auto`}
            disabled={pending}
            onClick={() => run({ type: 'set-controller', githubId: host.githubId })}
          >
            Hand control back to @{host.login}
          </button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <LobbyRoster
        people={presence.participants.filter((p) => !p.isHost)}
        blocked={null}
        controllerGithubId={presence.controllerGithubId}
        selfGithubId={self}
        canAct
        disabled={pending}
        onCommand={run}
      />
    </div>
  );
}

function SharedComposer(props: SharedJoin) {
  const [controllerStatus, setControllerStatus] = useState<string | null>(null);
  const controller = props.isController;
  const contributor = props.view?.contributor === true;
  const queueLine = queueStatusText(props.presence?.streams[0]);
  const participants = props.presence?.participants ?? [];
  const suggestions: SuggestionItem[] = props.drafts.map((draft) => ({
    githubId: draft.authorGithubId,
    login: draft.authorLogin,
    avatarUrl: participants.find((p) => p.githubId === draft.authorGithubId)?.avatarUrl ?? null,
    text: draft.text,
  }));
  // The prefix hint is only for a prefix; an empty or blank box just disables Send.
  const refusal = props.myDraft.trim() === '' ? null : sharedPromptRefusal(props.myDraft);
  const canSend = (controller || contributor) && sharedPromptRefusal(props.myDraft) === null;
  const sendAsController = () => {
    const text = props.myDraft;
    if (sharedPromptRefusal(text) !== null) return;
    setControllerStatus(null);
    props.sendControllerPrompt(text).then(
      (position) => {
        props.setMyDraft('');
        setControllerStatus(position ? `Queued (#${position})` : 'Queued');
      },
      (failure: unknown) => setControllerStatus(errorText(failure)),
    );
  };
  const send = controller ? sendAsController : props.submitPrompt;
  const status = controller ? controllerStatus : props.submitStatus ? submitStatusText(props.submitStatus) : null;
  return (
    <div data-component="shared-composer" className="space-y-2 border-t border-border px-4 py-3">
      {queueLine ? <p role="status" className="text-xs text-muted-foreground">{queueLine}</p> : null}
      {controller ? (
        <SuggestionList
          items={suggestions}
          mode="controller"
          onSend={(item, text) => props.sendControllerPrompt(text, item.githubId).then(() => undefined)}
        />
      ) : (
        <SuggestionList items={suggestions} mode="view" />
      )}
      <textarea
        aria-label={controller || contributor ? 'Write a prompt' : 'Suggest a prompt'}
        className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        rows={3}
        maxLength={8000}
        value={props.myDraft}
        onChange={(event) => props.setMyDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((controller || contributor) && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {controller || contributor ? (
          <button type="button" className={NEUTRAL_BUTTON} aria-label="Send prompt" disabled={!canSend} onClick={send}>
            Send
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">The host can pick your suggestion and send it.</p>
        )}
        {status ? <p role="status" className="text-xs text-muted-foreground">{status}</p> : null}
      </div>
      {(controller || contributor) && refusal === 'invalid_prompt' ? <p className="text-xs text-muted-foreground">Prompts cannot start with /, ! or #.</p> : null}
      {props.draftSentNotice ? <p role="status" className="text-xs text-muted-foreground">The host sent your suggestion.</p> : null}
    </div>
  );
}

export function formatShareCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export function noticeText(notice: ViewerNotice): string {
  switch (notice.kind) {
    case 'host_newer': return 'The host is on a newer Overdeck. Some content may not show.';
    case 'scope_unsupported': return 'Your Overdeck is too old for this share type. Update Overdeck to join.';
    case 'hello_failed': return `Could not start the shared session (${notice.code}).`;
    case 'transcript_unavailable': return "The host's conversation transcript is not available.";
    case 'history_too_large': return 'This conversation is too long to share.';
    case 'updates_missed': return 'Some updates were missed. Reconnect to resync.';
  }
}

function Panel({ heading, children }: { heading?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {heading ? <h1 className="text-base font-medium text-foreground">{heading}</h1> : null}
      {children}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="max-w-md text-sm text-muted-foreground">{children}</p>;
}

function Command({ children }: { children: string }) {
  return <code className="rounded-md border border-border px-2 py-1 font-mono text-xs text-foreground">{children}</code>;
}

function BackLink() {
  return <a href="/" className="text-sm text-primary underline-offset-2 hover:underline">Back to the dashboard</a>;
}

function Header({ code, presence, live, onLeave }: { code: string; presence: PresencePayload | null; live: boolean; onLeave: () => void }) {
  const host = presence?.participants.find((p) => p.isHost) ?? null;
  const streamLabel = presence?.streams[0]?.label ?? null;
  const watching = presence ? presence.participants.filter((p) => !p.isHost && p.state === 'admitted').length : 0;
  const controller = presence && host && presence.controllerGithubId !== host.githubId
    ? presence.participants.find((p) => p.githubId === presence.controllerGithubId) ?? null
    : null;
  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2">
      <span className="min-w-0 truncate text-sm font-medium text-foreground">{streamLabel ?? 'Shared conversation'}</span>
      {host ? (
        <span className="flex shrink-0 items-center gap-1.5">
          <img src={host.avatarUrl} alt="" width={20} height={20} className="h-5 w-5 rounded-md" />
          <span className="font-mono text-xs text-muted-foreground">@{host.login}</span>
        </span>
      ) : null}
      {presence ? <span className="shrink-0 text-xs text-muted-foreground">{watching} watching</span> : null}
      {controller ? <span className="shrink-0 text-xs text-muted-foreground">@{controller.login} has control</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{formatShareCode(code)}</span>
        {live ? <button type="button" className={NEUTRAL_BUTTON} onClick={onLeave}>Leave</button> : null}
      </span>
    </header>
  );
}

function errorScreen(props: SharedJoin): ReactNode {
  const error = props.apiError;
  if (error?.status === 412) {
    return (
      <Panel heading="Sign in to join">
        <Command>pan account login</Command>
      </Panel>
    );
  }
  if (error?.error === 'events_closed') {
    return (
      <Panel heading="Lost the connection to your Overdeck.">
        <button type="button" className={NEUTRAL_BUTTON} onClick={props.join}>Try again</button>
      </Panel>
    );
  }
  return (
    <Panel heading="Could not join">
      <Note>{error?.message ?? 'Something went wrong.'}</Note>
      <button type="button" className={NEUTRAL_BUTTON} onClick={props.join}>Try again</button>
    </Panel>
  );
}

function confirmScreen(props: SharedJoin): ReactNode {
  return (
    <Panel heading="Join a shared conversation">
      <Note>The host will see your GitHub name and avatar before letting you in.</Note>
      <button type="button" className={PRIMARY_BUTTON} onClick={props.join}>Join</button>
    </Panel>
  );
}

/** The screen for a join that is no longer live; null for a live state. */
function terminalScreen(props: SharedJoin): ReactNode {
  switch (props.view?.state) {
    case 'kicked':
      return (
        <Panel heading="Removed by host">
          <Note>You can ask to join again.</Note>
          <button type="button" className={NEUTRAL_BUTTON} onClick={props.join}>Ask to join again</button>
        </Panel>
      );
    case 'revoked':
      return <Panel heading="Removed by host"><Note>The host blocked you from this share.</Note></Panel>;
    case 'ended':
      return <Panel heading="This share has ended." />;
    case 'left':
      return <Panel heading="You left the shared conversation."><BackLink /></Panel>;
    case 'is-host':
      return <Panel heading="This is your own share."><BackLink /></Panel>;
    case 'full':
      return <Panel heading="This share is full." />;
    case 'replaced':
      return <Panel heading="This share is open in another tab or on another device." />;
    case 'rejected':
      return (
        <Panel heading="overdeck.ai did not accept this machine's sign-in.">
          <Command>pan account login</Command>
        </Panel>
      );
    case 'disconnected':
    case 'away':
      return (
        <Panel heading="Lost the connection to the share service.">
          <button type="button" className={NEUTRAL_BUTTON} onClick={props.join}>Rejoin</button>
        </Panel>
      );
    default:
      return null;
  }
}

function AdmittedScreen(props: SharedJoin) {
  const [surface, setSurface] = useState<'conversation' | 'terminal'>('conversation');
  const reconnecting = props.view?.state === 'reconnecting';
  const hostDisconnected = props.view?.state === 'host-disconnected';
  const lost = props.peerPhase === 'lost';
  // A kept timeline stays visible while the host renegotiates (PAN-4479 FR-11).
  const showTimeline = props.hasHistory;
  const showToggle = props.peerPhase === 'connected' || ((hostDisconnected || reconnecting) && props.hasHistory);
  const messages = props.messages.map(toChatMessage);
  const toggle = (value: 'conversation' | 'terminal', label: string) => (
    <button type="button" className={`${NEUTRAL_BUTTON} aria-pressed:bg-accent`} aria-pressed={surface === value} onClick={() => setSurface(value)}>
      {label}
    </button>
  );
  let banner: ReactNode = null;
  if (reconnecting) banner = <div className={BANNER} role="status">Reconnecting to the share service…</div>;
  else if (hostDisconnected) banner = <div className={BANNER} role="status">Host disconnected — reconnecting…</div>;
  else if (lost) {
    banner = (
      <div className={BANNER} role="status">
        <span>Connection to the host was lost.</span>
        <button type="button" className={NEUTRAL_BUTTON} onClick={props.reconnect}>Reconnect</button>
      </div>
    );
  }
  if (surface === 'terminal' && !lost) {
    // Stays mounted through a renegotiation, so the new peer re-sends the watch (FR-7).
    return (
      <>
        {banner}
        {showToggle ? viewToggle(toggle) : null}
        <SharedTerminalView watch={props.watchTerminal} />
      </>
    );
  }
  return (
    <>
      {banner}
      {props.notices.map((notice) => (
        <p key={notice.kind} className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">{noticeText(notice)}</p>
      ))}
      {showToggle ? viewToggle(toggle) : null}
      {showTimeline ? (
        <div data-testid="shared-conversation-timeline" className="flex min-h-0 flex-1 flex-col">
          <MessagesTimeline
            messages={messages}
            workLog={[]}
            streaming={props.messages.some((m) => m.streaming === true)}
            conversationName={`shared:${props.view?.shortCode ?? ''}`}
            cwd=""
          />
        </div>
      ) : lost ? null : (
        <Panel><Note>Connecting to the host…</Note></Panel>
      )}
      <SharedControllerPanel {...props} />
      {showTimeline ? <SharedComposer {...props} /> : null}
    </>
  );
}

function viewToggle(toggle: (value: 'conversation' | 'terminal', label: string) => ReactNode): ReactNode {
  return (
    <div role="group" aria-label="Shared view" data-testid="shared-view-toggle" className="flex items-center gap-2 border-b border-border px-4 py-1.5">
      {toggle('conversation', 'Conversation')}
      {toggle('terminal', 'Terminal')}
    </div>
  );
}

function body(props: SharedJoin & { code: string }): ReactNode {
  if (props.phase === 'checking') return <Panel><Note>Loading…</Note></Panel>;
  if (props.phase === 'replaced-here') return <Panel heading="This share is open in another tab or on another device." />;
  if (props.phase === 'error') return errorScreen(props);
  if (props.phase === 'joining') return <Panel><Note>Connecting…</Note></Panel>;
  const state = props.view?.state;
  if (props.phase === 'confirm' && (!state || state === 'left')) return confirmScreen(props);
  switch (state) {
    case undefined:
      return <Panel><Note>Connecting…</Note></Panel>;
    case 'connecting':
      // History means a restart of an admitted join (an automatic or manual retry keeps it, PAN-4479
      // D-8): keep the admitted screen and its surface instead of blanking to "Connecting…".
      return props.hasHistory ? <AdmittedScreen {...props} /> : <Panel><Note>Connecting…</Note></Panel>;
    case 'lobby':
      return (
        <Panel heading="Waiting for the host to let you in">
          <Note>You are in the lobby as <span className="font-mono">@{props.view?.login ?? 'you'}</span>.</Note>
        </Panel>
      );
    case 'admitted':
    case 'host-disconnected':
      return <AdmittedScreen {...props} />;
    case 'reconnecting':
      return props.hasHistory ? <AdmittedScreen {...props} /> : <Panel><Note>Reconnecting to the share service…</Note></Panel>;
    default:
      return terminalScreen(props);
  }
}

export function SharedConversationView(props: SharedJoin & { code: string }) {
  const state = props.view?.state;
  const live = props.phase === 'live' && state !== undefined && LIVE_JOIN_STATES.has(state);
  const dataState = props.phase === 'live' ? state ?? 'connecting' : props.phase;
  return (
    <div data-component="shared-conversation" data-state={dataState} className="flex h-screen flex-col bg-background">
      <Header code={props.code} presence={live ? props.presence : null} live={live} onLeave={props.leave} />
      {body(props)}
    </div>
  );
}

export function SharedConversationRoute({ code }: { code: string }) {
  return <SharedConversationView code={code} {...useSharedJoin(code)} />;
}
