/**
 * The hosted viewer's screens (PRD PAN-4481 WI-8; FR-12, NFR-3, D-14, D-15).
 *
 * `screenFor` is pure: it maps the viewer model to one screen with its exact strings and controls,
 * so tests check the model without a DOM. `renderScreen` builds that screen with
 * `document.createElement` and `textContent` only; host data never reaches `innerHTML` (NFR-3).
 * The viewer is read-only in this slice: there is no composer (D-14). Avatars are built from the
 * numeric GitHub id; the `avatarUrl` the host sends is ignored (D-15).
 */
import type { PresencePayload, SharedMessage } from '@overdeck/contracts';
import type { ViewerNotice, ViewerPeerPhase } from '../../../src/dashboard/frontend/src/components/chat/sharing/webrtc-viewer.ts';
import type { BrowserJoinView } from './join-socket.ts';

export type SessionState =
  | 'checking'
  | 'unavailable'
  | { signedIn: false; reason?: 'grant_expired' }
  | { signedIn: true; githubId: number; login: string };

export interface ViewerModel {
  session: SessionState;
  /** null until the visitor starts a join on this page load. */
  join: BrowserJoinView | null;
  peerPhase: ViewerPeerPhase;
  hasHistory: boolean;
  messages: readonly SharedMessage[];
  presence: PresencePayload | null;
  notices: readonly ViewerNotice[];
  code: string;
}

export type ScreenKind =
  | 'checking'
  | 'unavailable'
  | 'signed-out'
  | 'grant-expired'
  | 'confirm'
  | 'connecting'
  | 'lobby'
  | 'waiting-offer'
  | 'conversation'
  | 'lost'
  | 'terminal';

export type ViewerAction = 'join' | 'leave' | 'reconnect' | 'rejoin' | 'sign-out';

export type Control =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'button'; label: string; action: Exclude<ViewerAction, 'sign-out'> }
  /** POST /auth/signout with the hidden field `code`. */
  | { kind: 'sign-out'; label: string; code: string };

export interface RosterEntry {
  githubId: number;
  login: string;
  avatarUrl: string;
  isHost: boolean;
}

export interface MessageLine {
  id: string;
  roleLabel: string;
  text: string;
  streaming: boolean;
}

export interface ConversationScreen {
  banner: string | null;
  roster: RosterEntry[];
  messages: MessageLine[];
  notices: string[];
}

export interface Screen {
  kind: ScreenKind;
  heading: string | null;
  avatarUrl: string | null;
  lines: string[];
  controls: Control[];
  conversation: ConversationScreen | null;
}

export function avatarUrlFor(githubId: number): string {
  return `https://avatars.githubusercontent.com/u/${githubId}?s=48`;
}

/** Copied from `noticeText` in the dashboard's SharedConversationView.tsx. */
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

const ROLE_LABELS: Record<SharedMessage['role'], string> = { user: 'User', assistant: 'Assistant', system: 'System' };

function screen(kind: ScreenKind, lines: string[], controls: Control[] = [], extra: Partial<Screen> = {}): Screen {
  return { kind, heading: null, avatarUrl: null, lines, controls, conversation: null, ...extra };
}

const signInLink = (code: string): Control => ({ kind: 'link', label: 'Sign in with GitHub', href: `/auth/signin?code=${encodeURIComponent(code)}` });
const signOut = (code: string): Control => ({ kind: 'sign-out', label: 'Sign out', code });
const button = (label: string, action: Exclude<ViewerAction, 'sign-out'>): Control => ({ kind: 'button', label, action });
const terminal = (text: string, controls: Control[] = []) => screen('terminal', [text], controls);

function conversationOf(model: ViewerModel): ConversationScreen {
  const roster = (model.presence?.participants ?? [])
    .filter((p) => p.isHost || p.state === 'admitted')
    .map((p) => ({ githubId: p.githubId, login: p.login, avatarUrl: avatarUrlFor(p.githubId), isHost: p.isHost }));
  return {
    banner: model.join?.state === 'host-disconnected' ? 'Host disconnected — reconnecting…' : null,
    roster,
    messages: model.messages.map((m) => ({ id: m.id, roleLabel: ROLE_LABELS[m.role], text: m.text, streaming: m.streaming === true })),
    notices: model.notices.map(noticeText),
  };
}

