/**
 * The owner's half of Pull here (PAN-4650 WI-9, D-4650-9/10/11, NFR-2).
 *
 * `releaseConversation` makes this machine give a conversation up to the
 * linked machine that asked: it waits for (or stops) a running turn, marks
 * `released_to`, settles the transcript with uncommitted code (`wip: 'force'`)
 * into a fresh `dir:` vault store under a fresh key, packs that store, and
 * stops the harness. The key travels only in the answer, inside the secure
 * channel. Any failure after marking clears `released_to` again, so the owner
 * never ends up released without a transfer. Nothing undoes a release on a
 * timer: only `undoRelease` (the viewer reports a failed adopt) or
 * `pan conv reclaim` does (NFR-2).
 *
 * The transfer settles with an empty in-memory vault index, so it carries the
 * whole transcript and never moves this machine's real vault tail. It is
 * titled with the owner's conversation title, so the adopted conversation
 * keeps it. Transfer directories live under
 * `${OVERDECK_HOME}/pull-transfers/<transferId>/` and are deleted on
 * complete, on undo, or 15 minutes after creation.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SharedConversationsResponse } from '@overdeck/contracts';

import { linkFetch, LinkUnavailableError } from '../../../lib/anywhere/link-client.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { conversationHarnessAlive } from '../../../lib/overdeck/conversation-liveness.js';
import { getEnrichedConversationList } from '../../../lib/overdeck/conversation-list.js';
import { handleConversationAbort } from '../../../lib/overdeck/conversation-delivery.js';
import { resolveSessionFile } from '../../../lib/overdeck/conversation-reads.js';
import {
  clearConversationRelease,
  conversationWriteRefusalBody,
  markConversationReleased,
  readPulledFrom,
  type PulledFrom,
} from '../../../lib/overdeck/conversation-release.js';
import { handleConversationResume, handleConversationStop } from '../../../lib/overdeck/conversation-runtime.js';
import { getConversationByName, type LegacyConversation } from '../../../lib/overdeck/conversations.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { createVaultKey, deriveSubkeys } from '../../../lib/vault/identity.js';
import type { OwnedEntry } from '../../../lib/vault/local-index.js';
import { storeForBackend } from '../../../lib/vault/open.js';
import { isResumableHarness } from '../../../lib/vault/resumable.js';
import { settle as settleTranscript, type SettleIndex, type SettleOptions, type SettleResult } from '../../../lib/vault/settle.js';
import { packDirectory } from '../../../lib/vault/transfer-pack.js';

export const PULL_TRANSFERS_DIRNAME = 'pull-transfers';
export const TRANSFER_TTL_MS = 15 * 60_000;
export const TRANSFER_SWEEP_INTERVAL_MS = 60_000;
export const TURN_POLL_MS = 2_000;
export const TURN_WAIT_MAX_MS = 30 * 60_000;
export const TRANSFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type WhenTurnRunning = 'wait' | 'stop';

export interface ReleaseAnswer {
  transferId: string;
  vaultId: string;
  keyHex: string;
  ownerEnvironmentId: string;
  harness: string;
  nativeSessionId: string | null;
  bytes: number;
  /** D-4650-14: where this machine pulled the conversation from, so a push back archives that copy. */
  pulledFrom: PulledFrom | null;
}

export interface ServiceAnswer {
  status: number;
  body: Record<string, unknown>;
}

interface TransferMeta {
  name: string;
  createdAt: number;
  /** The harness ran before the release stopped it; an undo resumes it. */
  wasAlive: boolean;
}

export interface ReleaseServiceDeps {
  getConversation: (name: string) => LegacyConversation | null;
  isWorking: (name: string) => Promise<boolean>;
  abort: (name: string) => Promise<{ status: number }>;
  stop: (name: string) => Promise<{ status: number }>;
  resume: (name: string) => Promise<{ status: number }>;
  harnessAlive: (tmuxSession: string) => Promise<boolean>;
  resolvePath: (conv: LegacyConversation) => Promise<string | null>;
  settle: (options: SettleOptions) => Promise<SettleResult>;
  environmentId: () => Promise<string>;
  home: () => string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Reclaim asks the machine a conversation was released to for its shared list. */
  fetchShared: (environmentId: string) => Promise<{ status: number; json: unknown }>;
}

