/** PAN-4307 WI-5: vault-settle-poller debounced, session-end and shutdown settles. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doorMocks = vi.hoisted(() => ({ removeTranscriptFile: vi.fn(), removeTranscriptTree: vi.fn() }));
vi.mock('../../../../../src/lib/cloister/transcript-deletion-door.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/lib/cloister/transcript-deletion-door.js')>();
  doorMocks.removeTranscriptFile.mockImplementation(actual.removeTranscriptFile);
  doorMocks.removeTranscriptTree.mockImplementation(actual.removeTranscriptTree);
  return doorMocks;
});

import { VAULT_CONFIG_DEFAULTS } from '../../../../../src/lib/vault/config.js';
import type { LegacyConversation } from '../../../../../src/lib/overdeck/conversations.js';
import { VAULT_POLL_MS, createVaultSettlePoller, type VaultSettlePollerDeps } from '../../../../../src/dashboard/server/services/vault-settle-poller.js';

function conv(name: string, harness: string | null = 'claude-code'): LegacyConversation {
  return { name, harness } as unknown as LegacyConversation;
}

const DEBOUNCE_SEC = 30;

function makeDeps(overrides: Partial<VaultSettlePollerDeps> = {}): { deps: VaultSettlePollerDeps; readConfig: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn> } {
  const readConfig = vi.fn().mockResolvedValue({ ...VAULT_CONFIG_DEFAULTS, exclude: { paths: [], origins: [], sessions: [] }, debounceSec: DEBOUNCE_SEC });
  const settle = vi.fn().mockResolvedValue(undefined);
  const deps: VaultSettlePollerDeps = { readConfig, settle, pollMs: VAULT_POLL_MS, ...overrides };
  return { deps, readConfig, settle };
}

describe('createVaultSettlePoller (PAN-4307 WI-5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    doorMocks.removeTranscriptFile.mockClear();
    doorMocks.removeTranscriptTree.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('growth then quiet for debounceSec settles once with wip "auto"', async () => {
    const sizes: Record<string, number> = { '/p/a.jsonl': 100 };
    const active = [conv('a')];
    const { deps, settle } = makeDeps({
      listActive: () => active,
      resolvePath: vi.fn().mockResolvedValue('/p/a.jsonl'),
      statSize: vi.fn(async (path: string) => sizes[path] ?? null),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start(); // poll #1: establishes the baseline size, no settle
    await vi.advanceTimersByTimeAsync(0);
    expect(settle).not.toHaveBeenCalled();

    sizes['/p/a.jsonl'] = 150; // grew
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS); // poll #2 detects growth, arms the debounce timer
    expect(settle).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_SEC * 1000 - 1);
    expect(settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('/p/a.jsonl', 'claude-code', 'auto');
    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    poller.stop();
  });

  it('continuous growth keeps postponing the settle until it stops growing', async () => {
    const sizes: Record<string, number> = { '/p/a.jsonl': 100 };
    const { deps, settle } = makeDeps({
      listActive: () => [conv('a')],
      resolvePath: vi.fn().mockResolvedValue('/p/a.jsonl'),
      statSize: vi.fn(async (path: string) => sizes[path] ?? null),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start(); // baseline 100
    await vi.advanceTimersByTimeAsync(0);

    sizes['/p/a.jsonl'] = 150;
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS); // grew: arm timer for +debounceSec

    sizes['/p/a.jsonl'] = 200;
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS); // grew again before the timer fired: re-armed
    expect(settle).not.toHaveBeenCalled();

    // The debounce window armed by the first growth alone would have fired here; it was
    // cleared and re-armed by the second growth, so nothing settles yet.
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS);
    expect(settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_SEC * 1000 - VAULT_POLL_MS - 1);
    expect(settle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settle).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('an unchanged size never settles', async () => {
    const { deps, settle } = makeDeps({
      listActive: () => [conv('a')],
      resolvePath: vi.fn().mockResolvedValue('/p/a.jsonl'),
      statSize: vi.fn().mockResolvedValue(100),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start();
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS * 5);
    expect(settle).not.toHaveBeenCalled();
    poller.stop();
  });

  it('a conversation that goes from active to ended is force-settled once and forgotten', async () => {
    let active = [conv('a')];
    const { deps, settle } = makeDeps({
      listActive: () => active,
      resolvePath: vi.fn().mockResolvedValue('/p/a.jsonl'),
      statSize: vi.fn().mockResolvedValue(100),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    active = [];
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('/p/a.jsonl', 'claude-code', 'force');

    // Forgotten: further polls never settle it again.
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS * 3);
    expect(settle).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('resolvePath is called once for a conversation with a resolved path across 10 polls', async () => {
    const resolvePath = vi.fn().mockResolvedValue('/p/a.jsonl');
    const { deps } = makeDeps({
      listActive: () => [conv('a')],
      resolvePath,
      statSize: vi.fn().mockResolvedValue(100),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start(); // poll #1
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS * 9); // polls #2..#10
    expect(resolvePath).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('flush cancels timers, force-settles every tracked path and respects the budget against a never-resolving settle', async () => {
    const pathA = '/p/a.jsonl';
    const pathB = '/p/b.jsonl';
    const settle = vi.fn().mockImplementation((path: string) => (path === pathA ? new Promise<void>(() => undefined) : Promise.resolve(undefined)));
    const { deps } = makeDeps({
      listActive: () => [conv('a'), conv('b')],
      resolvePath: vi.fn().mockImplementation(async (c: LegacyConversation) => (c.name === 'a' ? pathA : pathB)),
      statSize: vi.fn().mockResolvedValue(100),
      settle,
    });
    const poller = createVaultSettlePoller(deps);
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // both paths resolved and tracked

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const flushPromise = poller.flush(100);
    await vi.advanceTimersByTimeAsync(100);
    await flushPromise;

    expect(settle).toHaveBeenCalledWith(pathA, 'claude-code', 'force');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[vault\] shutdown flush skipped \d+ transcript\(s\)$/));
    expect(doorMocks.removeTranscriptFile).not.toHaveBeenCalled();
    warn.mockRestore();
    poller.stop();
  });

  it('stop() cancels the interval and every pending debounce timer', async () => {
    const sizes: Record<string, number> = { '/p/a.jsonl': 100 };
    const { deps, settle } = makeDeps({
      listActive: () => [conv('a')],
      resolvePath: vi.fn().mockResolvedValue('/p/a.jsonl'),
      statSize: vi.fn(async (path: string) => sizes[path] ?? null),
    });
    const poller = createVaultSettlePoller(deps);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    sizes['/p/a.jsonl'] = 150;
    await vi.advanceTimersByTimeAsync(VAULT_POLL_MS); // arms the debounce timer
    poller.stop();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_SEC * 1000 + VAULT_POLL_MS * 5);
    expect(settle).not.toHaveBeenCalled();
  });
});
