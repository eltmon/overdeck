import { describe, expect, it } from 'vitest';
import type { HostFrame, ShareIdentity } from '@overdeck/contracts';
import {
  createRoom,
  HOST_RECONNECT_WINDOW_MS,
  MAX_LOBBY,
  MAX_PARTICIPANTS,
  reduce,
  toSnapshot,
  type RoomEffect,
  type RoomEvent,
  type RoomRecord,
} from '../../../../services/share/src/room-state.ts';

const T0 = 1_700_000_000_000;

function identity(githubId: number): ShareIdentity {
  return { githubId, login: `user${githubId}`, avatarUrl: `https://avatars.githubusercontent.com/u/${githubId}` };
}

const OWNER = identity(1);
const A = 100;
const B = 200;
const C = 300;
const offer = { sdp: { type: 'offer' as const, sdp: 'v=0' } };

function freshRoom(): RoomRecord {
  return createRoom(
    { shortCode: 'BCDFGHJK', scope: { kind: 'conversation', conversationId: 'conv-1' }, dataOwner: OWNER, hostTokenHash: 'h'.repeat(64) },
    T0,
  );
}

/** Applies events in order and returns the final room plus every effect emitted along the way. */
function run(room: RoomRecord, events: RoomEvent[], now = T0): { room: RoomRecord; effects: RoomEffect[] } {
  const effects: RoomEffect[] = [];
  for (const event of events) {
    const result = reduce(room, event, now);
    room = result.room;
    effects.push(...result.effects);
  }
  return { room, effects };
}

function step(room: RoomRecord, event: RoomEvent, now = T0) {
  return reduce(room, event, now);
}

const hostOn: RoomEvent = { kind: 'host-connected' };
const hostOff: RoomEvent = { kind: 'host-disconnected' };
const join = (githubId: number): RoomEvent => ({ kind: 'viewer-connected', identity: identity(githubId) });
const drop = (githubId: number): RoomEvent => ({ kind: 'viewer-disconnected', githubId });
const host = (frame: HostFrame): RoomEvent => ({ kind: 'host-frame', frame });

/** Host connected, A admitted (non-contributor), B in the lobby. */
function populated(): RoomRecord {
  return run(freshRoom(), [hostOn, join(A), host({ type: 'admit', githubId: A }), join(B)]).room;
}

function toViewer(effects: RoomEffect[], githubId: number) {
  return effects.filter((e) => e.kind === 'send-viewer' && e.githubId === githubId).map((e) => (e.kind === 'send-viewer' ? e.frame : null));
}
function toHost(effects: RoomEffect[]) {
  return effects.filter((e) => e.kind === 'send-host').map((e) => (e.kind === 'send-host' ? e.frame : null));
}
function snapshotEffect(room: RoomRecord): RoomEffect {
  return { kind: 'send-host', frame: { type: 'room', snapshot: toSnapshot(room) } };
}

describe('createRoom and toSnapshot', () => {
  it('creates an active room the data owner controls, with the host not yet connected', () => {
    const room = freshRoom();
    expect(room).toMatchObject({
      v: 1,
      status: 'active',
      controllerGithubId: OWNER.githubId,
      hostConnected: false,
      hostDisconnectedAt: T0,
      participants: {},
      blocked: {},
      createdAt: T0,
    });
  });

  it('the snapshot strips the token hash and join times and lists participants oldest first', () => {
    let room = run(freshRoom(), [hostOn], T0).room;
    room = step(room, join(C), T0 + 1).room;
    room = step(room, join(A), T0 + 2).room;
    const snap = toSnapshot(room);
    expect(JSON.stringify(snap)).not.toContain('h'.repeat(64));
    expect(snap.participants.map((p) => p.githubId)).toEqual([C, A]);
    expect(snap.participants[0]).toEqual({ ...identity(C), state: 'lobby', contributor: false, connected: true });
    expect(Object.keys(snap).sort()).toEqual(
      ['blocked', 'controllerGithubId', 'dataOwner', 'hostConnected', 'participants', 'scope', 'shortCode'].sort(),
    );
  });
});

describe('host-connected', () => {
  it('marks the host connected, cancels the alarm and sends a snapshot', () => {
    const { room, effects } = step(freshRoom(), hostOn);
    expect(room.hostConnected).toBe(true);
    expect(room.hostDisconnectedAt).toBeNull();
    expect(effects).toEqual([{ kind: 'cancel-alarm' }, snapshotEffect(room)]);
  });

  it('tells connected admitted viewers host-reconnected after a park, and tells lobby viewers nothing', () => {
    const parked = step(populated(), hostOff, T0 + 10).room;
    const { effects } = step(parked, hostOn, T0 + 20);
    expect(toViewer(effects, A)).toEqual([{ type: 'status', status: 'host-reconnected' }]);
    expect(toViewer(effects, B)).toEqual([]);
  });

  it('does not send host-reconnected when the host was already connected (a replaced host socket)', () => {
    const { effects } = step(populated(), hostOn);
    expect(toViewer(effects, A)).toEqual([]);
  });
});