export function screenFor(model: ViewerModel): Screen {
  const { session, join, code } = model;
  if (session === 'checking') return screen('checking', ['Checking your sign-in…']);
  if (session === 'unavailable') return screen('unavailable', ['Joining in the browser is unavailable right now.']);
  if (!session.signedIn) {
    if (session.reason === 'grant_expired') {
      return screen('grant-expired', ['Your overdeck.ai access has expired. Ask the operator to renew it, then sign in again.'], [signOut(code)]);
    }
    return screen(
      'signed-out',
      [
        'No install needed. Sign in with GitHub so the host can see who is asking to join.',
        'overdeck.ai is invite-only: your GitHub account must be on the allowlist.',
      ],
      [signInLink(code)],
      { heading: 'Join in this browser' },
    );
  }

  if (join === null) {
    return screen(
      'confirm',
      [`Signed in as @${session.login}`, 'The host sees your GitHub name and avatar before letting you in.'],
      [button('Join', 'join'), signOut(code)],
      { avatarUrl: avatarUrlFor(session.githubId) },
    );
  }

  const leave = button('Leave', 'leave');
  switch (join.state) {
    case 'connecting':
      return screen('connecting', ['Connecting…']);
    case 'lobby':
      return screen('lobby', [`You are in the lobby as @${session.login}. Waiting for the host to let you in.`], [leave]);
    case 'admitted':
    case 'host-disconnected':
      if (join.state === 'admitted' && model.peerPhase === 'lost') return screen('lost', ['Connection to the host was lost.'], [button('Reconnect', 'reconnect')]);
      if (!model.hasHistory) return screen('waiting-offer', ['Connecting to the host…'], [leave]);
      return screen('conversation', [], [leave], { conversation: conversationOf(model) });
    case 'kicked':
      return terminal('Removed by host.', [button('Rejoin', 'rejoin')]);
    case 'revoked':
      return terminal("You can't join this share.");
    case 'ended':
      return terminal('This share has ended.');
    case 'is-host':
      return terminal('You started this share. Open it in your own Overdeck dashboard.');
    case 'full':
      return terminal('This share is full.', [button('Rejoin', 'rejoin')]);
    case 'replaced':
      return terminal('This share is open in another tab or on another device.', [button('Rejoin here', 'rejoin')]);
    case 'rejected':
      return terminal('Your sign-in was refused. Sign in again.', [signInLink(code)]);
    case 'left':
      return terminal('You left the shared conversation.', [button('Rejoin', 'rejoin')]);
    case 'disconnected':
      if (join.error === 'unreachable') return terminal('Could not reach the share. It may have ended; reload the page to check.', [button('Rejoin', 'rejoin')]);
      return terminal('Connection lost.', [button('Rejoin', 'rejoin')]);
  }
}

// ---- DOM -----------------------------------------------------------------------------------------

export interface RenderActions {
  onAction(action: ViewerAction): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function avatar(url: string): HTMLImageElement {
  const img = el('img', 'avatar');
  img.src = url;
  img.alt = '';
  img.width = 24;
  img.height = 24;
  return img;
}

function controlNode(control: Control, actions: RenderActions): HTMLElement {
  if (control.kind === 'link') {
    const a = el('a', 'button', control.label);
    a.href = control.href;
    return a;
  }
  if (control.kind === 'sign-out') {
    const form = el('form', 'inline');
    form.method = 'post';
    form.action = '/auth/signout';
    const hidden = el('input');
    hidden.type = 'hidden';
    hidden.name = 'code';
    hidden.value = control.code;
    const submit = el('button', 'button secondary', control.label);
    submit.type = 'submit';
    form.append(hidden, submit);
    form.addEventListener('submit', () => actions.onAction('sign-out'));
    return form;
  }
  const btn = el('button', 'button', control.label);
  btn.type = 'button';
  const { action } = control;
  btn.addEventListener('click', () => actions.onAction(action));
  return btn;
}

function conversationNode(conversation: ConversationScreen): HTMLElement {
  const wrap = el('div', 'conversation');
  if (conversation.banner) {
    const banner = el('p', 'banner', conversation.banner);
    banner.setAttribute('role', 'status');
    wrap.append(banner);
  }
  if (conversation.roster.length > 0) {
    const roster = el('ul', 'roster');
    for (const entry of conversation.roster) {
      const li = el('li');
      li.append(avatar(entry.avatarUrl), el('span', 'login', `@${entry.login}`));
      if (entry.isHost) li.append(el('span', 'tag', 'host'));
      roster.append(li);
    }
    wrap.append(roster);
  }
  for (const notice of conversation.notices) wrap.append(el('p', 'notice', notice));
  const list = el('ol', 'messages');
  for (const message of conversation.messages) {
    const li = el('li', 'message');
    const text = el('div', 'text', message.streaming ? `${message.text}…` : message.text);
    text.style.whiteSpace = 'pre-wrap';
    li.append(el('div', 'role', message.roleLabel), text);
    list.append(li);
  }
  wrap.append(list);
  return wrap;
}

export function renderScreen(root: HTMLElement, s: Screen, actions: RenderActions): void {
  const children: HTMLElement[] = [];
  if (s.heading) children.push(el('h2', undefined, s.heading));
  if (s.avatarUrl) children.push(avatar(s.avatarUrl));
  for (const line of s.lines) children.push(el('p', undefined, line));
  if (s.conversation) children.push(conversationNode(s.conversation));
  if (s.controls.length > 0) {
    const bar = el('div', 'controls');
    for (const control of s.controls) bar.append(controlNode(control, actions));
    children.push(bar);
  }
  root.replaceChildren(...children);
  root.dataset.screen = s.kind;
}
