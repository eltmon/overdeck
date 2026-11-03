/**
 * The account page's client for the connect Worker's Directory Durable Object (PRD PAN-4959 WI-5; D-2, D-11).
 *
 * The `DIRECTORY` binding is cross-script: the stub reaches `AccountDirectory` inside overdeck-connect, named
 * by the user id exactly as connect names it. The response shapes are declared structurally here so this
 * Worker never imports connect code (services/connect/src/account-view.ts is the other side).
 */
import type { Env } from './env.ts';

export interface DirectoryMachine {
  environmentId: string;
  label: string;
  online: boolean;
  /** ISO-8601. */
  lastSeenAt: string;
  serverVersion: string;
  deviceId: string;
}

export interface DirectoryRelay {
  /** UTC calendar month, `YYYY-MM`. */
  month: string;
  bytesUsed: number;
  capBytes: number;
  stopped: boolean;
}

export interface DirectoryView {
  /** Oldest first. */
  machines: DirectoryMachine[];
  relay: DirectoryRelay;
}

export type RemoveMachineOutcome = 'removed' | 'unknown' | 'unavailable';

const PATHS = { view: '/account-view', removeMachine: '/remove-machine', deleteAccount: '/delete-account' } as const;

function stubFor(namespace: DurableObjectNamespace, userId: string): DurableObjectStub {
  return namespace.get(namespace.idFromName(userId));
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function isMachine(v: unknown): v is DirectoryMachine {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  return (
    isString(m.environmentId) && isString(m.label) && typeof m.online === 'boolean' &&
    isString(m.lastSeenAt) && isString(m.serverVersion) && isString(m.deviceId)
  );
}

function isRelay(v: unknown): v is DirectoryRelay {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isString(r.month) && isCount(r.bytesUsed) && isCount(r.capBytes) && typeof r.stopped === 'boolean';
}

function isView(v: unknown): v is DirectoryView {
  if (typeof v !== 'object' || v === null) return false;
  const view = v as Record<string, unknown>;
  return Array.isArray(view.machines) && view.machines.every(isMachine) && isRelay(view.relay);
}

/** The account's machines and relay use; null when unbound, on a throw, a non-200 or a body of the wrong shape (FR-12). */
export async function readDirectoryView(env: Env, userId: string): Promise<DirectoryView | null> {
  if (!env.DIRECTORY) return null;
  try {
    const res = await stubFor(env.DIRECTORY, userId).fetch(`https://directory${PATHS.view}`);
    if (res.status !== 200) return null;
    const body: unknown = await res.json();
    return isView(body) ? body : null;
  } catch {
    return null;
  }
}

/** Forgets one machine (FR-7): 200 → removed, 404 → unknown, anything else, a throw or no binding → unavailable. */
export async function removeDirectoryMachine(env: Env, userId: string, environmentId: string): Promise<RemoveMachineOutcome> {
  if (!env.DIRECTORY) return 'unavailable';
  try {
    const res = await stubFor(env.DIRECTORY, userId).fetch(`https://directory${PATHS.removeMachine}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ environmentId }),
    });
    if (res.status === 200) return 'removed';
    if (res.status === 404) return 'unknown';
    return 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Empties the account's Directory DO (FR-11). Throws on a non-200 so the deletion job records `last_error` and retries. */
export async function deleteDirectoryAccount(env: Env, userId: string): Promise<void> {
  if (!env.DIRECTORY) throw new Error('directory delete failed: DIRECTORY is not bound');
  const res = await stubFor(env.DIRECTORY, userId).fetch(`https://directory${PATHS.deleteAccount}`, { method: 'POST' });
  if (res.status !== 200) throw new Error(`directory delete failed: HTTP ${res.status}`);
}
