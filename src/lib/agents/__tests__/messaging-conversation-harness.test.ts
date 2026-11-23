/**
 * PAN-4223 FR-17: `messageAgent('conv-<name>')` reads the conversation row by
 * its bare name, so a codex conversation is probed as codex. Before the fix
 * the lookup used the prefixed id, found no row, and fell back to claude-code.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const stateDir = mkdtempSync(join(tmpdir(), 'messaging-conv-harness-'));

const probe = vi.hoisted(() => ({ harness: undefined as string | undefined, lookups: [] as string[] }));

vi.mock('../../paths.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get AGENTS_DIR() {
    return stateDir;
  },
}));

vi.mock('../../overdeck/conversations.js', () => ({
  getConversationByName: (name: string) => {
    probe.lookups.push(name);
    if (name === 'brisk-otter') return { name, harness: 'codex' };
    if (name === 'conv-flywheel') return { name, harness: 'pi' };
    return null;
  },
}));

vi.mock('../runtime-command.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCodexAppServerStatus: vi.fn(async () => { throw new Error('no app-server'); }),
}));

vi.mock('../../remote/remote-agents.js', () => ({
  loadRemoteAgentState: () => null,
  sendToRemoteAgent: vi.fn(),
}));

vi.mock('../liveness.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isAlive: vi.fn(async (_id: string, opts?: { readHarness?: () => string }) => {
    probe.harness = opts?.readHarness?.();
    return { alive: false, reason: 'no-session' };
  }),
}));

const { messageAgent } = await import('../messaging.js');

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe('messageAgent conversation harness (PAN-4223 FR-17)', () => {
  beforeEach(() => {
    probe.lookups.length = 0;
  });

  it('probes a conv-<name> target with the harness its row declares', async () => {
    await expect(messageAgent('conv-brisk-otter', 'hello', 'pan-tell')).rejects.toThrow('not running');
    expect(probe.lookups).toEqual(['brisk-otter']);
    expect(probe.harness).toBe('codex');
  });

  it('probes the Flywheel by its full row name, conv-flywheel (PAN-5615)', async () => {
    await expect(messageAgent('conv-flywheel', 'hello', 'pan-tell')).rejects.toThrow('not running');
    expect(probe.lookups).toEqual(['flywheel', 'conv-flywheel']);
    expect(probe.harness).toBe('pi');
  });
});