describe('host-disconnected', () => {
  it('parks the host, arms the reconnect alarm and tells connected admitted viewers only', () => {
    const { room, effects } = step(populated(), hostOff, T0 + 5);
    expect(room.hostConnected).toBe(false);
    expect(room.hostDisconnectedAt).toBe(T0 + 5);
    expect(effects).toContainEqual({ kind: 'set-alarm', at: T0 + 5 + HOST_RECONNECT_WINDOW_MS });
    expect(toViewer(effects, A)).toEqual([{ type: 'status', status: 'host-disconnected' }]);
    expect(toViewer(effects, B)).toEqual([]);
    expect(toHost(effects)).toEqual([]);
  });

  it('is a no-op when the host is already disconnected', () => {
    const room = freshRoom();
    expect(step(room, hostOff, T0 + 99)).toEqual({ room, effects: [] });
  });
});

describe('alarm', () => {
  it('ends the room only once the full reconnect window has elapsed', () => {
    const t = T0 + 1_000;
    const parked = step(populated(), hostOff, t).room;

    const early = step(parked, { kind: 'alarm' }, t + 299_999);
    expect(early.effects).toEqual([]);
    expect(early.room).toBe(parked);

    const late = step(parked, { kind: 'alarm' }, t + 300_000);
    expect(late.room.status).toBe('ended');
    expect(late.effects).toEqual([
      { kind: 'close-all', code: 4004, reason: 'room-ended' },
      { kind: 'cancel-alarm' },
      { kind: 'delete-storage' },
    ]);
  });

  it('is stale while the host is connected', () => {
    const room = populated();
    expect(step(room, { kind: 'alarm' }, T0 + 10 * HOST_RECONNECT_WINDOW_MS)).toEqual({ room, effects: [] });
  });

  it('ends a room whose host never connected after the window from creation', () => {
    expect(step(freshRoom(), { kind: 'alarm' }, T0 + HOST_RECONNECT_WINDOW_MS).room.status).toBe('ended');
  });
});

describe('viewer-connected', () => {
  it('a new viewer lands in the lobby and receives exactly one frame, status lobby', () => {
    const before = run(freshRoom(), [hostOn]).room;
    const { room, effects } = step(before, join(A));
    expect(room.participants[String(A)]).toMatchObject({ state: 'lobby', contributor: false, connected: true });
    expect(toViewer(effects, A)).toEqual([{ type: 'status', status: 'lobby' }]);
    expect(effects).toEqual([{ kind: 'send-viewer', githubId: A, frame: { type: 'status', status: 'lobby' } }, snapshotEffect(room)]);
  });

  it('closes a blocked viewer with 4003 without telling the host or changing state', () => {
    const blocked = run(populated(), [host({ type: 'revoke', githubId: B })]).room;
    const result = step(blocked, join(B));
    expect(result.room).toBe(blocked);
    expect(result.effects).toEqual([{ kind: 'close-viewer', githubId: B, code: 4003, reason: 'blocked' }]);
  });

  it('closes the data owner joining as a viewer with 4009', () => {
    const room = populated();
    expect(step(room, join(OWNER.githubId))).toEqual({
      room,
      effects: [{ kind: 'close-viewer', githubId: OWNER.githubId, code: 4009, reason: 'is-host' }],
    });
  });

  it('auto-restores an admitted viewer who disconnects and reconnects, with no host action', () => {
    const contributorRoom = run(freshRoom(), [hostOn, join(A), host({ type: 'admit', githubId: A, contributor: true })]).room;
    const away = step(contributorRoom, drop(A)).room;
    expect(away.participants[String(A)]).toMatchObject({ state: 'admitted', connected: false });

    const { room, effects } = step(away, join(A));
    expect(room.participants[String(A)]).toMatchObject({ state: 'admitted', connected: true, contributor: true });
    expect(toViewer(effects, A)).toEqual([{ type: 'status', status: 'admitted', contributor: true }]);
  });

  it('a reconnecting admitted viewer also learns the host is away', () => {
    const away = run(populated(), [drop(A), hostOff]).room;
    const { effects } = step(away, join(A));
    expect(toViewer(effects, A)).toEqual([
      { type: 'status', status: 'admitted', contributor: false },
      { type: 'status', status: 'host-disconnected' },
    ]);
    expect(toHost(effects)).toEqual([]);
  });

  it('a reconnecting lobby viewer (replaced socket) gets status lobby again', () => {
    const { effects } = step(populated(), join(B));
    expect(toViewer(effects, B)).toEqual([{ type: 'status', status: 'lobby' }]);
  });

  it(`closes the ${MAX_LOBBY + 1}st lobby joiner with 4013 lobby-full`, () => {
    let room = run(freshRoom(), [hostOn]).room;
    for (let id = 1000; id < 1000 + MAX_LOBBY; id++) room = step(room, join(id)).room;
    const { room: after, effects } = step(room, join(5000));
    expect(after).toBe(room);
    expect(effects).toEqual([{ kind: 'close-viewer', githubId: 5000, code: 4013, reason: 'lobby-full' }]);
  });

  it(`closes a joiner with 4013 room-full once ${MAX_PARTICIPANTS} participants exist`, () => {
    let room = run(freshRoom(), [hostOn]).room;
    for (let id = 1000; id < 1000 + MAX_PARTICIPANTS; id++) {
      room = step(room, join(id)).room;
      room = step(room, host({ type: 'admit', githubId: id })).room;
    }
    expect(step(room, join(5000)).effects).toEqual([{ kind: 'close-viewer', githubId: 5000, code: 4013, reason: 'room-full' }]);
  });
});

