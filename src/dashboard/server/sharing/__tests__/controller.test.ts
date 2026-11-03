import { describe, expect, it } from 'vitest';
import type { RoomParticipant, RoomSnapshot, ShareCommand } from '@overdeck/contracts';

import { ControllerState, controlRefusal, readControllerCommand, type ControlActor } from '../controller.js';

const OWNER = 1;
const B = 100;
const C = 200;

function participant(githubId: number, state: 'lobby' | 'admitted'): RoomParticipant {
  return { githubId, login: `user${githubId}`, avatarUrl: `https://a/${githubId}`, state, contributor: false, connected: true };
}

function snapshot(controllerGithubId: number, ...participants: RoomParticipant[]): RoomSnapshot {
  return {
    shortCode: 'ABC123',
    scope: { kind: 'conversation', conversationId: 'conv-1' },
    dataOwner: { githubId: OWNER, login: 'owner', avatarUrl: 'https://a/1' },
    controllerGithubId,
    hostConnected: true,
    participants,
    blocked: [],
  };
}

const owner: ControlActor = { kind: 'owner' };
const viewer = (githubId: number): ControlActor => ({ kind: 'viewer', githubId });

function refusal(
  snap: RoomSnapshot,
  controllerGithubId: number,
  actor: ControlActor,
  command: ShareCommand,
  hostAdmitted: readonly number[] = [B, C],
) {
  return controlRefusal({ snapshot: snap, controllerGithubId, actor, command, isHostAdmitted: (id) => hostAdmitted.includes(id) });
}

describe('ControllerState', () => {
  it('is null before the first snapshot', () => {
    expect(new ControllerState().current(null)).toBeNull();
  });

  it('is the data owner with no appointment, even when the snapshot names a viewer (NFR-1)', () => {
    const state = new ControllerState();
    expect(state.current(snapshot(B, participant(B, 'admitted')))).toBe(OWNER);
  });

  it('is the appointed viewer only once the snapshot confirms it', () => {
    const state = new ControllerState();
    state.appoint(B, OWNER);
    expect(state.current(snapshot(OWNER, participant(B, 'admitted')))).toBe(OWNER);
    expect(state.current(snapshot(B, participant(B, 'admitted')))).toBe(B);
    expect(state.current(snapshot(C, participant(B, 'admitted'), participant(C, 'admitted')))).toBe(OWNER);
  });

  it('appointing the data owner clears the appointment (reclaim)', () => {
    const state = new ControllerState();
    state.appoint(B, OWNER);
    state.appoint(OWNER, OWNER);
    expect(state.current(snapshot(B, participant(B, 'admitted')))).toBe(OWNER);
  });

  it('a snapshot that no longer lists the appointed viewer as admitted clears the appointment (FR-2)', () => {
    const state = new ControllerState();
    state.appoint(B, OWNER);
    state.onSnapshot(snapshot(B, participant(B, 'lobby')));
    expect(state.current(snapshot(B, participant(B, 'admitted')))).toBe(OWNER);
  });

  it('keeps the appointment while the viewer stays admitted', () => {
    const state = new ControllerState();
    state.appoint(B, OWNER);
    state.onSnapshot(snapshot(B, participant(B, 'admitted')));
    expect(state.current(snapshot(B, participant(B, 'admitted')))).toBe(B);
  });
});