async function isWorkingFromList(name: string): Promise<boolean> {
  const rows = (await getEnrichedConversationList(500, 0)) as ReadonlyArray<{ name: string; isWorking?: boolean }>;
  return rows.find((row) => row.name === name)?.isWorking === true;
}

const defaultDeps: ReleaseServiceDeps = {
  getConversation: getConversationByName,
  isWorking: isWorkingFromList,
  abort: handleConversationAbort,
  stop: (name) => handleConversationStop(name, {}),
  resume: (name) => handleConversationResume(name, {}, { resolveSessionFile }),
  harnessAlive: conversationHarnessAlive,
  resolvePath: resolveSessionFile,
  settle: settleTranscript,
  environmentId: async () => (await ensureEnvironmentIdentity()).environmentId,
  home: getOverdeckHome,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetchShared: (environmentId) => linkFetch(environmentId, '/api/machines/conversations', { actor: 'operator' }),
};

function withDefaults(deps: Partial<ReleaseServiceDeps>): ReleaseServiceDeps {
  return { ...defaultDeps, ...deps };
}

function transfersRoot(deps: ReleaseServiceDeps): string {
  return join(deps.home(), PULL_TRANSFERS_DIRNAME);
}

function transferDir(deps: ReleaseServiceDeps, transferId: string): string {
  return join(transfersRoot(deps), transferId);
}

/** An empty vault index for one settle: the transfer store starts with no record. */
function memoryIndex(): SettleIndex {
  const owned = new Map<string, OwnedEntry>();
  return {
    getOwned: async (path) => owned.get(path) ?? null,
    setOwnedTail: async (path, entry) => { owned.set(path, entry); },
  };
}

async function readMeta(deps: ReleaseServiceDeps, transferId: string): Promise<TransferMeta | null> {
  try {
    return JSON.parse(await readFile(join(transferDir(deps, transferId), 'meta.json'), 'utf8')) as TransferMeta;
  } catch {
    return null;
  }
}

/** The transfer ids recorded for a conversation. */
async function transfersOf(deps: ReleaseServiceDeps, name: string): Promise<string[]> {
  let ids: string[];
  try {
    ids = await readdir(transfersRoot(deps));
  } catch {
    return [];
  }
  const owned: string[] = [];
  for (const id of ids) {
    if ((await readMeta(deps, id))?.name === name) owned.push(id);
  }
  return owned;
}

/** D-4650-11: false when a turn still runs after 30 minutes of waiting. */
async function settleTurn(name: string, when: WhenTurnRunning, deps: ReleaseServiceDeps): Promise<boolean> {
  if (!(await deps.isWorking(name))) return true;
  if (when === 'stop') {
    await deps.abort(name);
    return true;
  }
  const deadline = deps.now() + TURN_WAIT_MAX_MS;
  while (deps.now() < deadline) {
    await deps.sleep(TURN_POLL_MS);
    if (!(await deps.isWorking(name))) return true;
  }
  return false;
}