describe('viewer-disconnected', () => {
  it('removes a lobby participant', () => {
    const { room, effects } = step(populated(), drop(B));
    expect(room.participants[String(B)]).toBeUndefined();
    expect(effects).toEqual([snapshotEffect(room)]);
  });

  it('keeps an admitted participant admitted but offline', () => {
    const { room } = step(populated(), drop(A));
    expect(room.participants[String(A)]).toMatchObject({ state: 'admitted', connected: false });
  });

  it('ignores an unknown githubId', () => {
    const room = populated();
    expect(step(room, drop(999))).toEqual({ room, effects: [] });
  });
});

describe('viewer-frame', () => {
  it('leave removes the participant from any state and closes with 1000', () => {
    for (const id of [A, B]) {
      const { room, effects } = step(populated(), { kind: 'viewer-frame', githubId: id, frame: { type: 'leave' } });
      expect(room.participants[String(id)]).toBeUndefined();
      expect(effects[0]).toEqual({ kind: 'close-viewer', githubId: id, code: 1000, reason: 'left' });
      expect(effects).toContainEqual(snapshotEffect(room));
    }
  });

  it('an admitted signal reaches the host while it is connected', () => {
    const { effects } = step(populated(), { kind: 'viewer-frame', githubId: A, frame: { type: 'signal', data: offer } });
    expect(effects).toEqual([{ kind: 'send-host', frame: { type: 'signal', githubId: A, data: offer } }]);
  });

  it('an admitted signal while the host is away is dropped silently', () => {
    const away = step(populated(), hostOff).room;
    expect(step(away, { kind: 'viewer-frame', githubId: A, frame: { type: 'signal', data: offer } }).effects).toEqual([]);
  });

  it('a lobby signal or ice-servers gets error not_admitted and nothing reaches the host', () => {
    for (const frame of [{ type: 'signal', data: offer } as const, { type: 'ice-servers' } as const]) {
      const { effects } = step(populated(), { kind: 'viewer-frame', githubId: B, frame });
      expect(effects).toEqual([{ kind: 'send-viewer', githubId: B, frame: { type: 'error', code: 'not_admitted' } }]);
    }
  });

  it('an admitted ice-servers request fetches ICE servers for that viewer', () => {
    const { effects } = step(populated(), { kind: 'viewer-frame', githubId: A, frame: { type: 'ice-servers' } });
    expect(effects).toEqual([{ kind: 'fetch-ice-servers', target: { githubId: A } }]);
  });
});

