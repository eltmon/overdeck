/**
 * The room reducer (PRD PAN-658 "Room rules"): every room decision lives here as a pure function.
 *
 * `reduce` never mutates its input. When an event changes nothing it returns the SAME record object,
 * so the Durable Object glue persists only when `result.room !== room`. Time arrives as `now`;
 * nothing below the Durable Object calls `Date.now()`.
 *
 * Invite-only guarantee (FR-3): until a host `admit` names a viewer, every effect addressed to that
 * viewer is `status lobby`, `error not_admitted` or a close. A lobby viewer never receives a snapshot,
 * another participant's identity, a `signal` or ICE servers, and nothing it sends reaches the host.
 */
import type {
  HostFrame,
  RoomSnapshot,
  ServiceToHostFrame,
  ServiceToViewerFrame,
  ShareCloseCode,
  ShareErrorCode,
  ShareIdentity,
  ShareScope,
  ViewerFrame,
} from '../../../packages/contracts/src/sharing.ts';

export const HOST_RECONNECT_WINDOW_MS = 300_000;
export const MAX_PARTICIPANTS = 50; // lobby + admitted
export const MAX_LOBBY = 20;

export interface ParticipantRecord {
  identity: ShareIdentity;
  state: 'lobby' | 'admitted';
  contributor: boolean;
  connected: boolean;
  joinedAt: number;
}

export interface RoomRecord {
  v: 1;
  shortCode: string;
  scope: ShareScope;
  hostTokenHash: string;
  dataOwner: ShareIdentity;
  controllerGithubId: number;
  status: 'active' | 'ended';
  hostConnected: boolean;
  hostDisconnectedAt: number | null;
  /** key = String(githubId) */
  participants: Record<string, ParticipantRecord>;
  /** key = String(githubId) */
  blocked: Record<string, ShareIdentity>;
  createdAt: number;
}

export type RoomEvent =
  | { kind: 'host-connected' }
  | { kind: 'host-disconnected' }
  | { kind: 'viewer-connected'; identity: ShareIdentity }
  | { kind: 'viewer-disconnected'; githubId: number }
  | { kind: 'viewer-frame'; githubId: number; frame: ViewerFrame }
  | { kind: 'host-frame'; frame: HostFrame }
  | { kind: 'alarm' }
  | { kind: 'delete' };

export type RoomEffect =
  | { kind: 'send-host'; frame: ServiceToHostFrame }
  | { kind: 'send-viewer'; githubId: number; frame: ServiceToViewerFrame }
  | { kind: 'close-viewer'; githubId: number; code: ShareCloseCode; reason: string }
  | { kind: 'close-all'; code: ShareCloseCode; reason: string }
  | { kind: 'set-alarm'; at: number }
  | { kind: 'cancel-alarm' }
  | { kind: 'fetch-ice-servers'; target: 'host' | { githubId: number } }
  | { kind: 'delete-storage' };

export interface ReduceResult {
  room: RoomRecord;
  effects: RoomEffect[];
}

export interface CreateRoomInput {
  shortCode: string;
  scope: ShareScope;
  dataOwner: ShareIdentity;
  hostTokenHash: string;
}

/**
 * A new room: the data owner controls it and the host has not connected yet. `hostDisconnectedAt = now`
 * so the reconnect alarm the Durable Object arms at creation ends a room whose host never parks.
 */
export function createRoom(input: CreateRoomInput, now: number): RoomRecord {
  return {
    v: 1,
    shortCode: input.shortCode,
    scope: input.scope,
    hostTokenHash: input.hostTokenHash,
    dataOwner: input.dataOwner,
    controllerGithubId: input.dataOwner.githubId,
    status: 'active',
    hostConnected: false,
    hostDisconnectedAt: now,
    participants: {},
    blocked: {},
    createdAt: now,
  };
}

/** The host-facing view of the room: strips the token hash, join times and lifecycle bookkeeping. */
export function toSnapshot(room: RoomRecord): RoomSnapshot {
  const participants = Object.values(room.participants)
    .slice()
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((p) => ({ ...p.identity, state: p.state, contributor: p.contributor, connected: p.connected }));
  return {
    shortCode: room.shortCode,
    scope: room.scope,
    dataOwner: room.dataOwner,
    controllerGithubId: room.controllerGithubId,
    hostConnected: room.hostConnected,
    participants,
    blocked: Object.values(room.blocked),
  };
}

const unchanged = (room: RoomRecord, effects: RoomEffect[] = []): ReduceResult => ({ room, effects });

/** A deep copy the caller may mutate; the input record is never touched. */
function draft(room: RoomRecord): RoomRecord {
  return structuredClone(room);
}

