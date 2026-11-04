import { describe, expect, it } from 'vitest';
import type { PresencePayload, SharedMessage } from '@overdeck/contracts';
import type { BrowserJoinView } from '../../../../../services/share/web/join-socket.ts';
import { screenFor, type Screen, type ViewerModel } from '../../../../../services/share/web/view.ts';

const CODE = 'BCDFGHJK';
const SIGNED_IN = { signedIn: true as const, githubId: 100, login: 'alice' };
const MESSAGES: SharedMessage[] = [
  { id: 'm1', role: 'user', text: 'hello', createdAt: '2026-11-03T00:00:00Z' },
  { id: 'm2', role: 'assistant', text: 'hi there', createdAt: '2026-11-03T00:00:01Z', streaming: true },
  { id: 'm3', role: 'system', text: 'note', createdAt: '2026-11-03T00:00:02Z' },
];
const PRESENCE: PresencePayload = {
  controllerGithubId: 1,
  participants: [
    { githubId: 1, login: 'owner', avatarUrl: 'https://evil.test/owner.png', state: 'admitted', contributor: true, isHost: true },
    { githubId: 100, login: 'alice', avatarUrl: 'https://evil.test/a.png', state: 'admitted', contributor: false, isHost: false },
    { githubId: 200, login: 'bob', avatarUrl: 'https://evil.test/b.png', state: 'lobby', contributor: false, isHost: false },
  ],
  streams: [{ streamId: 's1', label: 'Conversation', kind: 'conversation' }],
};

function joinView(state: BrowserJoinView['state'], patch: Partial<BrowserJoinView> = {}): BrowserJoinView {
  return { state, contributor: false, closeCode: null, error: null, ...patch };
}

function model(patch: Partial<ViewerModel> = {}): ViewerModel {
  return { session: SIGNED_IN, join: null, peerPhase: 'waiting', hasHistory: false, messages: [], presence: null, notices: [], code: CODE, ...patch };
}

/** The labels of a screen's controls, with the link target for links. */
function controls(s: Screen): string[] {
  return s.controls.map((c) => (c.kind === 'link' ? `${c.label} -> ${c.href}` : c.label));
}