describe('host-frame', () => {
  it('admit moves a lobby viewer to admitted and sends status admitted with contributor', () => {
    const { room, effects } = step(populated(), host({ type: 'admit', githubId: B, contributor: true }));
    expect(room.participants[String(B)]).toMatchObject({ state: 'admitted', contributor: true });
    expect(toViewer(effects, B)).toEqual([{ type: 'status', status: 'admitted', contributor: true }]);
    expect(effects).toContainEqual(snapshotEffect(room));
  });

  it('admit without contributor admits a non-contributor; admitting a non-lobby id is unknown_participant', () => {
    expect(step(populated(), host({ type: 'admit', githubId: B })).room.participants[String(B)]?.contributor).toBe(false);
    for (const githubId of [A, 999]) {
      expect(step(populated(), host({ type: 'admit', githubId })).effects).toEqual([
        { kind: 'send-host', frame: { type: 'error', code: 'unknown_participant', githubId } },
      ]);
    }
  });

  it('kick removes and closes with 4010; the kicked viewer rejoins into the lobby', () => {
    const kicked = step(populated(), host({ type: 'kick', githubId: A }));
    expect(kicked.room.participants[String(A)]).toBeUndefined();
    expect(kicked.effects[0]).toEqual({ kind: 'close-viewer', githubId: A, code: 4010, reason: 'kicked' });

    const rejoin = step(kicked.room, join(A));
    expect(rejoin.room.participants[String(A)]?.state).toBe('lobby');
    expect(toViewer(rejoin.effects, A)).toEqual([{ type: 'status', status: 'lobby' }]);
  });

  it('revoke blocks (rejoin closes 4003) until unrevoke, after which a rejoin lands in the lobby', () => {
    const revoked = step(populated(), host({ type: 'revoke', githubId: A }));
    expect(revoked.effects[0]).toEqual({ kind: 'close-viewer', githubId: A, code: 4011, reason: 'revoked' });
    expect(revoked.room.blocked[String(A)]).toEqual(identity(A));
    expect(toSnapshot(revoked.room).blocked).toEqual([identity(A)]);

    expect(step(revoked.room, join(A)).effects).toEqual([{ kind: 'close-viewer', githubId: A, code: 4003, reason: 'blocked' }]);

    const unrevoked = step(revoked.room, host({ type: 'unrevoke', githubId: A }));
    expect(unrevoked.room.blocked[String(A)]).toBeUndefined();
    expect(unrevoked.effects).toEqual([snapshotEffect(unrevoked.room)]);
    expect(toViewer(step(unrevoked.room, join(A)).effects, A)).toEqual([{ type: 'status', status: 'lobby' }]);
  });

  it('revoke, kick and unrevoke of an unseen id are unknown_participant', () => {
    for (const frame of [
      { type: 'revoke', githubId: 999 },
      { type: 'kick', githubId: 999 },
      { type: 'unrevoke', githubId: A },
    ] as const) {
      expect(step(populated(), host(frame)).effects).toEqual([
        { kind: 'send-host', frame: { type: 'error', code: 'unknown_participant', githubId: frame.githubId } },
      ]);
    }
  });

  it('set-contributor updates an admitted viewer and resends status admitted; a lobby id is unknown_participant', () => {
    const { room, effects } = step(populated(), host({ type: 'set-contributor', githubId: A, contributor: true }));
    expect(room.participants[String(A)]?.contributor).toBe(true);
    expect(toViewer(effects, A)).toEqual([{ type: 'status', status: 'admitted', contributor: true }]);

    expect(step(populated(), host({ type: 'set-contributor', githubId: B, contributor: true })).effects).toEqual([
      { kind: 'send-host', frame: { type: 'error', code: 'unknown_participant', githubId: B } },
    ]);
  });

  it('set-controller accepts the data owner or an admitted viewer, rejects a lobby id', () => {
    const lobby = step(populated(), host({ type: 'set-controller', githubId: B }));
    expect(lobby.effects).toEqual([{ kind: 'send-host', frame: { type: 'error', code: 'unknown_participant', githubId: B } }]);

    const handed = step(populated(), host({ type: 'set-controller', githubId: A }));
    expect(handed.room.controllerGithubId).toBe(A);

    const reclaimed = step(handed.room, host({ type: 'set-controller', githubId: OWNER.githubId }));
    expect(reclaimed.room.controllerGithubId).toBe(OWNER.githubId);
    expect(reclaimed.effects).toEqual([snapshotEffect(reclaimed.room)]);
  });

  it('a kicked, revoked or departed controller hands control back to the data owner', () => {
    const handed = step(populated(), host({ type: 'set-controller', githubId: A })).room;
    const events: RoomEvent[] = [
      host({ type: 'kick', githubId: A }),
      host({ type: 'revoke', githubId: A }),
      { kind: 'viewer-frame', githubId: A, frame: { type: 'leave' } },
    ];
    for (const event of events) expect(step(handed, event).room.controllerGithubId).toBe(OWNER.githubId);
  });

  it('signal reaches a connected admitted viewer; a lobby target gets not_admitted to the host and nothing to the viewer', () => {
    expect(step(populated(), host({ type: 'signal', githubId: A, data: offer })).effects).toEqual([
      { kind: 'send-viewer', githubId: A, frame: { type: 'signal', data: offer } },
    ]);

    const lobby = step(populated(), host({ type: 'signal', githubId: B, data: offer }));
    expect(lobby.effects).toEqual([{ kind: 'send-host', frame: { type: 'error', code: 'not_admitted', githubId: B } }]);
    expect(toViewer(lobby.effects, B)).toEqual([]);

    expect(step(populated(), host({ type: 'signal', githubId: 999, data: offer })).effects).toEqual([
      { kind: 'send-host', frame: { type: 'error', code: 'unknown_participant', githubId: 999 } },
    ]);
  });

  it('ice-servers fetches for the host', () => {
    expect(step(populated(), host({ type: 'ice-servers' })).effects).toEqual([{ kind: 'fetch-ice-servers', target: 'host' }]);
  });
});

