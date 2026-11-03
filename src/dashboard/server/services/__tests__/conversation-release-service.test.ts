/**
 * PAN-4650 WI-9: the owner's release — waits for or stops a running turn, marks
 * released_to, settles with WIP into a fresh transfer store, stops the harness,
 * undoes itself on failure, and answers only the machine it releases to.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setupOverdeckTestDb, teardownOverdeckTestDb, type OverdeckTestDb } from '../../../../../tests/helpers/overdeck-test-db.js';
import { MACHINE_TOKEN_SCOPES } from '../../../../lib/access-tokens.js';
import { LinkUnavailableError } from '../../../../lib/anywhere/link-client.js';
import { markConversationReleased } from '../../../../lib/overdeck/conversation-release.js';
import { createConversation, getConversationByName, setConversationClaudeSessionId, updateConversationTitle } from '../../../../lib/overdeck/conversations.js';
import type { SettleOptions, SettleResult } from '../../../../lib/vault/settle.js';
import type { DashboardCredential } from '../../routes/dashboard-auth.js';
import { handleRelease, handleReleaseComplete, handleReleaseUndo } from '../../routes/conversation-pull.js';
import {
  PULL_TRANSFERS_DIRNAME,
  readTransferPack,
  reclaimRelease,
  sweepTransfers,
  TRANSFER_TTL_MS,
  TURN_WAIT_MAX_MS,
  type ReleaseServiceDeps,
} from '../conversation-release-service.js';

const VIEWER = 'env-laptop';
const NAME = 'conv-desk';

function machine(environmentId = VIEWER, actor: 'operator' | { agentId: string } = 'operator'): DashboardCredential {
  return { kind: 'machine', tokenId: 't', environmentId, scopes: MACHINE_TOKEN_SCOPES('operator'), actor, access: 'operator' };
}

let odb: OverdeckTestDb;
let transcript: string;
let settleCalls: SettleOptions[];
let deps: Partial<ReleaseServiceDeps> & {
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
};

function fakeDeps(overrides: Partial<ReleaseServiceDeps> = {}) {
  return {
    isWorking: async () => false,
    abort: vi.fn(async () => ({ status: 200 })),
    stop: vi.fn(async () => ({ status: 200 })),
    resume: vi.fn(async () => ({ status: 200 })),
    harnessAlive: async () => true,
    resolvePath: async () => transcript,
    settle: async (options: SettleOptions): Promise<SettleResult> => {
      settleCalls.push(options);
      return { verdict: 'append', vaultId: 'vault-1', chunks: ['c1'], lines: 3, version: 1 };
    },
    environmentId: async () => 'env-desk',
    ...overrides,
  };
}

beforeEach(async () => {
  odb = setupOverdeckTestDb();
  transcript = join(odb.home, 'session.jsonl');
  await writeFile(transcript, '{"type":"user"}\n');
  settleCalls = [];
  createConversation({ name: NAME, tmuxSession: `conv-${NAME}`, cwd: odb.home, harness: 'claude-code' });
  deps = fakeDeps();
}, 15_000);

afterEach(() => {
  vi.useRealTimers();
  teardownOverdeckTestDb(odb);
});

describe('owner release (PAN-4650 WI-9)', () => {
  it('ac2: an idle conversation is marked, settled with WIP, stopped and handed a transfer id', async () => {
    const { status, body } = await handleRelease(machine(), NAME, { to: VIEWER }, deps);

    expect(status).toBe(200);
    expect(body).toMatchObject({ vaultId: 'vault-1', ownerEnvironmentId: 'env-desk', harness: 'claude-code' });
    expect(body.keyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(getConversationByName(NAME)?.releasedTo).toBe(VIEWER);
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0]).toMatchObject({ nativePath: transcript, harness: 'claude-code', wip: 'force' });
    expect(settleCalls[0]!.index).toBeDefined();
    expect(deps.stop).toHaveBeenCalledWith(NAME);
    const pack = await readTransferPack(NAME, body.transferId as string, deps);
    expect(pack?.length).toBe(body.bytes);
  });

  it('ac1 (PAN-4904): passes the owner conversation title as recordTitle', async () => {
    updateConversationTitle(NAME, 'Add a --json flag that prints the counts as JSON, and a test for it.');
    await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect(settleCalls[0]!.recordTitle).toBe('Add a --json flag that prints the counts as JSON, and a test for it.');
  });

  it('ac2 (PAN-4904): an untitled owner conversation settles without a recordTitle', async () => {
    await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect('recordTitle' in settleCalls[0]!).toBe(false);
  });

  it("'stop' aborts a running turn first", async () => {
    deps = fakeDeps({ isWorking: async () => true });
    const { status } = await handleRelease(machine(), NAME, { to: VIEWER, whenTurnRunning: 'stop' }, deps);
    expect(status).toBe(200);
    expect(deps.abort).toHaveBeenCalledWith(NAME);
    expect(deps.abort.mock.invocationCallOrder[0]!).toBeLessThan(deps.stop.mock.invocationCallOrder[0]!);
  });

  it("'wait' polls a running turn and proceeds when it ends", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const isWorking = vi.fn(async () => Date.now() - start < 6_000);
    deps = fakeDeps({ isWorking });
    const result = handleRelease(machine(), NAME, { to: VIEWER, whenTurnRunning: 'wait' }, deps);
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await result).status).toBe(200);
    expect(isWorking.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(deps.abort).not.toHaveBeenCalled();
  });

  it("ac3: 'wait' past 30 minutes answers 409 turn-still-running and stays unreleased", async () => {
    vi.useFakeTimers();
    deps = fakeDeps({ isWorking: async () => true });
    const result = handleRelease(machine(), NAME, { to: VIEWER, whenTurnRunning: 'wait' }, deps);
    await vi.advanceTimersByTimeAsync(TURN_WAIT_MAX_MS + 2_000);
    expect(await result).toEqual({ status: 409, body: expect.objectContaining({ code: 'turn-still-running' }) });
    expect(getConversationByName(NAME)?.releasedTo).toBeNull();
    expect(settleCalls).toHaveLength(0);
  });

  it('ac4: a settle failure after marking clears released_to and answers 500 release-failed', async () => {
    deps = fakeDeps({ settle: async () => { throw new Error('disk full'); } });
    const { status, body } = await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect(status).toBe(500);
    expect(body).toMatchObject({ code: 'release-failed', detail: 'disk full' });
    expect(getConversationByName(NAME)?.releasedTo).toBeNull();
    expect(deps.stop).not.toHaveBeenCalled();
    expect(existsSync(join(odb.home, PULL_TRANSFERS_DIRNAME))).toBe(true);
  });

  it('refuses a blocked secret scan the same way', async () => {
    deps = fakeDeps({ settle: async () => ({ verdict: 'blocked', vaultId: 'v', hits: [{ line: 1, pattern: 'aws' } as never] }) });
    const { status, body } = await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect(status).toBe(500);
    expect(body.detail).toMatch(/secret scan/);
    expect(getConversationByName(NAME)?.releasedTo).toBeNull();
  });

  it('ac5: refuses a release to another machine than the caller, an agent actor, and a non-machine credential', async () => {
    expect((await handleRelease(machine(), NAME, { to: 'env-other' }, deps)).status).toBe(403);
    expect((await handleRelease(machine(VIEWER, { agentId: 'agent-pan-1' }), NAME, { to: VIEWER }, deps)).status).toBe(403);
    expect((await handleRelease({ kind: 'root-session' }, NAME, { to: VIEWER }, deps)).status).toBe(403);
    expect(getConversationByName(NAME)?.releasedTo).toBeNull();
  });

  it('refuses a second release, and a harness Pull here cannot resume', async () => {
    await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect(await handleRelease(machine(), NAME, { to: VIEWER }, deps)).toMatchObject({ status: 409, body: { code: 'conversation-released' } });
    createConversation({ name: 'conv-pi', tmuxSession: 'conv-conv-pi', cwd: odb.home, harness: 'pi' });
    expect(await handleRelease(machine(), 'conv-pi', { to: VIEWER }, deps)).toMatchObject({ status: 400, body: { code: 'not-pullable' } });
  });

  it('undo clears the release, drops the transfer and resumes a harness that was running', async () => {
    const released = await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect((await handleReleaseUndo(machine('env-other'), NAME, deps)).status).toBe(403);

    expect(await handleReleaseUndo(machine(), NAME, deps)).toEqual({ status: 200, body: { ok: true, resumed: true } });
    expect(getConversationByName(NAME)?.releasedTo).toBeNull();
    expect(deps.resume).toHaveBeenCalledWith(NAME);
    expect(await readTransferPack(NAME, released.body.transferId as string, deps)).toBeNull();
    expect((await handleReleaseUndo(machine(), NAME, deps)).body).toMatchObject({ code: 'not-released' });
  });

  it('complete drops the transfer and keeps released_to', async () => {
    const released = await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect((await handleReleaseComplete(machine(), NAME, deps)).status).toBe(200);
    expect(getConversationByName(NAME)?.releasedTo).toBe(VIEWER);
    expect(await readTransferPack(NAME, released.body.transferId as string, deps)).toBeNull();
  });

  it('the sweep deletes transfers older than 15 minutes only', async () => {
    let now = Date.now();
    deps = fakeDeps({ now: () => now });
    const released = await handleRelease(machine(), NAME, { to: VIEWER }, deps);
    expect(await sweepTransfers(deps)).toBe(0);
    now += TRANSFER_TTL_MS;
    expect(await sweepTransfers(deps)).toBe(1);
    expect(await readTransferPack(NAME, released.body.transferId as string, deps)).toBeNull();
  });

  describe('reclaim (D-4650-10)', () => {
    function sharedRow(overrides: Record<string, unknown>) {
      return {
        name: 'conv-y', title: null, nativeSessionId: 's-new', harness: 'claude-code', model: null, status: 'active', sessionAlive: true,
        isWorking: false, lastActivityAt: null, projectKey: null, gitOrigin: null, cwd: null, issueId: null, tmuxSession: null,
        releasedTo: null, createdAt: '2026-11-01T10:00:00.000Z', pullable: true, vaultId: null, pulledFrom: null, ...overrides,
      };
    }
    const shared = (rows: unknown[]) => async () => ({ status: 200, json: { environmentId: VIEWER, sharing: true, hash: 'h', rows } });

    beforeEach(() => {
      setConversationClaudeSessionId(NAME, 's-desk');
      markConversationReleased(NAME, VIEWER);
    });

    it('ac3: refuses still-running-there when the target runs the pulled copy, and keeps released_to', async () => {
      const result = await reclaimRelease(NAME, { force: false }, fakeDeps({
        fetchShared: shared([sharedRow({ pulledFrom: { environmentId: 'env-desk', nativeSessionId: 's-desk' } })]),
      }));
      expect(result).toMatchObject({ status: 409, body: { code: 'still-running-there', remoteName: 'conv-y' } });
      expect(getConversationByName(NAME)?.releasedTo).toBe(VIEWER);
    });

    it('ac4: refuses target-offline without force and clears released_to with force', async () => {
      const offline = fakeDeps({ fetchShared: async () => { throw new LinkUnavailableError('machine-offline', 'laptop is offline'); } });
      expect(await reclaimRelease(NAME, { force: false }, offline)).toMatchObject({ status: 409, body: { code: 'target-offline' } });
      expect(getConversationByName(NAME)?.releasedTo).toBe(VIEWER);
      expect(await reclaimRelease(NAME, { force: true }, offline)).toEqual({ status: 200, body: { ok: true } });
      expect(getConversationByName(NAME)?.releasedTo).toBeNull();
    });

    it('reclaims when the target lists it ended or not at all', async () => {
      const result = await reclaimRelease(NAME, { force: false }, fakeDeps({
        fetchShared: shared([sharedRow({ sessionAlive: false, pulledFrom: { environmentId: 'env-desk', nativeSessionId: 's-desk' } }), sharedRow({ name: 'other' })]),
      }));
      expect(result.status).toBe(200);
      expect(getConversationByName(NAME)?.releasedTo).toBeNull();
    });
  });
});