describe('screenFor (PAN-4481 web-viewer-ui)', () => {
  it('session checking and unavailable', () => {
    expect(screenFor(model({ session: 'checking' }))).toMatchObject({ kind: 'checking', lines: ['Checking your sign-in…'], controls: [] });
    expect(screenFor(model({ session: 'unavailable' }))).toMatchObject({ kind: 'unavailable', lines: ['Joining in the browser is unavailable right now.'], controls: [] });
  });

  it('signed out offers the GitHub sign-in link for this code', () => {
    const s = screenFor(model({ session: { signedIn: false } }));
    expect(s.kind).toBe('signed-out');
    expect(s.heading).toBe('Join in this browser');
    expect(s.lines).toEqual([
      'No install needed. Sign in with GitHub so the host can see who is asking to join.',
      'overdeck.ai is invite-only: your GitHub account must be on the allowlist.',
    ]);
    expect(controls(s)).toEqual([`Sign in with GitHub -> /auth/signin?code=${CODE}`]);
  });

  it('an expired grant explains it and offers Sign out', () => {
    const s = screenFor(model({ session: { signedIn: false, reason: 'grant_expired' } }));
    expect(s).toMatchObject({ kind: 'grant-expired', lines: ['Your overdeck.ai access has expired. Ask the operator to renew it, then sign in again.'] });
    expect(s.controls).toEqual([{ kind: 'sign-out', label: 'Sign out', code: CODE }]);
  });

  it('signed in with no join started confirms the identity before Join', () => {
    const s = screenFor(model());
    expect(s.kind).toBe('confirm');
    expect(s.avatarUrl).toBe('https://avatars.githubusercontent.com/u/100?s=48');
    expect(s.lines).toEqual(['Signed in as @alice', 'The host sees your GitHub name and avatar before letting you in.']);
    expect(controls(s)).toEqual(['Join', 'Sign out']);
  });

  it('connecting, lobby and waiting for the offer', () => {
    expect(screenFor(model({ join: joinView('connecting') }))).toMatchObject({ kind: 'connecting', lines: ['Connecting…'] });
    const lobby = screenFor(model({ join: joinView('lobby') }));
    expect(lobby).toMatchObject({ kind: 'lobby', lines: ['You are in the lobby as @alice. Waiting for the host to let you in.'] });
    expect(controls(lobby)).toEqual(['Leave']);
    const waiting = screenFor(model({ join: joinView('admitted'), peerPhase: 'connecting' }));
    expect(waiting).toMatchObject({ kind: 'waiting-offer', lines: ['Connecting to the host…'] });
    expect(controls(waiting)).toEqual(['Leave']);
  });

  it('a lobby model never yields the conversation, even with messages present', () => {
    const s = screenFor(model({ join: joinView('lobby'), hasHistory: true, messages: MESSAGES, presence: PRESENCE, peerPhase: 'connected' }));
    expect(s.kind).toBe('lobby');
    expect(s.conversation).toBeNull();
    expect(JSON.stringify(s)).not.toContain('hello');
  });

  it('the conversation shows the roster, role labels, streaming marker and notices', () => {
    const s = screenFor(
      model({ join: joinView('admitted'), hasHistory: true, messages: MESSAGES, presence: PRESENCE, peerPhase: 'connected', notices: [{ kind: 'updates_missed' }, { kind: 'hello_failed', code: 'bad' }] }),
    );
    expect(s.kind).toBe('conversation');
    expect(controls(s)).toEqual(['Leave']);
    expect(s.conversation).toEqual({
      banner: null,
      roster: [
        { githubId: 1, login: 'owner', avatarUrl: 'https://avatars.githubusercontent.com/u/1?s=48', isHost: true },
        { githubId: 100, login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/u/100?s=48', isHost: false },
      ],
      messages: [
        { id: 'm1', roleLabel: 'User', text: 'hello', streaming: false },
        { id: 'm2', roleLabel: 'Assistant', text: 'hi there', streaming: true },
        { id: 'm3', roleLabel: 'System', text: 'note', streaming: false },
      ],
      notices: ['Some updates were missed. Reconnect to resync.', 'Could not start the shared session (bad).'],
    });
    expect(JSON.stringify(s)).not.toContain('evil.test');
  });

  it('host-disconnected with history keeps the conversation under a banner', () => {
    const s = screenFor(model({ join: joinView('host-disconnected'), hasHistory: true, messages: MESSAGES, peerPhase: 'lost' }));
    expect(s.kind).toBe('conversation');
    expect(s.conversation?.banner).toBe('Host disconnected — reconnecting…');
  });

  it('a lost peer while admitted offers Reconnect', () => {
    const s = screenFor(model({ join: joinView('admitted'), hasHistory: true, messages: MESSAGES, peerPhase: 'lost' }));
    expect(s).toMatchObject({ kind: 'lost', lines: ['Connection to the host was lost.'] });
    expect(controls(s)).toEqual(['Reconnect']);
  });

  it('every terminal state has its text and controls', () => {
    const cases: Array<[BrowserJoinView, string, string[]]> = [
      [joinView('kicked'), 'Removed by host.', ['Rejoin']],
      [joinView('revoked'), "You can't join this share.", []],
      [joinView('ended'), 'This share has ended.', []],
      [joinView('is-host'), 'You started this share. Open it in your own Overdeck dashboard.', []],
      [joinView('full'), 'This share is full.', ['Rejoin']],
      [joinView('replaced'), 'This share is open in another tab or on another device.', ['Rejoin here']],
      [joinView('rejected'), 'Your sign-in was refused. Sign in again.', [`Sign in with GitHub -> /auth/signin?code=${CODE}`]],
      [joinView('left'), 'You left the shared conversation.', ['Rejoin']],
      [joinView('disconnected', { error: 'connection_lost' }), 'Connection lost.', ['Rejoin']],
      [joinView('disconnected', { error: 'unreachable' }), 'Could not reach the share. It may have ended; reload the page to check.', ['Rejoin']],
    ];
    for (const [view, text, expected] of cases) {
      const s = screenFor(model({ join: view }));
      expect(s.kind, view.state).toBe('terminal');
      expect(s.lines, view.state).toEqual([text]);
      expect(controls(s), view.state).toEqual(expected);
    }
  });

  it('a signed-out session wins over a join in progress (D-13 re-read)', () => {
    expect(screenFor(model({ session: { signedIn: false }, join: joinView('disconnected', { error: 'unreachable' }) })).kind).toBe('signed-out');
  });

  it('host text that looks like HTML stays verbatim text in the screen model', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const s = screenFor(
      model({ join: joinView('admitted'), hasHistory: true, peerPhase: 'connected', messages: [{ id: 'x', role: 'assistant', text: evil, createdAt: '2026-11-03T00:00:00Z' }] }),
    );
    expect(s.conversation?.messages[0]?.text).toBe(evil);
  });
});