describe('end and delete', () => {
  it('both end the room with close-all 4004, cancel-alarm and delete-storage', () => {
    for (const event of [host({ type: 'end' }), { kind: 'delete' } as RoomEvent]) {
      const { room, effects } = step(populated(), event);
      expect(room.status).toBe('ended');
      expect(effects).toEqual([
        { kind: 'close-all', code: 4004, reason: 'room-ended' },
        { kind: 'cancel-alarm' },
        { kind: 'delete-storage' },
      ]);
    }
  });

  it('an ended room closes joiners with 4004 and ignores everything else', () => {
    const ended = step(populated(), { kind: 'delete' }).room;
    expect(step(ended, join(C)).effects).toEqual([{ kind: 'close-viewer', githubId: C, code: 4004, reason: 'room-ended' }]);
    const others: RoomEvent[] = [
      hostOn,
      hostOff,
      drop(A),
      { kind: 'alarm' },
      { kind: 'delete' },
      host({ type: 'end' }),
      host({ type: 'admit', githubId: B }),
      { kind: 'viewer-frame', githubId: A, frame: { type: 'signal', data: offer } },
    ];
    for (const event of others) expect(step(ended, event)).toEqual({ room: ended, effects: [] });
  });
});

describe('invite-only: the lobby zero-content property', () => {
  /** Every HostFrame variant that names the lobby viewer, except admit. */
  const nonAdmitFrames: HostFrame[] = [
    { type: 'kick', githubId: B },
    { type: 'revoke', githubId: B },
    { type: 'unrevoke', githubId: B },
    { type: 'set-contributor', githubId: B, contributor: true },
    { type: 'set-contributor', githubId: B, contributor: false },
    { type: 'set-controller', githubId: B },
    { type: 'signal', githubId: B, data: offer },
    { type: 'ice-servers' },
    { type: 'end' },
  ];
  const surrounding: RoomEvent[] = [
    join(C),
    host({ type: 'admit', githubId: C, contributor: true }),
    host({ type: 'signal', githubId: A, data: offer }),
    hostOff,
    hostOn,
    join(A),
    { kind: 'viewer-frame', githubId: B, frame: { type: 'signal', data: offer } },
    { kind: 'viewer-frame', githubId: B, frame: { type: 'ice-servers' } },
  ];

  it('a lobby viewer only ever receives status lobby, error not_admitted or a close', () => {
    const allowed = [
      { type: 'status', status: 'lobby' },
      { type: 'error', code: 'not_admitted' },
    ];
    for (const frame of nonAdmitFrames) {
      const { effects } = run(populated(), [...surrounding, host(frame), ...surrounding]);
      for (const sent of toViewer(effects, B)) expect(allowed).toContainEqual(sent);
      for (const e of effects) {
        if (e.kind === 'fetch-ice-servers') expect(e.target).not.toEqual({ githubId: B });
        if (e.kind === 'send-host' && e.frame.type === 'signal') expect(e.frame.githubId).not.toBe(B);
      }
    }
  });
});

describe('purity', () => {
  it('reduce never mutates its input record', () => {
    const events: RoomEvent[] = [
      hostOn,
      hostOff,
      join(C),
      join(B),
      drop(A),
      drop(B),
      { kind: 'alarm' },
      { kind: 'delete' },
      host({ type: 'admit', githubId: B, contributor: true }),
      host({ type: 'kick', githubId: A }),
      host({ type: 'revoke', githubId: A }),
      host({ type: 'set-contributor', githubId: A, contributor: true }),
      host({ type: 'set-controller', githubId: A }),
      host({ type: 'end' }),
      { kind: 'viewer-frame', githubId: A, frame: { type: 'leave' } },
    ];
    for (const event of events) {
      const room = populated();
      const before = structuredClone(room);
      reduce(room, event, T0 + HOST_RECONNECT_WINDOW_MS * 2);
      expect(room).toEqual(before);
    }
  });
});
