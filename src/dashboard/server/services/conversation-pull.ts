/**
 * The viewer's half of Pull here (PAN-4650 WI-10, D-4650-12/13/14, NFR-2).
 *
 * A pull is a job in four steps. `release` asks the owner to give the
 * conversation up (waiting up to 31 minutes for a running turn); `transfer`
 * downloads the packed transfer store and unpacks it here; `adopt` runs the
 * Session Vault Continue here against that store; `finish` tells the owner
 * to drop its transfer. Once the owner has released, any failure posts
 * `release/undo`, so the owner resumes and one machine runs the
 * conversation (NFR-2). Nothing undoes a release on a timer.
 *
 * When the owner is unreachable (D-4650-13) the pull adopts this machine's
 * saved copy (`vault-<vaultId>`) through the normal vault Continue here and
 * its compare-and-swap; with no saved copy it fails
 * `owner-offline-no-saved-copy`. Pushing back is a pull from the other side
 * (D-4650-14): the owner's release names where it pulled the conversation
 * from, and this machine's old released row for it is archived (never its
 * transcript). Jobs live in memory for an hour.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { parseLinkedConversationName } from '@overdeck/contracts';

import { linkForward, LINK_FORWARD_MAX_BYTES, LinkUnavailableError, type LinkForwardInit, type LinkForwardResponse } from '../../../lib/anywhere/link-client.js';
import { getLink, type MachineLink } from '../../../lib/anywhere/link-store.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { markPulledFrom, type PulledFrom } from '../../../lib/overdeck/conversation-release.js';
import { archiveConversation, getConversationByClaudeSessionId, getConversationByName } from '../../../lib/overdeck/conversations.js';
import { getLinkedConversation, type LinkedConversationRecord } from '../../../lib/overdeck/linked-conversations.js';
import { getOverdeckHome } from '../../../lib/paths.js';
import { adoptRecord } from '../../../lib/vault/adopt.js';
import { readVaultConfig } from '../../../lib/vault/config.js';
import { deriveSubkeys } from '../../../lib/vault/identity.js';
import { removeOwned } from '../../../lib/vault/local-index.js';
import { storeForBackend } from '../../../lib/vault/open.js';
import { unpackDirectory } from '../../../lib/vault/transfer-pack.js';
import { PULL_TRANSFERS_DIRNAME, type ReleaseAnswer, TRANSFER_ID, type WhenTurnRunning } from './conversation-release-service.js';
import { continueHere, ownerToken, previewContinue, type Outcome, type VaultContinueDeps } from './vault-continue.js';

export type PullStep = 'release' | 'transfer' | 'adopt' | 'finish';
export const PULL_JOB_RETENTION_MS = 60 * 60_000;
/** The owner may wait 30 minutes for a turn; the request outlives it by one. */
export const RELEASE_TIMEOUT_MS = 31 * 60_000;

export interface PullJob {
  pullId: string;
  conversation: string;
  step: PullStep;
  state: 'running' | 'done' | 'failed';
  /** 'online' through the owner; 'offline' through this machine's saved copy. */
  mode: 'online' | 'offline';
  error?: string;
  code?: string;
  result?: { id: number; name: string };
  createdAt: number;
}

export interface PullDeps {
  getLink: (idOrEnvOrLabel: string) => Promise<MachineLink | null>;
  getLinked: (environmentId: string, name: string) => LinkedConversationRecord | null;
  forward: (environmentId: string, init: LinkForwardInit) => Promise<LinkForwardResponse>;
  selfEnvironmentId: () => Promise<string>;
  home: () => string;
  continueHere: typeof continueHere;
  previewContinue: typeof previewContinue;
  readVaultConfig: typeof readVaultConfig;
  removeOwned: (nativePath: string) => Promise<void>;
  adoptRecord: typeof adoptRecord;
  now: () => number;
}

const defaultDeps: PullDeps = {
  getLink,
  getLinked: getLinkedConversation,
  forward: linkForward,
  selfEnvironmentId: async () => (await ensureEnvironmentIdentity()).environmentId,
  home: getOverdeckHome,
  continueHere,
  previewContinue,
  readVaultConfig,
  removeOwned,
  adoptRecord,
  now: () => Date.now(),
};

const jobs = new Map<string, PullJob>();
const running = new Map<string, Promise<void>>();

class PullFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function pruneJobs(now: number): void {
  for (const [id, job] of jobs) {
    if (now - job.createdAt >= PULL_JOB_RETENTION_MS) jobs.delete(id);
  }
}