/** Settle into a fresh transfer store and pack it; the store's directory holds the pack too. */
async function buildTransfer(
  conv: LegacyConversation,
  nativePath: string,
  harness: string,
  wasAlive: boolean,
  deps: ReleaseServiceDeps,
): Promise<ReleaseAnswer> {
  const transferId = randomUUID();
  const dir = transferDir(deps, transferId);
  const storeDir = join(dir, 'store');
  await mkdir(storeDir, { recursive: true });
  const meta: TransferMeta = { name: conv.name, createdAt: deps.now(), wasAlive };
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta), { mode: 0o600 });
  const key = createVaultKey();
  const result = await deps.settle({
    nativePath,
    harness,
    store: await storeForBackend(`dir:${storeDir}`),
    keys: deriveSubkeys(key),
    wip: 'force',
    index: memoryIndex(),
    // The adopted conversation takes the record title; keep the owner's (PAN-4904).
    ...(conv.title ? { recordTitle: conv.title } : {}),
  });
  if (result.verdict !== 'append') {
    const detail = result.verdict === 'blocked'
      ? `the secret scan blocked ${result.hits.length} line(s)`
      : result.verdict === 'diverged' ? result.reason : `the transcript settled as ${result.verdict}`;
    throw new Error(detail);
  }
  const pack = await packDirectory(storeDir);
  await writeFile(join(dir, 'pack.bin'), pack, { mode: 0o600 });
  return {
    transferId,
    vaultId: result.vaultId,
    keyHex: key.toString('hex'),
    ownerEnvironmentId: await deps.environmentId(),
    harness,
    nativeSessionId: conv.claudeSessionId,
    bytes: pack.length,
    pulledFrom: readPulledFrom(conv.name),
  };
}

/** `POST /api/conversations/:name/release`. `to` is the calling machine's environment id. */
export async function releaseConversation(
  name: string,
  input: { to: string; whenTurnRunning: WhenTurnRunning },
  overrides: Partial<ReleaseServiceDeps> = {},
): Promise<ServiceAnswer> {
  const deps = withDefaults(overrides);
  const conv = deps.getConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  const refusal = conversationWriteRefusalBody(conv);
  if (refusal) return { status: 409, body: { ...refusal } };
  const harness = conv.harness ?? 'claude-code';
  if (!isResumableHarness(harness)) {
    return { status: 400, body: { error: `Pull here works for Claude Code and Codex conversations, not ${harness}`, code: 'not-pullable' } };
  }
  if (!(await settleTurn(name, input.whenTurnRunning, deps))) {
    return { status: 409, body: { error: 'The turn is still running after 30 minutes', code: 'turn-still-running' } };
  }
  const nativePath = await deps.resolvePath(conv);
  if (!nativePath) return { status: 409, body: { error: 'This conversation has no transcript file yet', code: 'no-transcript' } };
  const wasAlive = await deps.harnessAlive(conv.tmuxSession);

  markConversationReleased(name, input.to);
  let transferId: string | null = null;
  try {
    const answer = await buildTransfer(conv, nativePath, harness, wasAlive, deps);
    transferId = answer.transferId;
    const stopped = await deps.stop(name);
    if (stopped.status >= 400) throw new Error(`stopping the harness answered ${stopped.status}`);
    return { status: 200, body: { ...answer } };
  } catch (error) {
    clearConversationRelease(name);
    // A transfer that never finished is useless; a stopped-and-failed one is cleared here too.
    for (const id of transferId ? [transferId] : await transfersOf(deps, name)) {
      await rm(transferDir(deps, id), { recursive: true, force: true });
    }
    return { status: 500, body: { error: 'The release failed and was undone', code: 'release-failed', detail: (error as Error).message } };
  }
}

/** `GET /api/conversations/:name/release/transfer/:transferId`: the pack, or null when unknown. */
export async function readTransferPack(name: string, transferId: string, overrides: Partial<ReleaseServiceDeps> = {}): Promise<Buffer | null> {
  const deps = withDefaults(overrides);
  if (!TRANSFER_ID.test(transferId) || (await readMeta(deps, transferId))?.name !== name) return null;
  try {
    return await readFile(join(transferDir(deps, transferId), 'pack.bin'));
  } catch {
    return null;
  }
}

