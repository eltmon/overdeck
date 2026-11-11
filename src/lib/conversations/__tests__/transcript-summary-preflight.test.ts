import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClaudeCodeTooOldError } from '../../claude-code/requirements.js';

// PAN-5124 FR-5: title-family background calls run the same Claude Code
// minimum-version check a launch does, and spawn the binary it validated.

const { spawnMock, prepareHarnessLaunchMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  prepareHarnessLaunchMock: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

vi.mock('../../agents.js', () => ({
  getProviderEnvForModel: async () => ({}),
}));

vi.mock('../../harness-binary.js', () => ({
  prepareHarnessLaunch: prepareHarnessLaunchMock,
}));

vi.mock('../../background-ai/cost.js', () => ({
  recordBackgroundAiCost: () => 0,
}));

import { summarizeFirstMessageTitle } from '../transcript-summary.js';

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

const tooOld = (): ClaudeCodeTooOldError => new ClaudeCodeTooOldError({
  model: 'claude-haiku-5-5',
  displayName: 'Claude Haiku 5.5',
  installed: '2.1.280',
  required: '2.1.293',
  binaryPath: '/usr/local/bin/claude',
  upgradeCommand: 'npm i -g @anthropic-ai/claude-code@latest',
});

describe('title-family Claude Code preflight (PAN-5124)', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    prepareHarnessLaunchMock.mockReset();
  });

  it('refuses a too-old Claude Code with the upgrade message before any spawn', async () => {
    const error = tooOld();
    prepareHarnessLaunchMock.mockRejectedValue(error);

    await expect(summarizeFirstMessageTitle('fix the bug', 'claude-haiku-5-5')).rejects.toThrow('needs Claude Code 2.1.293 or newer');
    expect(prepareHarnessLaunchMock).toHaveBeenCalledWith('claude-code', { model: 'claude-haiku-5-5' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('propagates ClaudeCodeTooOldError unchanged and never retries on another model', async () => {
    const error = tooOld();
    prepareHarnessLaunchMock.mockRejectedValue(error);

    await expect(summarizeFirstMessageTitle('fix the bug', 'claude-haiku-5-5')).rejects.toBe(error);
    expect(prepareHarnessLaunchMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns the binary path the preflight validated', async () => {
    prepareHarnessLaunchMock.mockResolvedValue({ binaryPath: '/opt/claude/bin/claude', pathExport: '' });
    spawnMock.mockImplementation(() => fakeChild('{"structured_output":{"title":"x"}}'));

    await expect(summarizeFirstMessageTitle('fix the bug', 'claude-haiku-5-5')).resolves.toBe('x');
    expect(spawnMock).toHaveBeenCalledOnce();
    expect(spawnMock.mock.calls[0][0]).toBe('/opt/claude/bin/claude');
  });
});
