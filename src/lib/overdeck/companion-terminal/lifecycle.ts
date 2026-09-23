/**
 * Companion terminal lifecycle (PAN-3974; the seam PAN-3835 reuses).
 *
 * A companion is a terminal session separate from the conversation's own
 * (owner) session, running a harness's native client attached to the owner's
 * live runtime. This module is harness-agnostic: a per-kind adapter resolves
 * the target (argv, cwd, fingerprint) from what the owner recorded, and the
 * host port creates, reads, and kills terminal sessions.
 *
 * Invariants:
 * - One companion per owner, named `companion-<ownerSession>`; every operation
 *   on an owner is serialized through a per-owner promise lock.
 * - The companion is stamped with the owner generation it was created for
 *   (owner incarnation + adapter fingerprint). A mismatched stamp is replaced,
 *   never reused; an open whose owner changed mid-create kills what it made;
 *   a close carrying a stale generation kills nothing.
 * - Nothing is stored: the terminal host is the authority. The companion holds
 *   no state of its own, so "when unsure, kill and recreate" is always safe.
 * - Opening never touches the owner. `closeForOwner` is the owner-teardown
 *   hook and never throws.
 */
import { createHash } from 'node:crypto';
import {
  companionTerminalKindFor,
  type CompanionTerminalKind,
  type CompanionTerminalState,
  type CompanionTerminalUnavailableReason,
} from '@overdeck/contracts';
import { validateSessionName } from '../../tmux.js';
import type { CompanionTerminalHost } from './host.js';

export interface CompanionOwner {
  readonly conversationName: string;
  /** The owner's terminal session (`conv.tmuxSession`). */
  readonly ownerSession: string;
  /** The conversation's working directory, from the conversation record. */
  readonly cwd: string;
  readonly harness: string | null | undefined;
}

export type CompanionTargetResolution =
  | {
      readonly ok: true;
      readonly argv: readonly string[];
      readonly cwd: string;
      /** Identity of the owner runtime the argv points at (e.g. `<port>:<sessionId>`). */
      readonly fingerprint: string;
    }
  | { readonly ok: false; readonly reason: CompanionTerminalUnavailableReason; readonly message: string };

export interface CompanionTerminalAdapter {
  readonly kind: CompanionTerminalKind;
  /** Resolve the native client target from server-side records only. */
  resolveTarget(owner: CompanionOwner): Promise<CompanionTargetResolution>;
}

export type CompanionCloseOutcome =
  | CompanionTerminalState
  | { readonly status: 'stale-generation'; readonly message: string };

export interface CompanionTerminalLifecycle {
  open(owner: CompanionOwner): Promise<CompanionTerminalState>;
  close(owner: CompanionOwner, generation: string): Promise<CompanionCloseOutcome>;
  closeForOwner(ownerSession: string): Promise<boolean>;
}

export const COMPANION_SESSION_PREFIX = 'companion-';

export function companionSessionName(ownerSession: string): string {
  const name = `${COMPANION_SESSION_PREFIX}${ownerSession}`;
  validateSessionName(name);
  return name;
}

export function companionGeneration(ownerSession: string, ownerStamp: string, fingerprint: string): string {
  return createHash('sha256').update(`${ownerSession}\n${ownerStamp}\n${fingerprint}`).digest('hex').slice(0, 24);
}

const OWNER_NOT_RUNNING_MESSAGE =
  'The conversation is not running, so there is no session to attach to. Resume it, then open Terminal again.';
const OWNER_CHANGED_MESSAGE =
  'The conversation restarted while its terminal was opening. Open Terminal again to attach to the new run.';
const STALE_GENERATION_MESSAGE =
  'This terminal belongs to an earlier run of the conversation, so it was left alone. Reopen Terminal.';

type Resolved =
  | { readonly ok: true; readonly generation: string; readonly argv: readonly string[]; readonly cwd: string }
  | { readonly ok: false; readonly reason: CompanionTerminalUnavailableReason; readonly message: string };