/** `POST …/release/undo`: the viewer could not adopt; this machine owns the conversation again. */
export async function undoRelease(name: string, overrides: Partial<ReleaseServiceDeps> = {}): Promise<ServiceAnswer> {
  const deps = withDefaults(overrides);
  const conv = deps.getConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  if (!conv.releasedTo) return { status: 409, body: { error: 'This conversation is not released', code: 'not-released' } };
  const transfers = await transfersOf(deps, name);
  const wasAlive = (await Promise.all(transfers.map((id) => readMeta(deps, id)))).some((meta) => meta?.wasAlive === true);
  clearConversationRelease(name);
  for (const id of transfers) await rm(transferDir(deps, id), { recursive: true, force: true });
  const resumed = wasAlive ? (await deps.resume(name)).status < 400 : false;
  return { status: 200, body: { ok: true, resumed } };
}

/** `POST …/release/complete`: the viewer adopted; drop the transfer, keep `released_to`. */
export async function completeRelease(name: string, overrides: Partial<ReleaseServiceDeps> = {}): Promise<ServiceAnswer> {
  const deps = withDefaults(overrides);
  const conv = deps.getConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  if (!conv.releasedTo) return { status: 409, body: { error: 'This conversation is not released', code: 'not-released' } };
  for (const id of await transfersOf(deps, name)) await rm(transferDir(deps, id), { recursive: true, force: true });
  return { status: 200, body: { ok: true } };
}

/**
 * `pan conv reclaim` (D-4650-10): take back a released conversation when the
 * machine it went to does not run it. Refused when that machine lists it live
 * and unreleased (`still-running-there`), or cannot be asked
 * (`target-offline`) unless `force`. Matched by the pulled copy's
 * `pulledFrom` (adoption gave it a new session id) or by the session id.
 */
export async function reclaimRelease(name: string, input: { force: boolean }, overrides: Partial<ReleaseServiceDeps> = {}): Promise<ServiceAnswer> {
  const deps = withDefaults(overrides);
  const conv = deps.getConversation(name);
  if (!conv) return { status: 404, body: { error: 'Conversation not found' } };
  const target = conv.releasedTo;
  if (!target) return { status: 409, body: { error: 'This conversation is not released', code: 'not-released' } };
  let shared: SharedConversationsResponse | null = null;
  try {
    const response = await deps.fetchShared(target);
    if (response.status === 200) shared = response.json as SharedConversationsResponse;
  } catch (error) {
    if (!(error instanceof LinkUnavailableError)) throw error;
  }
  if (!shared && !input.force) {
    return { status: 409, body: { error: 'The machine it was released to cannot be asked; pass --force to take it back anyway', code: 'target-offline' } };
  }
  const self = await deps.environmentId();
  const session = conv.claudeSessionId;
  const running = (shared?.rows ?? []).find((row) => row.sessionAlive && row.releasedTo === null && session !== null
    && (row.nativeSessionId === session || (row.pulledFrom?.environmentId === self && row.pulledFrom.nativeSessionId === session)));
  if (running) {
    return { status: 409, body: { error: `It is still running there as ${running.name}; pull it back instead`, code: 'still-running-there', remoteName: running.name } };
  }
  clearConversationRelease(name);
  for (const id of await transfersOf(deps, name)) await rm(transferDir(deps, id), { recursive: true, force: true });
  return { status: 200, body: { ok: true } };
}

/** Delete transfer directories older than 15 minutes. */
export async function sweepTransfers(overrides: Partial<ReleaseServiceDeps> = {}): Promise<number> {
  const deps = withDefaults(overrides);
  let ids: string[];
  try {
    ids = await readdir(transfersRoot(deps));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const id of ids) {
    const dir = transferDir(deps, id);
    const created = (await readMeta(deps, id))?.createdAt ?? (await stat(dir).catch(() => null))?.mtimeMs ?? deps.now();
    if (deps.now() - created < TRANSFER_TTL_MS) continue;
    await rm(dir, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

/** Start the unref'd 60 s sweep; returns its stop function. */
export function startTransferSweep(overrides: Partial<ReleaseServiceDeps> = {}): () => void {
  const timer = setInterval(() => {
    void sweepTransfers(overrides).catch((error: unknown) => console.warn(`[pull] transfer sweep failed: ${(error as Error).message}`));
  }, TRANSFER_SWEEP_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
