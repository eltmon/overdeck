import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Effect } from 'effect';
import * as conversationsModule from '../../../../../src/dashboard/server/routes/conversations.js';
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

const { runForkPipeline } = conversationsModule;

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
    process.env.PANOPTICON_HOME = TEST_HOME;
    mkdirSync(TEST_HOME, { recursive: true });

    const { resetDatabase } = await import('../../../../../src/lib/database/index.js');
    resetDatabase();
  });

  afterEach(async () => {
    const { resetDatabase } = await import('../../../../../src/lib/database/index.js');
    resetDatabase();
    if (ORIGINAL_HOME !== undefined) {
      process.env.HOME = ORIGINAL_HOME;
    } else {
      delete process.env.HOME;
    }
    delete process.env.PANOPTICON_HOME;
    rmSync(TEST_HOME, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function createParentAndFork() {
    const { createConversation, getConversationByName } = await import(
      '../../../../../src/lib/database/conversations-db.js'
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
        .spyOn(conversationsModule, 'ensureForkSessionReady')
        .mockResolvedValue(undefined),
      injectSpy: vi
        .spyOn(conversationsModule, 'injectForkSummary')
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
      '../../../../../src/lib/database/conversations-db.js'
    );
    const fork = getConversationByName('fork-conv')!;
    expect(fork.forkFallbackReason).toBeTruthy();
  });
});
