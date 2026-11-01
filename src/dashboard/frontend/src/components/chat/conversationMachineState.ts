/**
 * Which machine a conversation runs on, as the title bar shows it (PAN-4650
 * WI-12, FR-5, D-6). Five states, surface tones only (never status colors):
 *
 * - `local`: this machine owns it and it accepts input.
 * - `remote`: a linked machine owns it and is online; remote control works.
 * - `offline-saved` / `offline-none`: a linked machine owns it but is
 *   unreachable; this machine has (or has not) a Session Vault saved copy.
 * - `released`: this machine's copy, given away by Pull here; read-only.
 *
 * Every state but `local` uses `--surface-remote`; the three non-live states
 * also mute the title, hide rename and the view toggle, and replace the
 * composer with a read-only notice.
 */
import type { Conversation } from '../CommandDeck/ConversationList';

export type ConversationMachineState = 'local' | 'remote' | 'offline-saved' | 'offline-none' | 'released';

type MachineInput = Pick<Conversation, 'origin' | 'machineState' | 'savedCopyName' | 'releasedTo'>;

export function conversationMachineState(conv: MachineInput): ConversationMachineState {
  if (conv.origin === 'linked') {
    if (conv.machineState === 'online') return 'remote';
    return conv.savedCopyName ? 'offline-saved' : 'offline-none';
  }
  return conv.releasedTo ? 'released' : 'local';
}

/** True for the two states in which the conversation takes input. */
export function isLiveMachineState(state: ConversationMachineState): boolean {
  return state === 'local' || state === 'remote';
}

/** A conversation this panel may resume or quote from: not a vault copy, not a non-live machine state. */
export function acceptsInput(conv: MachineInput): boolean {
  return conv.origin !== 'vault' && isLiveMachineState(conversationMachineState(conv));
}

/** "Continue on another device" needs a conversation this machine runs. */
export function runsHere(conv: MachineInput): boolean {
  return conv.origin !== 'vault' && conv.origin !== 'linked' && !conv.releasedTo;
}

export interface HeaderStatus {
  color: string;
  label: string;
  /** A hollow dot marks a copy that cannot run here (offline owner, released). */
  hollow: boolean;
}

/**
 * The header's status dot and label. v1.2 signal law: blue = machine activity
 * (forking/starting/alive), red = failed, neutral = ended. Amber is reserved
 * for human-action states. The non-live machine states are neutral and hollow.
 */
export function conversationHeaderStatus(
  conv: MachineInput & Pick<Conversation, 'sessionAlive'>,
  flags: { forking: boolean; spawning: boolean; failed: boolean },
): HeaderStatus {
  const state = conversationMachineState(conv);
  if (state === 'released') return { color: 'var(--muted-foreground)', label: 'released', hollow: true };
  if (state === 'offline-saved' || state === 'offline-none') return { color: 'var(--muted-foreground)', label: 'offline', hollow: true };
  if (flags.forking) return { color: 'var(--info)', label: 'forking', hollow: false };
  if (flags.spawning) return { color: 'var(--info)', label: 'starting', hollow: false };
  if (flags.failed) return { color: 'var(--destructive)', label: 'failed', hollow: false };
  return conv.sessionAlive ? { color: 'var(--info)', label: 'active', hollow: false } : { color: 'var(--muted-foreground)', label: 'ended', hollow: false };
}

/** Relative "last seen" text for the offline banner. */
export function lastSeenText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never';
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return 'never';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