export function createCompanionTerminalLifecycle(deps: {
  readonly host: CompanionTerminalHost;
  readonly adapters: Partial<Record<CompanionTerminalKind, CompanionTerminalAdapter>>;
  readonly log?: (message: string) => void;
}): CompanionTerminalLifecycle {
  const { host, adapters } = deps;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const locks = new Map<string, Promise<unknown>>();

  function withOwnerLock<T>(ownerSession: string, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(ownerSession) ?? Promise.resolve();
    const run = previous.then(work, work);
    const settled = run.then(() => undefined, () => undefined);
    locks.set(ownerSession, settled);
    void settled.then(() => {
      if (locks.get(ownerSession) === settled) locks.delete(ownerSession);
    });
    return run;
  }

  async function resolve(adapter: CompanionTerminalAdapter, owner: CompanionOwner): Promise<Resolved> {
    const stamp = await host.ownerStamp(owner.ownerSession);
    if (!stamp) return { ok: false, reason: 'owner-not-running', message: OWNER_NOT_RUNNING_MESSAGE };
    const target = await adapter.resolveTarget(owner);
    if (!target.ok) return target;
    return {
      ok: true,
      generation: companionGeneration(owner.ownerSession, stamp, target.fingerprint),
      argv: target.argv,
      cwd: target.cwd,
    };
  }

  function adapterFor(owner: CompanionOwner): CompanionTerminalAdapter | null {
    const kind = companionTerminalKindFor(owner);
    return kind ? adapters[kind] ?? null : null;
  }

  function unsupported(): CompanionTerminalState {
    return {
      status: 'unavailable',
      kind: null,
      reason: 'unsupported',
      message: 'This conversation has no native terminal; its Terminal view shows the runtime pane.',
    };
  }

  return {
    open(owner) {
      const adapter = adapterFor(owner);
      if (!adapter) return Promise.resolve(unsupported());
      return withOwnerLock(owner.ownerSession, async (): Promise<CompanionTerminalState> => {
        const sessionName = companionSessionName(owner.ownerSession);
        const before = await resolve(adapter, owner);
        if (!before.ok) {
          // No owner session means any companion is attached to nothing; reap it.
          // Other reasons (starting, unreachable) leave a live companion alone.
          if (before.reason === 'owner-not-running') await host.kill(sessionName);
          return { status: 'unavailable', kind: adapter.kind, reason: before.reason, message: before.message };
        }

        const existing = await host.readGeneration(sessionName);
        if (existing === before.generation) {
          return { status: 'attached', kind: adapter.kind, sessionName, generation: before.generation, reused: true };
        }
        if (existing !== undefined) await host.kill(sessionName);
        await host.create(sessionName, { cwd: before.cwd, argv: before.argv, generation: before.generation });

        const after = await resolve(adapter, owner);
        if (!after.ok || after.generation !== before.generation) {
          if ((await host.readGeneration(sessionName)) === before.generation) await host.kill(sessionName);
          return { status: 'unavailable', kind: adapter.kind, reason: 'owner-changed', message: OWNER_CHANGED_MESSAGE };
        }
        return { status: 'attached', kind: adapter.kind, sessionName, generation: before.generation, reused: false };
      });
    },

    close(owner, generation) {
      const adapter = adapterFor(owner);
      if (!adapter) return Promise.resolve(unsupported());
      return withOwnerLock(owner.ownerSession, async (): Promise<CompanionCloseOutcome> => {
        const sessionName = companionSessionName(owner.ownerSession);
        const existing = await host.readGeneration(sessionName);
        if (existing === undefined) return { status: 'closed', kind: adapter.kind };
        if (existing !== generation) return { status: 'stale-generation', message: STALE_GENERATION_MESSAGE };
        await host.kill(sessionName);
        return { status: 'closed', kind: adapter.kind };
      });
    },

    closeForOwner(ownerSession) {
      return withOwnerLock(ownerSession, async () => {
        try {
          return await host.kill(companionSessionName(ownerSession));
        } catch (error) {
          log(`[companion-terminal] teardown for ${ownerSession} failed: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        }
      });
    },
  };
}
