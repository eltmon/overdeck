/**
 * The dashboard's agent requests (PAN-4927 W-SEC1, D-1, D-2, D-3, D-6, D-11):
 * questions an agent asks the operator through the dashboard, and the 0600
 * file a delivered secret becomes.
 *
 * One store holds every request kind: `secret` (W-SEC1) and `machine-link`
 * (W-LINK1, PAN-4942). A machine-link request asks the operator to link a
 * machine; it lasts 24 hours and ends `linked` with the new machine's
 * environment id and label. A request is held in memory only: a dashboard restart forgets
 * every request, and a request that left `pending` is dropped one hour after
 * it ended. The owner directory is captured when the request is made and is
 * never part of a view, so no read route can answer it. Expiry is lazy: every
 * method first marks overdue pending requests `expired`, and a wait wakes at
 * the request's expiry, so no background timer runs. Only the request's owner
 * can read or wait on it; another agent's id is treated as unknown.
 *
 * A secret value never enters this store. `writeAgentSecretFile` writes it
 * straight to `<owner dir>/secrets/<name>` and its errors carry no value.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getAgentDir } from '../../../lib/agents/agent-state-read.js';
import { WAIT_CHUNK_MS } from '../../../lib/mcp/tool.js';
import { conversationStateDir } from '../../../lib/overdeck/conversation-pane-role.js';
import type { SelfCaller } from '../self-caller.js';

export type AgentRequestKind = 'secret' | 'machine-link';
export type AgentRequestStatus = 'pending' | 'delivered' | 'declined' | 'expired' | 'linked';

/** What routes may answer: never the owner directory, never a value. */
export interface AgentRequestView {
  /** 32 lowercase hex. */
  id: string;
  kind: AgentRequestKind;
  agentId: string;
  agentKind: 'agent' | 'conversation';
  label: string;
  /** Secret requests only. */
  name?: string;
  /** Secret requests only. */
  prompt?: string;
  /** Machine-link requests only (W-LINK1). */
  hint?: string;
  /** ISO time. */
  createdAt: string;
  /** ISO time. */
  expiresAt: string;
  status: AgentRequestStatus;
  endedAt: string | null;
  result?: AgentRequestResult;
}

/** What a request ended with: the delivered secret's file, or the linked machine (W-LINK1). */
export interface AgentRequestResult {
  file?: string;
  machine?: { environmentId: string; label: string };
}

export const AGENT_REQUEST_PENDING_LIMIT = 20;
export const SECRET_REQUEST_DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const SECRET_REQUEST_MIN_TIMEOUT_MS = 60_000;
export const SECRET_REQUEST_MAX_TIMEOUT_MS = 60 * 60_000;
export const ENDED_REQUEST_TTL_MS = 60 * 60_000;
export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
export const SECRET_VALUE_MAX_BYTES = 65_536;
export const MACHINE_LINK_REQUEST_TIMEOUT_MS = 24 * 60 * 60_000;
export const MACHINE_LINK_HINT_MAX_LENGTH = 200;

export interface AgentRequests {
  /** D-6: an existing pending request of the same agent and name is answered with created: false. */
  createSecret(
    caller: SelfCaller,
    input: { name: string; prompt: string; timeoutMs: number; label: string },
  ): { ok: true; created: boolean; request: AgentRequestView } | { ok: false; code: 'too-many-requests' };
  /** W-LINK1 D-2: an existing pending machine-link request of the same owner and hint (trimmed, case-insensitive) is answered with created: false. */
  createMachineLink(
    caller: SelfCaller,
    input: { hint: string; label: string },
  ): { ok: true; created: boolean; request: AgentRequestView } | { ok: false; code: 'too-many-requests' };
  /** The caller's own request, or null (unknown, not the caller's). */
  getForCaller(id: string, caller: SelfCaller): AgentRequestView | null;
  /** Resolves when the request leaves pending, timeoutMs (clamped 1..WAIT_CHUNK_MS) or expiry passes, or signal aborts. Null when unknown or not the caller's. */
  wait(id: string, caller: SelfCaller, timeoutMs: number, signal?: AbortSignal): Promise<AgentRequestView | null>;
  /** Pending requests, oldest first. */
  listPending(): AgentRequestView[];
  /** For the answer routes: the held request with its owner directory, or null. */
  getForAnswer(id: string): { view: AgentRequestView; ownerDir: string } | null;
  /** pending → status; resolves waiters. False when the request is unknown or no longer pending. */
  settle(id: string, status: Exclude<AgentRequestStatus, 'pending'>, result?: AgentRequestResult): boolean;
}

interface HeldRequest {
  view: AgentRequestView;
  ownerKey: string;
  ownerDir: string;
  expiresAtMs: number;
  endedAtMs: number | null;
  settled: Promise<void>;
  settle: () => void;
}

/** The private directory of the agent or conversation a self caller names (D-2). */
export function agentRequestOwnerDir(caller: SelfCaller): string {
  return caller.agentKind === 'agent'
    ? getAgentDir(caller.agentId)
    : conversationStateDir(caller.tmuxSession ?? `conv-${caller.agentId}`);
}

function ownerKeyOf(caller: Pick<SelfCaller, 'agentId' | 'agentKind'>): string {
  return `${caller.agentKind}:${caller.agentId}`;
}

function copyView(view: AgentRequestView): AgentRequestView {
  return view.result
    ? { ...view, result: { ...view.result, ...(view.result.machine ? { machine: { ...view.result.machine } } : {}) } }
    : { ...view };
}

