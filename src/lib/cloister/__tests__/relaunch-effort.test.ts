/**
 * PAN-4253: session rotation and crash respawn must pass the persisted
 * effort through to runtime.spawnAgent.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';

vi.mock('../../runtimes/index.js', () => ({
  getRuntimeForAgent: vi.fn(),
}));

const agentStateMock = vi.hoisted(() => vi.fn());
const saveAgentStateSyncMock = vi.hoisted(() => vi.fn());
const spawnAgentMock = vi.hoisted(() => vi.fn());
const stopAgentMock = vi.hoisted(() => vi.fn());

vi.mock('../../agents.js', () => ({
  getAgentState: agentStateMock,
  saveAgentStateSync: saveAgentStateSyncMock,
  getAgentRuntimeStateSync: vi.fn(() => ({ state: 'idle' })),
  spawnAgent: spawnAgentMock,
  spawnRun: vi.fn(),
  stopAgent: stopAgentMock,
  getAgentDir: vi.fn((id: string) => `/tmp/${id}`),
}));

vi.mock('../handoff-context.js', () => ({
  captureHandoffContext: vi.fn(async () => ({})),
  buildHandoffPrompt: vi.fn(() => 'handoff prompt'),
}));

vi.mock('../specialists.js', () => ({
  getTmuxSessionName: vi.fn((name: string) => `specialist-${name}`),
}));

vi.mock('../../tmux.js', () => ({
  killSession: vi.fn(() => Promise.resolve()),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
}));

const execMock = vi.hoisted(() => vi.fn<[string, any?], string>().mockReturnValue(''));

vi.mock('child_process', () => {
  const kCustom = Symbol.for('nodejs.util.promisify.custom');
  function exec(cmd: string, optionsOrCb: any, maybeCallback?: any) {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : maybeCallback;
    const options = typeof optionsOrCb === 'function' ? undefined : optionsOrCb;
    try {
      const result = execMock(cmd, options);
      callback(null, result, '');
    } catch (err) {
      callback(err, '', '');
    }
  }
  (exec as any)[kCustom] = (cmd: string, options?: any) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      try {
        const result = execMock(cmd, options);
        resolve({ stdout: result ?? '', stderr: '' });
      } catch (err) {
        reject(err);
      }
    });
  return { exec };
});

import { getRuntimeForAgent } from '../../runtimes/index.js';
import { rotateSpecialistSession } from '../session-rotation.js';
import { restartAgent } from '../service-crash.js';
import { performHandoff } from '../handoff.js';

const mockGetRuntimeForAgent = vi.mocked(getRuntimeForAgent);

describe('relaunch effort propagation to runtime.spawnAgent (PAN-4253)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execMock.mockReturnValue('');
  });

  it('rotateSpecialistSession passes the persisted effort to runtime.spawnAgent', async () => {
    const mockRuntime = {
      name: 'test-runtime',
      getTokenUsage: () => ({ inputTokens: 120000, outputTokens: 30000 }),
      spawnAgent: vi.fn().mockReturnValue({ sessionId: 'new-session-123' }),
    };
    mockGetRuntimeForAgent.mockReturnValue(mockRuntime as any);
    agentStateMock.mockReturnValue({
      sessionId: 'old-session-456',
      workspace: '/tmp/workspace',
      effort: 'max',
      effortSource: 'explicit',
    });

    const result = await rotateSpecialistSession('merge-agent', '/tmp/workspace');

    expect(result.success).toBe(true);
    expect(mockRuntime.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'max', effortSource: 'explicit' }),
    );
  });

  it('service-crash restartAgent passes the persisted effort to runtime.spawnAgent', async () => {
    const mockRuntime = {
      name: 'claude-code',
      spawnAgent: vi.fn().mockReturnValue({ sessionId: 'resumed-session' }),
    };
    mockGetRuntimeForAgent.mockReturnValue(mockRuntime as any);
    agentStateMock.mockReturnValue({
      id: 'agent-crash-respawn',
      sessionId: 'session-abc',
      workspace: '/tmp/workspace',
      effort: 'max',
      effortSource: 'explicit',
    });

    await restartAgent({} as any, 'agent-crash-respawn');

    expect(mockRuntime.spawnAgent).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'max', effortSource: 'explicit' }),
    );
  });

  it('performHandoff passes the persisted effort to spawnAgent', async () => {
    agentStateMock.mockReturnValue({
      id: 'agent-handoff',
      issueId: 'PAN-4253',
      workspace: '/tmp/workspace',
      harness: 'claude-code',
      role: 'work',
      model: 'claude-sonnet-5',
      effort: 'max',
      effortSource: 'explicit',
    });
    spawnAgentMock.mockResolvedValue({ id: 'agent-handoff', costSoFar: 0 });
    stopAgentMock.mockReturnValue(Effect.succeed(undefined));

    const result = await performHandoff('agent-handoff', {
      targetModel: 'claude-opus-5-5',
      reason: 'test handoff',
      waitForIdle: false,
    });

    expect(result.success).toBe(true);
    expect(spawnAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'max', effortSource: 'explicit' }),
    );
  });
});