/** `send-host room` for a changed record, only while the host is connected. */
function snapshot(next: RoomRecord): RoomEffect[] {
  return next.hostConnected ? [{ kind: 'send-host', frame: { type: 'room', snapshot: toSnapshot(next) } }] : [];
}

function changed(next: RoomRecord, effects: RoomEffect[]): ReduceResult {
  return { room: next, effects: [...effects, ...snapshot(next)] };
}

function hostError(code: ShareErrorCode, githubId?: number): RoomEffect {
  return { kind: 'send-host', frame: githubId === undefined ? { type: 'error', code } : { type: 'error', code, githubId } };
}

function toViewer(githubId: number, frame: ServiceToViewerFrame): RoomEffect {
  return { kind: 'send-viewer', githubId, frame };
}

function admittedStatus(p: ParticipantRecord): ServiceToViewerFrame {
  return { type: 'status', status: 'admitted', contributor: p.contributor };
}

/** Admitted viewers with a live socket: the only ones told about host presence changes. */
function connectedAdmitted(room: RoomRecord): ParticipantRecord[] {
  return Object.values(room.participants).filter((p) => p.state === 'admitted' && p.connected);
}

/** Removes a participant; a removed controller hands control back to the data owner. */
function removeParticipant(next: RoomRecord, githubId: number): void {
  delete next.participants[String(githubId)];
  if (next.controllerGithubId === githubId) next.controllerGithubId = next.dataOwner.githubId;
}

function endRoom(room: RoomRecord): ReduceResult {
  const next = draft(room);
  next.status = 'ended';
  return {
    room: next,
    effects: [{ kind: 'close-all', code: 4004, reason: 'room-ended' }, { kind: 'cancel-alarm' }, { kind: 'delete-storage' }],
  };
}

function onHostConnected(room: RoomRecord): ReduceResult {
  const wasParked = !room.hostConnected;
  const next = draft(room);
  next.hostConnected = true;
  next.hostDisconnectedAt = null;
  const effects: RoomEffect[] = [{ kind: 'cancel-alarm' }, ...snapshot(next)];
  if (wasParked) {
    for (const p of connectedAdmitted(next)) {
      effects.push(toViewer(p.identity.githubId, { type: 'status', status: 'host-reconnected' }));
    }
  }
  return { room: next, effects };
}

function onHostDisconnected(room: RoomRecord, now: number): ReduceResult {
  if (!room.hostConnected) return unchanged(room);
  const next = draft(room);
  next.hostConnected = false;
  next.hostDisconnectedAt = now;
  const effects: RoomEffect[] = [{ kind: 'set-alarm', at: now + HOST_RECONNECT_WINDOW_MS }];
  for (const p of connectedAdmitted(next)) {
    effects.push(toViewer(p.identity.githubId, { type: 'status', status: 'host-disconnected' }));
  }
  return { room: next, effects };
}

function onAlarm(room: RoomRecord, now: number): ReduceResult {
  if (room.hostConnected || room.hostDisconnectedAt === null) return unchanged(room);
  if (now - room.hostDisconnectedAt < HOST_RECONNECT_WINDOW_MS) return unchanged(room);
  return endRoom(room);
}

function onViewerConnected(room: RoomRecord, identity: ShareIdentity, now: number): ReduceResult {
  const githubId = identity.githubId;
  const key = String(githubId);
  if (room.blocked[key]) return unchanged(room, [{ kind: 'close-viewer', githubId, code: 4003, reason: 'blocked' }]);
  if (githubId === room.dataOwner.githubId) {
    return unchanged(room, [{ kind: 'close-viewer', githubId, code: 4009, reason: 'is-host' }]);
  }

  const existing = room.participants[key];
  if (existing) {
    const next = draft(room);
    const p = next.participants[key] as ParticipantRecord;
    p.connected = true;
    const effects: RoomEffect[] = [];
    if (p.state === 'admitted') {
      effects.push(toViewer(githubId, admittedStatus(p)));
      if (!next.hostConnected) effects.push(toViewer(githubId, { type: 'status', status: 'host-disconnected' }));
    } else {
      effects.push(toViewer(githubId, { type: 'status', status: 'lobby' }));
    }
    return changed(next, effects);
  }

  const all = Object.values(room.participants);
  if (all.length >= MAX_PARTICIPANTS) {
    return unchanged(room, [{ kind: 'close-viewer', githubId, code: 4013, reason: 'room-full' }]);
  }
  if (all.filter((p) => p.state === 'lobby').length >= MAX_LOBBY) {
    return unchanged(room, [{ kind: 'close-viewer', githubId, code: 4013, reason: 'lobby-full' }]);
  }

  const next = draft(room);
  next.participants[key] = { identity, state: 'lobby', contributor: false, connected: true, joinedAt: now };
  return changed(next, [toViewer(githubId, { type: 'status', status: 'lobby' })]);
}