export function createAgentRequests(deps: { now?: () => number; newId?: () => string } = {}): AgentRequests {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => randomBytes(16).toString('hex'));
  const records = new Map<string, HeldRequest>();

  function settleHeld(record: HeldRequest, status: Exclude<AgentRequestStatus, 'pending'>, result?: AgentRequestResult): void {
    const endedAtMs = now();
    record.endedAtMs = endedAtMs;
    record.view.status = status;
    record.view.endedAt = new Date(endedAtMs).toISOString();
    if (result) record.view.result = { ...result, ...(result.machine ? { machine: { ...result.machine } } : {}) };
    record.settle();
  }

  function expireDue(): void {
    const at = now();
    for (const record of records.values()) {
      if (record.view.status === 'pending' && at >= record.expiresAtMs) settleHeld(record, 'expired');
    }
  }

  function prune(): void {
    const at = now();
    for (const [id, record] of records) {
      if (record.endedAtMs !== null && at - record.endedAtMs > ENDED_REQUEST_TTL_MS) records.delete(id);
    }
  }

  function refresh(): void {
    expireDue();
    prune();
  }

  function owned(id: string, caller: SelfCaller): HeldRequest | null {
    const record = records.get(id);
    return record && record.ownerKey === ownerKeyOf(caller) ? record : null;
  }

  function insert(
    caller: SelfCaller,
    fields: Pick<AgentRequestView, 'kind' | 'name' | 'prompt' | 'hint'>,
    timeoutMs: number,
    label: string,
  ): AgentRequestView {
    const createdAtMs = now();
    const expiresAtMs = createdAtMs + timeoutMs;
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const view: AgentRequestView = {
      id: newId(),
      agentId: caller.agentId,
      agentKind: caller.agentKind,
      label,
      ...fields,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      status: 'pending',
      endedAt: null,
    };
    records.set(view.id, { view, ownerKey: ownerKeyOf(caller), ownerDir: agentRequestOwnerDir(caller), expiresAtMs, endedAtMs: null, settled, settle });
    return copyView(view);
  }

  return {
    createSecret(caller, input) {
      refresh();
      const ownerKey = ownerKeyOf(caller);
      let pendingOfOwner = 0;
      for (const record of records.values()) {
        if (record.ownerKey !== ownerKey || record.view.status !== 'pending') continue;
        if (record.view.kind === 'secret' && record.view.name === input.name) {
          return { ok: true, created: false, request: copyView(record.view) };
        }
        pendingOfOwner += 1;
      }
      if (pendingOfOwner >= AGENT_REQUEST_PENDING_LIMIT) return { ok: false, code: 'too-many-requests' };
      const request = insert(caller, { kind: 'secret', name: input.name, prompt: input.prompt }, input.timeoutMs, input.label);
      return { ok: true, created: true, request };
    },

    createMachineLink(caller, input) {
      refresh();
      const ownerKey = ownerKeyOf(caller);
      const hint = input.hint.trim();
      const hintKey = hint.toLowerCase();
      let pendingOfOwner = 0;
      for (const record of records.values()) {
        if (record.ownerKey !== ownerKey || record.view.status !== 'pending') continue;
        if (record.view.kind === 'machine-link' && record.view.hint?.trim().toLowerCase() === hintKey) {
          return { ok: true, created: false, request: copyView(record.view) };
        }
        pendingOfOwner += 1;
      }
      if (pendingOfOwner >= AGENT_REQUEST_PENDING_LIMIT) return { ok: false, code: 'too-many-requests' };
      const request = insert(caller, { kind: 'machine-link', hint }, MACHINE_LINK_REQUEST_TIMEOUT_MS, input.label);
      return { ok: true, created: true, request };
    },

    getForCaller(id, caller) {
      refresh();
      const record = owned(id, caller);
      return record ? copyView(record.view) : null;
    },

    async wait(id, caller, timeoutMs, signal) {
      refresh();
      const record = owned(id, caller);
      if (!record) return null;
      if (record.view.status !== 'pending') return copyView(record.view);
      const chunk = Math.min(Math.max(Math.trunc(timeoutMs) || 1, 1), WAIT_CHUNK_MS);
      const ms = Math.min(chunk, record.expiresAtMs - now());
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      const delay = new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        timer = setTimeout(resolve, ms);
        onAbort = () => resolve();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([record.settled, delay]);
      } finally {
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
      expireDue();
      return copyView(record.view);
    },

    listPending() {
      refresh();
      return [...records.values()]
        .filter((record) => record.view.status === 'pending')
        .sort((a, b) => a.view.createdAt.localeCompare(b.view.createdAt))
        .map((record) => copyView(record.view));
    },

    getForAnswer(id) {
      refresh();
      const record = records.get(id);
      return record ? { view: copyView(record.view), ownerDir: record.ownerDir } : null;
    },

    settle(id, status, result) {
      refresh();
      const record = records.get(id);
      if (!record || record.view.status !== 'pending') return false;
      settleHeld(record, status, result);
      return true;
    },
  };
}

/** The dashboard's one agent request store. */
export const agentRequests: AgentRequests = createAgentRequests();

/** Write a delivered secret: <ownerDir>/secrets/<name>, dir 0700, file 0600, temp + rename. Returns the file path. Errors carry no value. */
export async function writeAgentSecretFile(ownerDir: string, name: string, value: string): Promise<string> {
  if (!SECRET_NAME_PATTERN.test(name)) throw new Error('secret name must match ^[A-Z][A-Z0-9_]{0,63}$');
  const dir = join(ownerDir, 'secrets');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode applies only to a directory it creates.
  await chmod(dir, 0o700);
  const file = join(dir, name);
  const partial = join(dir, `${name}.${randomUUID()}.partial`);
  try {
    await writeFile(partial, value, { flag: 'wx', mode: 0o600 });
    await rename(partial, file);
  } catch (error) {
    await unlink(partial).catch(() => undefined);
    throw error;
  }
  return file;
}