function json(response: LinkForwardResponse): Record<string, unknown> {
  try {
    return JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function ownerPath(name: string, rest = ''): string {
  return `/api/conversations/${encodeURIComponent(name)}${rest}`;
}

/** D-4650-14: archive this machine's old released copy when the conversation comes back. */
function archivePushedBack(pulledFrom: PulledFrom | null, self: string, ownerEnvironmentId: string): void {
  if (!pulledFrom || pulledFrom.environmentId !== self) return;
  const old = getConversationByClaudeSessionId(pulledFrom.nativeSessionId);
  if (old && old.releasedTo === ownerEnvironmentId && old.archivedAt === null) archiveConversation(old.name);
}

/** The conversation `continueHere` created, as the job's result. */
function adopted(outcome: Outcome): { id: number; name: string } {
  const name = (outcome.body as { conversation?: { name?: string } }).conversation?.name;
  if (outcome.status !== 200 || !name) {
    const body = outcome.body as { error?: string; code?: string };
    throw new PullFailure(body.code ?? 'adopt-failed', body.error ?? `Continue here answered ${outcome.status}`);
  }
  return { id: getConversationByName(name)?.id ?? 0, name };
}

async function runOnline(job: PullJob, link: MachineLink, ownerName: string, when: WhenTurnRunning, deps: PullDeps): Promise<void> {
  const self = await deps.selfEnvironmentId();
  const release = await deps.forward(link.environmentId, {
    method: 'POST',
    path: ownerPath(ownerName, '/release'),
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ to: self, whenTurnRunning: when })),
    actor: 'operator',
    timeoutMs: RELEASE_TIMEOUT_MS,
  });
  if (release.status !== 200) {
    const body = json(release);
    throw new PullFailure(String(body.code ?? 'release-refused'), String(body.error ?? `${link.label} answered ${release.status}`));
  }
  const answer = json(release) as unknown as ReleaseAnswer;
  const undo = () => deps.forward(link.environmentId, { method: 'POST', path: ownerPath(ownerName, '/release/undo'), actor: 'operator' }).catch(() => undefined);
  // The transfer id becomes a directory here (removed afterwards), so it must be the owner's UUID shape.
  if (typeof answer.transferId !== 'string' || !TRANSFER_ID.test(answer.transferId)) {
    await undo();
    throw new PullFailure('release-invalid', `${link.label} answered the release with an invalid transfer id`);
  }
  const dir = join(deps.home(), PULL_TRANSFERS_DIRNAME, answer.transferId);
  // From here the owner is released: every failure before adoption undoes it.
  let adoptedHere = false;
  try {
    job.step = 'transfer';
    if (answer.bytes > LINK_FORWARD_MAX_BYTES) {
      throw new PullFailure('transfer-too-large', `The transfer is ${answer.bytes} bytes, more than a link carries (${LINK_FORWARD_MAX_BYTES})`);
    }
    const pack = await deps.forward(link.environmentId, { method: 'GET', path: ownerPath(ownerName, `/release/transfer/${answer.transferId}`), actor: 'operator' });
    if (pack.status !== 200) throw new PullFailure('transfer-failed', `${link.label} answered ${pack.status} for the transfer`);
    const storeDir = join(dir, 'store');
    await mkdir(storeDir, { recursive: true });
    await unpackDirectory(pack.body, storeDir);

    job.step = 'adopt';
    let adoptedPath: string | null = null;
    const overrides: Partial<VaultContinueDeps> = {
      openVaultContext: async () => ({
        status: 'open',
        vault: {
          config: await deps.readVaultConfig(),
          keys: deriveSubkeys(Buffer.from(answer.keyHex, 'hex')),
          store: await storeForBackend(`dir:${storeDir}`),
          rotatedAt: null,
        },
      }),
      // The transfer record is not a saved copy here; there is no browse row to remove.
      removeVaultBrowseRow: () => false,
      adoptRecord: async (options) => {
        const outcome = await deps.adoptRecord(options);
        if (outcome.adopted) adoptedPath = outcome.path;
        return outcome;
      },
    };
    const result = adopted(await deps.continueHere(answer.vaultId, { expectedOwnerToken: ownerToken(answer.ownerEnvironmentId), onDrift: 'note' }, overrides));
    // The conversation now runs here: an undo would start a second runner on the owner (NFR-2),
    // so the bookkeeping below is best-effort.
    adoptedHere = true;
    try {
      // adoptRecord recorded the transfer store's tail in this machine's vault index; the real vault settles it fresh.
      if (adoptedPath) await deps.removeOwned(adoptedPath);
      if (answer.nativeSessionId) markPulledFrom(result.name, { environmentId: answer.ownerEnvironmentId, nativeSessionId: answer.nativeSessionId });
      archivePushedBack(answer.pulledFrom, self, answer.ownerEnvironmentId);
    } catch (error) {
      console.warn(`[pull] ${result.name} runs here, but its bookkeeping failed:`, error instanceof Error ? error.message : String(error));
    }

    job.step = 'finish';
    job.result = result;
    // The owner sweeps an unfinished transfer after 15 minutes, so a failed complete is not fatal.
    await deps.forward(link.environmentId, { method: 'POST', path: ownerPath(ownerName, '/release/complete'), actor: 'operator' }).catch(() => undefined);
  } catch (error) {
    if (!adoptedHere) await undo();
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** D-4650-13: the owner is unreachable, so adopt this machine's saved copy through the vault. */
async function runOffline(job: PullJob, record: LinkedConversationRecord | null, deps: PullDeps): Promise<void> {
  job.mode = 'offline';
  job.step = 'adopt';
  const vaultId = record?.row.vaultId ?? null;
  if (!vaultId || !getConversationByName(`vault-${vaultId}`)) {
    throw new PullFailure('owner-offline-no-saved-copy', 'The machine that owns this conversation is offline and this machine has no saved copy of it');
  }
  const preview = await deps.previewContinue(vaultId);
  if (preview.status !== 200) {
    const body = preview.body as { error?: string; code?: string };
    throw new PullFailure(body.code ?? 'adopt-failed', body.error ?? `Continue here answered ${preview.status}`);
  }
  const token = (preview.body as { ownerToken: string }).ownerToken;
  job.result = adopted(await deps.continueHere(vaultId, { expectedOwnerToken: token, onDrift: 'note' }));
  job.step = 'finish';
}

export type StartPullResult = { status: 202; pullId: string } | { status: 400 | 404; error: string; code: string };

/** `POST /api/linked-conversations/pull`: start a pull job; poll it with `getPull`. */
export async function startPull(
  input: { conversation: string; whenTurnRunning?: WhenTurnRunning },
  overrides: Partial<PullDeps> = {},
): Promise<StartPullResult> {
  const deps = { ...defaultDeps, ...overrides };
  pruneJobs(deps.now());
  const parsed = parseLinkedConversationName(input.conversation);
  if (!parsed) return { status: 400, error: 'Name a linked conversation as @<machine>/<name>', code: 'not-linked' };
  const link = await deps.getLink(parsed.target);
  if (!link || link.revokedAt !== null) return { status: 404, error: `No machine link named ${parsed.target}`, code: 'no-link' };
  const record = deps.getLinked(link.environmentId, parsed.name);
  if (record && !record.row.pullable) return { status: 400, error: 'Pull here works for Claude Code and Codex conversations', code: 'not-pullable' };

  const job: PullJob = {
    pullId: randomUUID(), conversation: input.conversation, step: 'release', state: 'running', mode: 'online', createdAt: deps.now(),
  };
  jobs.set(job.pullId, job);
  const run = (async () => {
    try {
      try {
        await runOnline(job, link, parsed.name, input.whenTurnRunning ?? 'wait', deps);
      } catch (error) {
        // Only a link that was offline before anything was sent: a timeout after the
        // release request left may have released the owner, so it fails instead.
        if (!(error instanceof LinkUnavailableError) || error.code !== 'machine-offline' || job.step !== 'release') throw error;
        await runOffline(job, record, deps);
      }
      job.state = 'done';
    } catch (error) {
      job.state = 'failed';
      job.code = error instanceof PullFailure ? error.code : error instanceof LinkUnavailableError ? error.code : 'pull-failed';
      job.error = (error as Error).message;
    } finally {
      running.delete(job.pullId);
    }
  })();
  running.set(job.pullId, run);
  return { status: 202, pullId: job.pullId };
}

/** `GET /api/linked-conversations/pull/:pullId`. */
export function getPull(pullId: string, now: number = Date.now()): PullJob | null {
  pruneJobs(now);
  return jobs.get(pullId) ?? null;
}

export function _resetPullJobsForTests(): void {
  jobs.clear();
  running.clear();
}

/** Test seam: resolves when the job has finished. */
export function _pullSettledForTests(pullId: string): Promise<void> {
  return running.get(pullId) ?? Promise.resolve();
}