function onViewerDisconnected(room: RoomRecord, githubId: number): ReduceResult {
  const key = String(githubId);
  const p = room.participants[key];
  if (!p) return unchanged(room);
  const next = draft(room);
  if (p.state === 'lobby') {
    removeParticipant(next, githubId);
  } else {
    (next.participants[key] as ParticipantRecord).connected = false;
  }
  return changed(next, []);
}

function onViewerFrame(room: RoomRecord, githubId: number, frame: ViewerFrame): ReduceResult {
  const p = room.participants[String(githubId)];

  if (frame.type === 'leave') {
    const close: RoomEffect = { kind: 'close-viewer', githubId, code: 1000, reason: 'left' };
    if (!p) return unchanged(room, [close]);
    const next = draft(room);
    removeParticipant(next, githubId);
    return changed(next, [close]);
  }

  if (!p) return unchanged(room);
  if (p.state === 'lobby') return unchanged(room, [toViewer(githubId, { type: 'error', code: 'not_admitted' })]);

  if (frame.type === 'signal') {
    // An admitted viewer's signal while the host is away is dropped: the viewer already has `host-disconnected`.
    if (!room.hostConnected) return unchanged(room);
    return unchanged(room, [{ kind: 'send-host', frame: { type: 'signal', githubId, data: frame.data } }]);
  }
  return unchanged(room, [{ kind: 'fetch-ice-servers', target: { githubId } }]);
}

function onHostFrame(room: RoomRecord, frame: HostFrame): ReduceResult {
  if (frame.type === 'ice-servers') return unchanged(room, [{ kind: 'fetch-ice-servers', target: 'host' }]);
  if (frame.type === 'end') return endRoom(room);

  const githubId = frame.githubId;
  const key = String(githubId);
  const p = room.participants[key];
  const unknown = (): ReduceResult => unchanged(room, [hostError('unknown_participant', githubId)]);

  switch (frame.type) {
    case 'admit': {
      if (!p || p.state !== 'lobby') return unknown();
      const next = draft(room);
      const np = next.participants[key] as ParticipantRecord;
      np.state = 'admitted';
      np.contributor = frame.contributor === true;
      return changed(next, [toViewer(githubId, admittedStatus(np))]);
    }
    case 'kick': {
      if (!p) return unknown();
      const next = draft(room);
      removeParticipant(next, githubId);
      return changed(next, [{ kind: 'close-viewer', githubId, code: 4010, reason: 'kicked' }]);
    }
    case 'revoke': {
      if (!p) return unknown();
      const next = draft(room);
      removeParticipant(next, githubId);
      next.blocked[key] = p.identity;
      return changed(next, [{ kind: 'close-viewer', githubId, code: 4011, reason: 'revoked' }]);
    }
    case 'unrevoke': {
      if (!room.blocked[key]) return unknown();
      const next = draft(room);
      delete next.blocked[key];
      return changed(next, []);
    }
    case 'set-contributor': {
      if (!p || p.state !== 'admitted') return unknown();
      const next = draft(room);
      const np = next.participants[key] as ParticipantRecord;
      np.contributor = frame.contributor;
      return changed(next, [toViewer(githubId, admittedStatus(np))]);
    }
    case 'set-controller': {
      // Reclaim (the data owner's own id) is always accepted.
      if (githubId !== room.dataOwner.githubId && (!p || p.state !== 'admitted')) return unknown();
      const next = draft(room);
      next.controllerGithubId = githubId;
      return changed(next, []);
    }
    case 'signal': {
      if (!p) return unknown();
      if (p.state === 'lobby') return unchanged(room, [hostError('not_admitted', githubId)]);
      // An admitted viewer without a live socket cannot receive it; the host learns that from the snapshot.
      if (!p.connected) return unchanged(room);
      return unchanged(room, [toViewer(githubId, { type: 'signal', data: frame.data })]);
    }
  }
}

export function reduce(room: RoomRecord, event: RoomEvent, now: number): ReduceResult {
  if (room.status === 'ended') {
    if (event.kind === 'viewer-connected') {
      return unchanged(room, [{ kind: 'close-viewer', githubId: event.identity.githubId, code: 4004, reason: 'room-ended' }]);
    }
    return unchanged(room);
  }
  switch (event.kind) {
    case 'host-connected':
      return onHostConnected(room);
    case 'host-disconnected':
      return onHostDisconnected(room, now);
    case 'alarm':
      return onAlarm(room, now);
    case 'delete':
      return endRoom(room);
    case 'viewer-connected':
      return onViewerConnected(room, event.identity, now);
    case 'viewer-disconnected':
      return onViewerDisconnected(room, event.githubId);
    case 'viewer-frame':
      return onViewerFrame(room, event.githubId, event.frame);
    case 'host-frame':
      return onHostFrame(room, event.frame);
  }
}
