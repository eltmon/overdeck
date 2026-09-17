import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import * as forksModule from '../../../../../src/lib/overdeck/conversation-forks.js';
import { sessionFilePath } from '../../../../../src/lib/paths.js';

vi.mock('../../../../../src/lib/conversations/summary-fork.js', async () => {
  const { vi } = await import('vitest');
  return {
    generateSummaryForFork: vi.fn(),
    generateFallbackSummary: vi.fn(),
    reserveSummaryForkSession: vi.fn(),
    copySessionFromCompactBoundary: vi.fn(),
    requestHandoffFromAgent: vi.fn(),
    authorHandoffExternal: vi.fn(),
    handoffPreconditionFallbackReason: vi.fn(),
    handoffFailureReason: vi.fn(
      (error: unknown) =>
        `handoff failed: ${error instanceof Error ? error.message : String(error)}`,
    ),
    logHandoffFallback: vi.fn(),
    prependFallbackFocus: vi.fn((summary: string, focus: string | undefined, fallbackReason: string) => {
      if (!focus?.trim()) return summary;
      return `FOCUS:${focus}:${fallbackReason}\n${summary}`;
    }),
  };
});

const {
  authorHandoffExternal,
  generateFallbackSummary,
  generateSummaryForFork,
} = await import('../../../../../src/lib/conversations/summary-fork.js');

const { runForkPipeline, buildForkRequest, handleForkPipelineFailure } = forksModule;

