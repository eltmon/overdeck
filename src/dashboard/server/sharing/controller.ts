/**
 * Who controls a share, and whether the host accepts a share command (PRD PAN-4478 FR-2..FR-8).
 *
 * The host trusts only a controller it appointed (D-2, NFR-1): `ControllerState` records the viewer
 * this host process last made controller. The effective controller is that viewer when the latest
 * room snapshot's `controllerGithubId` confirms it, and the data owner otherwise, so a share service
 * that names an unappointed controller only produces "the data owner controls".
 *
 * One gate for both actors (D-4): `controlRefusal` decides the data owner's commands (ShareManager)
 * and a viewer-controller's commands (PeerHub). Reclaim, the data owner's `set-controller` with its
 * own id, is always accepted. For the data owner only `set-controller` targets are checked here; its
 * other commands keep slice-2 semantics and the share service answers bad targets (D-5). A viewer's
 * targets are checked against the snapshot here, because its commands come from a remote peer.
 *
 * Pure: no I/O, no timers.
 */
import type { RoomSnapshot, ShareCommand, SharedCommandRefusal, SharedControllerCommand } from '@overdeck/contracts';

export type ControlActor = { readonly kind: 'owner' } | { readonly kind: 'viewer'; readonly githubId: number };
export type ControlRefusal = Extract<SharedCommandRefusal, 'not_controller' | 'unknown_participant' | 'invalid_target' | 'invalid_command'>;

/** The host's own appointment (D-2). `null` = the data owner. */
export class ControllerState {
  private appointed: number | null = null;

  /** The effective controller, or null before the first snapshot. */
  current(snapshot: RoomSnapshot | null): number | null {
    if (!snapshot) return null;
    const appointed = this.appointed;
    return appointed !== null && snapshot.controllerGithubId === appointed ? appointed : snapshot.dataOwner.githubId;
  }

  appoint(githubId: number, ownerGithubId: number): void {
    this.appointed = githubId === ownerGithubId ? null : githubId;
  }

  /** A viewer the snapshot no longer lists as admitted loses the appointment (FR-2). */
  onSnapshot(snapshot: RoomSnapshot): void {
    const appointed = this.appointed;
    if (appointed === null) return;
    if (!snapshot.participants.some((p) => p.githubId === appointed && p.state === 'admitted')) this.appointed = null;
  }
}

export function controlRefusal(input: {
  readonly snapshot: RoomSnapshot;
  readonly controllerGithubId: number;
  readonly actor: ControlActor;
  readonly command: ShareCommand;
  isHostAdmitted(githubId: number): boolean;
}): ControlRefusal | null {
  const { snapshot, actor, command } = input;
  const owner = snapshot.dataOwner.githubId;
  const actorId = actor.kind === 'owner' ? owner : actor.githubId;
  const target = command.githubId;
  if (actor.kind === 'owner' && command.type === 'set-controller' && target === owner) return null;
  if (actorId !== input.controllerGithubId) return 'not_controller';
  if (actor.kind === 'viewer' && command.type === 'unrevoke') return 'invalid_command';
  if (actor.kind === 'viewer' && target === actorId) return 'invalid_target';
  if (command.type === 'set-controller') {
    if (target === owner) return null;
    const admitted = snapshot.participants.some((p) => p.githubId === target && p.state === 'admitted');
    return admitted && input.isHostAdmitted(target) ? null : 'unknown_participant';
  }
  if (actor.kind === 'owner') return null;
  const participant = snapshot.participants.find((p) => p.githubId === target);
  switch (command.type) {
    case 'admit':
      return participant?.state === 'lobby' ? null : 'unknown_participant';
    case 'kick':
    case 'revoke':
      return participant ? null : 'unknown_participant';
    case 'set-contributor':
      return participant?.state === 'admitted' ? null : 'unknown_participant';
    default:
      return 'invalid_command';
  }
}

/** A viewer's command rebuilt from its known keys, or null (FR-8, NFR-3). `unrevoke` is null (D-7). */
export function readControllerCommand(value: unknown): SharedControllerCommand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const githubId = record['githubId'];
  if (typeof githubId !== 'number' || !Number.isSafeInteger(githubId) || githubId <= 0) return null;
  const contributor = record['contributor'];
  switch (record['type']) {
    case 'admit':
      if (contributor === undefined) return { type: 'admit', githubId };
      return typeof contributor === 'boolean' ? { type: 'admit', githubId, contributor } : null;
    case 'kick':
      return { type: 'kick', githubId };
    case 'revoke':
      return { type: 'revoke', githubId };
    case 'set-contributor':
      return typeof contributor === 'boolean' ? { type: 'set-contributor', githubId, contributor } : null;
    case 'set-controller':
      return { type: 'set-controller', githubId };
    default:
      return null;
  }
}
