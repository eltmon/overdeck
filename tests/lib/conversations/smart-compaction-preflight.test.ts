import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeTooOldError } from '../../../src/lib/claude-code/requirements.js';

// PAN-5124 FR-5: smart-compaction summaries run the same Claude Code
// minimum-version check a launch does, and spawn the binary it validated.
// A separate file so these module mocks never leak into smart-compaction.test.ts.

const { spawnMock, prepareHarnessLaunchMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  prepareHarnessLaunchMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

vi.mock('../../../src/lib/agents.js', () => ({
  buildSpawnEnvForModel: async () => ({}),
  getProviderEnvForModel: async () => ({}),
}));

vi.mock('../../../src/lib/harness-binary.js', () => ({
  prepareHarnessLaunch: prepareHarnessLaunchMock,
}));

vi.mock('../../../src/lib/background-ai/cost.js', () => ({
  recordBackgroundAiCost: () => 0,
}));

import { runModelSummary } from '../../../src/lib/conversations/smart-compaction.js';

function fakeChild(stdout: string): EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void } {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
  setImmediate(() => {
    child.stdout.end(stdout);
    child.stdout.on('end', () => child.emit('close', 0));
  });
  return child;
}

describe('smart-compaction Claude Code preflight (PAN-5124)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    prepareHarnessLaunchMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('refuses a too-old Claude Code with the upgrade message before any spawn', async () => {
    const error = new ClaudeCodeTooOldError({
      model: 'claude-haiku-5-5',
      displayName: 'Claude Haiku 5.5',
      installed: '2.1.280',
      required: '2.1.293',
      binaryPath: '/usr/local/bin/claude',
      upgradeCommand: 'npm i -g @anthropic-ai/claude-code@latest',
    });
    prepareHarnessLaunchMock.mockRejectedValue(error);

    await expect(runModelSummary('prompt', 'claude-haiku-5-5')).rejects.toThrow(error.message);
    expect(prepareHarnessLaunchMock).toHaveBeenCalledWith('claude-code', { model: 'claude-haiku-5-5' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the binary path the preflight validated', async () => {
    prepareHarnessLaunchMock.mockResolvedValue({ binaryPath: '/opt/claude/bin/claude', pathExport: '' });
    spawnMock.mockImplementation(() => fakeChild('{"result":"the summary"}'));

    await expect(runModelSummary('prompt', 'claude-haiku-5-5')).resolves.toBe('the summary');
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][0]).toBe('/opt/claude/bin/claude');
  });

  it('leaves the rpc-fifo (pi) path alone: no Claude Code preflight', async () => {
    spawnMock.mockImplementation(() => fakeChild('pi summary'));

    await expect(runModelSummary('prompt', 'claude-haiku-5-5', undefined, 'pi')).resolves.toBe('pi summary');
    expect(prepareHarnessLaunchMock).not.toHaveBeenCalled();
    expect(spawnMock.mock.calls[0][0]).toBe('omp');
  });
});