describe('runForkPipeline fallback resilience', () => {
  let TEST_HOME: string;
  let ORIGINAL_HOME: string | undefined;

  beforeEach(async () => {
    ORIGINAL_HOME = process.env.HOME;
    TEST_HOME = join(
      tmpdir(),
      `pan-1802-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.HOME = TEST_HOME;
    process.env.OVERDECK_HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });

    const { closeOverdeckDatabaseSync } = await import('../../../../../src/lib/overdeck/infra.js');
    closeOverdeckDatabaseSync();
  });

  afterEach(async () => {
    const { closeOverdeckDatabaseSync } = await import('../../../../../src/lib/overdeck/infra.js');
    closeOverdeckDatabaseSync();
    if (ORIGINAL_HOME !== undefined) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    delete process.env.OVERDECK_HOME;
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createParentAndFork() {
    const { createConversation, getConversationByName } = await import(
      '../../../../../src/lib/overdeck/conversations.js'
    );

    const parentCwd = join(TEST_HOME, 'parent-project');
    const claudeSessionId = 'parent-session-uuid';
    const parentFile = sessionFilePath(parentCwd, claudeSessionId);
    mkdirSync(dirname(parentFile), { recursive: true });
    writeFileSync(parentFile, '{"type":"prompt"}\n');

    createConversation({
      name: 'parent-conv',
      tmuxSession: 'parent-sess',
      cwd: parentCwd,
      claudeSessionId,
      harness: 'claude-code',
    });
    createConversation({
      name: 'fork-conv',
      tmuxSession: 'fork-sess',
      cwd: parentCwd,
      harness: 'claude-code',
    });

    const parentConv = getConversationByName('parent-conv')!;
    return { parentConv, parentFile };
  }

  function stubSpawnAndInject() {
    return {
      ensureSpy: vi
        .spyOn(forksModule, 'ensureForkSessionReady')
        .mockResolvedValue(undefined),
      injectSpy: vi
        .spyOn(forksModule, 'injectForkSummary')
        .mockResolvedValue(undefined),
    };
  }

  it('spawns with heuristic fallback when handoff and LLM summary both overflow', async () => {
    const { parentConv } = await createParentAndFork();
    const overflow = new Error(
      'Summary generation failed: {"result":"Prompt is too long","terminal_reason":"blocking_limit"}',
    );
    vi.mocked(authorHandoffExternal).mockRejectedValue(overflow);
    vi.mocked(generateSummaryForFork).mockRejectedValue(overflow);
    vi.mocked(generateFallbackSummary).mockImplementation(() =>
      Effect.succeed('heuristic summary'),
    );
    const { ensureSpy, injectSpy } = stubSpawnAndInject();

    await expect(
      runForkPipeline(
        'fork-conv',
        parentConv,
        'session-id',
        undefined,
        'handoff',
        false,
        undefined,
        undefined,
        'focus text',
        'external',
      ),
    ).resolves.toBeUndefined();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledTimes(1);
    const injectedSummary = injectSpy.mock.calls[0][1] as string;
    expect(injectedSummary).toContain('focus text');
    expect(injectedSummary).toContain('heuristic summary');
  });

  it('spawns with focus-only seed when heuristic fallback also fails', async () => {
    const { parentConv } = await createParentAndFork();
    const overflow = new Error(
      'Summary generation failed: {"result":"Prompt is too long","terminal_reason":"blocking_limit"}',
    );
    vi.mocked(authorHandoffExternal).mockRejectedValue(overflow);
    vi.mocked(generateSummaryForFork).mockRejectedValue(overflow);
    vi.mocked(generateFallbackSummary).mockImplementation(() =>
      Effect.fail(new Error('fallback failed')),
    );
    const { ensureSpy, injectSpy } = stubSpawnAndInject();

    await expect(
      runForkPipeline(
        'fork-conv',
        parentConv,
        'session-id',
        undefined,
        'handoff',
        false,
        undefined,
        undefined,
        'focus text',
        'external',
      ),
    ).resolves.toBeUndefined();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledTimes(1);
    const injectedSummary = injectSpy.mock.calls[0][1] as string;
    expect(injectedSummary).toContain('focus text');
    expect(injectedSummary).not.toContain('heuristic summary');
  });

  it('persists forkFallbackReason after a fallback', async () => {
    const { parentConv } = await createParentAndFork();
    const overflow = new Error(
      'Summary generation failed: {"result":"Prompt is too long","terminal_reason":"blocking_limit"}',
    );
    vi.mocked(authorHandoffExternal).mockRejectedValue(overflow);
    vi.mocked(generateSummaryForFork).mockRejectedValue(overflow);
    vi.mocked(generateFallbackSummary).mockImplementation(() =>
      Effect.succeed('heuristic summary'),
    );
    stubSpawnAndInject();

    await runForkPipeline(
      'fork-conv',
      parentConv,
      'session-id',
      undefined,
      'handoff',
      false,
      undefined,
      undefined,
      'focus text',
      'external',
    );

    const { getConversationByName } = await import(
      '../../../../../src/lib/overdeck/conversations.js'
    );
    const fork = getConversationByName('fork-conv')!;
    expect(fork.forkFallbackReason).toBeTruthy();
  });
});

describe('runForkPipeline spawn-pending window (PAN-3860)', () => {
  let TEST_HOME: string;
  let ORIGINAL_HOME: string | undefined;

  beforeEach(async () => {
    ORIGINAL_HOME = process.env.HOME;
    TEST_HOME = join(
      tmpdir(),
      `pan-3860-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.HOME = TEST_HOME;
    process.env.OVERDECK_HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });

    const { closeOverdeckDatabaseSync } = await import('../../../../../src/lib/overdeck/infra.js');
    closeOverdeckDatabaseSync();
  });

  afterEach(async () => {
    const { closeOverdeckDatabaseSync } = await import('../../../../../src/lib/overdeck/infra.js');
    closeOverdeckDatabaseSync();
    if (ORIGINAL_HOME !== undefined) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    delete process.env.OVERDECK_HOME;
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function createParentAndForkForSpawnPendingWindow() {
    const { createConversation, getConversationByName } = await import(
      '../../../../../src/lib/overdeck/conversations.js'
    );

    const parentCwd = join(TEST_HOME, 'parent-project');
    const claudeSessionId = 'parent-session-uuid';
    const parentFile = sessionFilePath(parentCwd, claudeSessionId);
    mkdirSync(dirname(parentFile), { recursive: true });
    writeFileSync(parentFile, '{"type":"prompt"}\n');

    createConversation({
      name: 'parent-conv',
      tmuxSession: 'parent-sess',
      cwd: parentCwd,
      claudeSessionId,
      harness: 'claude-code',
    });
    createConversation({
      name: 'fork-conv',
      tmuxSession: 'fork-sess',
      cwd: parentCwd,
      harness: 'claude-code',
      forkStatus: 'handoff',
    });

    const parentConv = getConversationByName('parent-conv')!;
    return { parentConv };
  }

  it('spawns and clears forkStatus once external authoring completes, no matter how long it ran', async () => {
    const { parentConv } = await createParentAndForkForSpawnPendingWindow();

    // PAN-3860 incident: pre-compacting + authoring a >1M-char transcript took
    // well over SPAWN_GRACE_PERIOD_MS (30s) — real wall-clock minutes. The
    // pipeline itself has no time-awareness: it simply awaits authoring, then
    // spawns. This is proven here with a deferred (not instantaneous) promise
    // so the pipeline can't be accidentally relying on synchronous resolution.
    // The actual grace-window arithmetic that must NOT fire while this is in
    // flight is the conversation-lifecycle sweeper's job — see the fake-timer
    // "does NOT mark ended while a fork/handoff pipeline is in flight" cases
    // in conversation-lifecycle.test.ts, which directly exercise
    // SPAWN_GRACE_PERIOD_MS. (A single test driving both the sweeper's poll
    // loop and this DB-backed pipeline under one fake-timer clock was
    // attempted and deadlocked on real I/O scheduling; splitting the coverage
    // across the two suites keeps both reliable.)
    let resolveAuthoring!: (value: { docText: string; docPath: string }) => void;
    vi.mocked(authorHandoffExternal).mockImplementation(
      () => new Promise((resolve) => { resolveAuthoring = resolve; }),
    );
    const ensureSpy = vi.spyOn(forksModule, 'ensureForkSessionReady').mockResolvedValue(undefined);
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary').mockResolvedValue('submitted');

    const pipeline = runForkPipeline(
      'fork-conv',
      parentConv,
      'session-id',
      undefined,
      'handoff',
      false,
      undefined,
      undefined,
      'focus text',
      'external',
    );
    // Give the pipeline a chance to reach (and block on) the authoring call
    // before resolving it, so this genuinely exercises "spawn happens after
    // authoring finishes" rather than a same-tick resolution.
    await new Promise((r) => setTimeout(r, 10));
    expect(ensureSpy).not.toHaveBeenCalled();
    resolveAuthoring({ docText: '# Handoff\n\n## Suggested skills\n\nnone', docPath: '/tmp/handoff.md' });
    await expect(pipeline).resolves.toBeUndefined();

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).toHaveBeenCalledTimes(1);

    const { getConversationByName } = await import(
      '../../../../../src/lib/overdeck/conversations.js'
    );
    const fork = getConversationByName('fork-conv')!;
    expect(fork.status).toBe('active');
    expect(fork.forkStatus).toBeNull();
  });

  it('leaves the row ended with a reason, and never spawns, when the spawn step fails', async () => {
    const { parentConv } = await createParentAndForkForSpawnPendingWindow();

    vi.mocked(authorHandoffExternal).mockResolvedValue({
      docText: '# Handoff\n\n## Suggested skills\n\nnone',
      docPath: '/tmp/handoff.md',
    });
    const spawnError = new Error('Timed out waiting for tmux session conv-fork-sess');
    const ensureSpy = vi.spyOn(forksModule, 'ensureForkSessionReady').mockRejectedValue(spawnError);
    const injectSpy = vi.spyOn(forksModule, 'injectForkSummary');

    await runForkPipeline(
      'fork-conv',
      parentConv,
      'session-id',
      undefined,
      'handoff',
      false,
      undefined,
      undefined,
      'focus text',
      'external',
    ).catch((err) => handleForkPipelineFailure('fork-conv', err));

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(injectSpy).not.toHaveBeenCalled();

    const { getConversationByName } = await import(
      '../../../../../src/lib/overdeck/conversations.js'
    );
    const fork = getConversationByName('fork-conv')!;
    expect(fork.status).toBe('ended');
    expect(fork.forkStatus).toBe('failed');
    expect(fork.forkError).toBe('Timed out waiting for tmux session conv-fork-sess');
  });
});

describe('buildForkRequest', () => {
  it('carries an explicit issueId when provided', () => {
    const req = buildForkRequest({
      parentConversationName: 'parent',
      sessionId: 'session-uuid',
      forkMode: 'handoff',
      issueId: 'PAN-2602',
    });
    expect(req.issueId).toBe('PAN-2602');
  });

  it('omits issueId when not provided', () => {
    const req = buildForkRequest({
      parentConversationName: 'parent',
      sessionId: 'session-uuid',
      forkMode: 'summary',
    });
    expect(req.issueId).toBeUndefined();
  });
});
