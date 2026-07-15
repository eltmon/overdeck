import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  capturePaneText: vi.fn(),
  deliverAgentMessage: vi.fn(),
  sendKeysAsync: vi.fn(),
}));

vi.mock('../../tmux.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../tmux.js')>(),
  capturePaneText: mocks.capturePaneText,
  sendKeysAsync: mocks.sendKeysAsync,
}));

vi.mock('../../agents.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../agents.js')>(),
  deliverAgentMessage: mocks.deliverAgentMessage,
  waitForReadySignal: vi.fn().mockResolvedValue(true),
}));

import type { LegacyConversation as Conversation } from '../conversations.js';
import { createConversation, getConversationByName } from '../conversations.js';
import { sessionFilePath } from '../../paths.js';
import * as forks from '../conversation-forks.js';

const conversation = {
  name: 'fork-conv',
  tmuxSession: 'fork-session',
  cwd: '/tmp/fork-conv',
  harness: 'codex',
} as Conversation;

describe('injectForkSummary standalone Enter recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.capturePaneText.mockReset();
    mocks.deliverAgentMessage.mockReset().mockResolvedValue(undefined);
    mocks.sendKeysAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('submits with one standalone Enter when confirmation then reports accepted', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted')
      .mockResolvedValueOnce('unknown')
      .mockResolvedValueOnce('accepted');
    mocks.capturePaneText.mockResolvedValue('summary verify line');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('submitted');

    expect(mocks.sendKeysAsync).toHaveBeenCalledOnce();
    expect(mocks.sendKeysAsync).toHaveBeenCalledWith(
      'fork-session',
      'C-m',
      'summary-fork:enter-nudge',
    );
  });

  it('treats a cleared composer as submitted while the runtime mirror lags', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('unknown');
    mocks.capturePaneText
      .mockResolvedValueOnce('summary verify line')
      .mockResolvedValueOnce('empty prompt');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('submitted');

    expect(mocks.sendKeysAsync).toHaveBeenCalledOnce();
  });

  it('does not re-deliver when unknown confirmation finds an empty prompt', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('unknown');
    mocks.capturePaneText.mockResolvedValue('empty prompt');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('submitted');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
    expect(mocks.sendKeysAsync).not.toHaveBeenCalled();
  });

  it('reports stranded when still-idle confirmation finds an empty prompt', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('still-idle');
    mocks.capturePaneText.mockResolvedValue('empty prompt');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('stranded');

    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
    expect(mocks.sendKeysAsync).not.toHaveBeenCalled();
  });

  it('returns stranded after two nudges without re-delivering onto a full composer', async () => {
    vi.spyOn(forks, 'confirmForkPromptAccepted').mockResolvedValue('unknown');
    mocks.capturePaneText.mockResolvedValue('summary verify line');

    await expect(forks.injectForkSummary(conversation, 'summary verify line', 'summary-fork'))
      .resolves.toBe('stranded');

    expect(mocks.sendKeysAsync).toHaveBeenCalledTimes(2);
    expect(mocks.deliverAgentMessage).toHaveBeenCalledOnce();
  });
});

describe('runForkPipeline stranded status', () => {
  let testHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    testHome = join(tmpdir(), `pan-2568-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.HOME = testHome;
    process.env.OVERDECK_HOME = testHome;
    mkdirSync(testHome, { recursive: true });
    const { closeOverdeckDatabaseSync } = await import('../infra.js');
    closeOverdeckDatabaseSync();
  });

  afterEach(async () => {
    const { closeOverdeckDatabaseSync } = await import('../infra.js');
    closeOverdeckDatabaseSync();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    delete process.env.OVERDECK_HOME;
    rmSync(testHome, { recursive: true, force: true });
  });

  async function runWithInjectionResult(result: 'submitted' | 'stranded') {
    const parentCwd = join(testHome, 'project');
    const parentSessionId = 'parent-session';
    const parentFile = sessionFilePath(parentCwd, parentSessionId);
    const handoffDocPath = join(testHome, 'handoff.md');
    mkdirSync(dirname(parentFile), { recursive: true });
    writeFileSync(parentFile, '{"type":"prompt"}\n');
    writeFileSync(handoffDocPath, 'summary verify line');
    createConversation({
      name: 'status-parent',
      tmuxSession: 'status-parent-session',
      cwd: parentCwd,
      claudeSessionId: parentSessionId,
      harness: 'claude-code',
    });
    createConversation({
      name: 'status-fork',
      tmuxSession: 'status-fork-session',
      cwd: parentCwd,
      harness: 'codex',
      handoffDocPath,
    });
    vi.spyOn(forks, 'ensureForkSessionReady').mockResolvedValue(undefined);
    vi.spyOn(forks, 'injectForkSummary').mockResolvedValue(result);

    await forks.runForkPipeline(
      'status-fork',
      getConversationByName('status-parent')!,
      'fork-session-id',
      undefined,
      'handoff',
    );
    return getConversationByName('status-fork')!;
  }

  it('surfaces a stranded injection as actionable failure without ending the live session', async () => {
    const fork = await runWithInjectionResult('stranded');

    expect(fork.forkStatus).toBe('failed');
    expect(fork.forkError).toContain('Open the Terminal tab and press Enter');
    expect(fork.endedAt).toBeNull();
  });

  it('clears fork status after a submitted injection', async () => {
    const fork = await runWithInjectionResult('submitted');

    expect(fork.forkStatus).toBeNull();
    expect(fork.forkError).toBeNull();
  });
});