describe('controlRefusal', () => {
  const room = snapshot(B, participant(B, 'admitted'), participant(C, 'lobby'));

  it('always accepts reclaim from the data owner, even while a viewer controls', () => {
    expect(refusal(room, B, owner, { type: 'set-controller', githubId: OWNER })).toBeNull();
  });

  it('refuses the data owner with not_controller while a viewer controls', () => {
    expect(refusal(room, B, owner, { type: 'kick', githubId: C })).toBe('not_controller');
    expect(refusal(room, B, owner, { type: 'set-controller', githubId: B })).toBe('not_controller');
  });

  it('refuses a viewer who is not the controller with not_controller', () => {
    expect(refusal(room, OWNER, viewer(B), { type: 'admit', githubId: C })).toBe('not_controller');
  });

  it('refuses unrevoke from a viewer-controller with invalid_command', () => {
    expect(refusal(room, B, viewer(B), { type: 'unrevoke', githubId: C })).toBe('invalid_command');
  });

  it('refuses a viewer-controller targeting itself with invalid_target', () => {
    expect(refusal(room, B, viewer(B), { type: 'kick', githubId: B })).toBe('invalid_target');
    expect(refusal(room, B, viewer(B), { type: 'set-controller', githubId: B })).toBe('invalid_target');
  });

  it('accepts set-controller to the data owner or an admitted, host-admitted participant', () => {
    const two = snapshot(OWNER, participant(B, 'admitted'), participant(C, 'admitted'));
    expect(refusal(two, OWNER, owner, { type: 'set-controller', githubId: B })).toBeNull();
    expect(refusal(snapshot(B, participant(B, 'admitted'), participant(C, 'admitted')), B, viewer(B), { type: 'set-controller', githubId: OWNER })).toBeNull();
    expect(refusal(snapshot(B, participant(B, 'admitted'), participant(C, 'admitted')), B, viewer(B), { type: 'set-controller', githubId: C })).toBeNull();
  });

  it('refuses set-controller to a lobby participant, an unlisted id or one the host never admitted', () => {
    expect(refusal(room, B, viewer(B), { type: 'set-controller', githubId: C })).toBe('unknown_participant');
    expect(refusal(room, B, viewer(B), { type: 'set-controller', githubId: 999 })).toBe('unknown_participant');
    const two = snapshot(OWNER, participant(B, 'admitted'), participant(C, 'admitted'));
    expect(refusal(two, OWNER, owner, { type: 'set-controller', githubId: C }, [B])).toBe('unknown_participant');
  });

  it('leaves the data owner\'s other targets to the share service (D-5)', () => {
    const empty = snapshot(OWNER);
    expect(refusal(empty, OWNER, owner, { type: 'admit', githubId: 5 })).toBeNull();
    expect(refusal(empty, OWNER, owner, { type: 'unrevoke', githubId: 5 })).toBeNull();
    expect(refusal(empty, OWNER, owner, { type: 'set-contributor', githubId: 5, contributor: true })).toBeNull();
  });

  it('checks a viewer-controller\'s admit, kick, revoke and set-contributor targets against the snapshot', () => {
    expect(refusal(room, B, viewer(B), { type: 'admit', githubId: C })).toBeNull();
    expect(refusal(room, B, viewer(B), { type: 'admit', githubId: 999 })).toBe('unknown_participant');
    expect(refusal(room, B, viewer(B), { type: 'kick', githubId: C })).toBeNull();
    expect(refusal(room, B, viewer(B), { type: 'revoke', githubId: C })).toBeNull();
    expect(refusal(room, B, viewer(B), { type: 'kick', githubId: 999 })).toBe('unknown_participant');
    expect(refusal(room, B, viewer(B), { type: 'revoke', githubId: 999 })).toBe('unknown_participant');
    expect(refusal(room, B, viewer(B), { type: 'set-contributor', githubId: C, contributor: true })).toBe('unknown_participant');
    const admitted = snapshot(B, participant(B, 'admitted'), participant(C, 'admitted'));
    expect(refusal(admitted, B, viewer(B), { type: 'set-contributor', githubId: C, contributor: true })).toBeNull();
    expect(refusal(admitted, B, viewer(B), { type: 'admit', githubId: C })).toBe('unknown_participant');
  });
});

describe('readControllerCommand', () => {
  it('rebuilds each controller command from its known keys only', () => {
    expect(readControllerCommand({ type: 'admit', githubId: 7, extra: 'x' })).toEqual({ type: 'admit', githubId: 7 });
    expect(readControllerCommand({ type: 'admit', githubId: 7, contributor: true })).toEqual({ type: 'admit', githubId: 7, contributor: true });
    expect(readControllerCommand({ type: 'kick', githubId: 7, contributor: true })).toEqual({ type: 'kick', githubId: 7 });
    expect(readControllerCommand({ type: 'revoke', githubId: 7, reason: 'x' })).toEqual({ type: 'revoke', githubId: 7 });
    expect(readControllerCommand({ type: 'set-contributor', githubId: 7, contributor: false, x: 1 })).toEqual({
      type: 'set-contributor',
      githubId: 7,
      contributor: false,
    });
    expect(readControllerCommand({ type: 'set-controller', githubId: 7, admin: true })).toEqual({ type: 'set-controller', githubId: 7 });
  });

  it('refuses unrevoke (D-7) and unknown types', () => {
    expect(readControllerCommand({ type: 'unrevoke', githubId: 7 })).toBeNull();
    expect(readControllerCommand({ type: 'end', githubId: 7 })).toBeNull();
    expect(readControllerCommand({ githubId: 7 })).toBeNull();
  });

  it('refuses a githubId that is not a positive safe integer', () => {
    for (const githubId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '7', null, undefined]) {
      expect(readControllerCommand({ type: 'kick', githubId })).toBeNull();
    }
  });

  it('refuses a non-boolean contributor on admit and a missing one on set-contributor', () => {
    expect(readControllerCommand({ type: 'admit', githubId: 7, contributor: 'yes' })).toBeNull();
    expect(readControllerCommand({ type: 'set-contributor', githubId: 7 })).toBeNull();
    expect(readControllerCommand({ type: 'set-contributor', githubId: 7, contributor: 1 })).toBeNull();
  });

  it('refuses a value that is not a plain object', () => {
    for (const value of [null, undefined, 7, 'kick', [{ type: 'kick', githubId: 7 }]]) {
      expect(readControllerCommand(value)).toBeNull();
    }
  });
});
