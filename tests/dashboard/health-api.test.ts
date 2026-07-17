/**
 * Integration tests for the dashboard agent-health resolver adapter.
 */

import { Effect } from 'effect';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentRuntimeSnapshot } from '@overdeck/contracts';

const { activeSessions } = vi.hoisted(() => ({
  activeSessions: new Set<string>(),
}));

vi.mock('../../src/lib/tmux.js', () => ({
  sessionExists: (name: string) => Effect.succeed(activeSessions.has(name)),
  sessionExistsSync: (name: string) => Effect.succeed(activeSessions.has(name)),
  capturePane: vi.fn(() => Effect.succeed('')),
  getTmuxConfigMode: vi.fn(() => 'inherit-user'),
  getManagedTmuxSocketName: vi.fn(() => 'overdeck'),
  getManagedTmuxConfigPath: vi.fn(() => '/tmp/overdeck.tmux.conf'),
  getTmuxBaseArgs: vi.fn(() => []),
  buildTmuxArgs: vi.fn((args: string[]) => args),
  getTmuxCommand: vi.fn((args: string[]) => ({ command: 'tmux', args })),
  buildTmuxCommandString: vi.fn((args: string[]) => ['tmux', ...args].join(' ')),
}));

import { setAgentRuntimeMirror } from '../../src/lib/agent-runtime-mirror.js';
import { determineHealthStatus } from '../../src/dashboard/lib/health-filtering.js';

const NOW = new Date('2026-07-16T12:00:00.000Z');
const runDetermineHealthStatus = (...args: Parameters<typeof determineHealthStatus>) =>
  Effect.runPromise(determineHealthStatus(...args));

let testDir: string;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  activeSessions.clear();
  await Effect.runPromise(setAgentRuntimeMirror({}));
  testDir = mkdtempSync(join(tmpdir(), 'health-api-test-'));
  mkdirSync(join(testDir, '.overdeck', 'agents'), { recursive: true });
});

afterEach(async () => {
  activeSessions.clear();
  await Effect.runPromise(setAgentRuntimeMirror({}));
  rmSync(testDir, { recursive: true, force: true });
  vi.useRealTimers();
});

function createAgent(
  name: string,
  status?: string,
  lastActivity = NOW.toISOString(),
): string {
  const agentDir = join(testDir, '.overdeck', 'agents', name);
  mkdirSync(agentDir, { recursive: true });

  if (status !== undefined) {
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: name,
      issueId: 'PAN-2647',
      role: 'work',
      status,
      startedAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString(),
      lastActivity,
      kickoffDelivered: true,
    }, null, 2));
  }

  return agentDir;
}

async function setRuntime(
  agentId: string,
  activity: AgentRuntimeSnapshot['activity'],
  lastActivity: string,
  contextSaturatedAt?: string,
): Promise<void> {
  await Effect.runPromise(setAgentRuntimeMirror({
    [agentId]: {
      id: agentId as AgentRuntimeSnapshot['id'],
      activity,
      lastActivity,
      ...(contextSaturatedAt ? { contextSaturatedAt } : {}),
      updatedAtSequence: 1 as AgentRuntimeSnapshot['updatedAtSequence'],
    },
  }));
}

function createTmuxSession(name: string): void {
  activeSessions.add(name);
}

describe('health-api agent classification adapter', () => {
  it.each(['stopped', 'completed'])(
    'shows intentionally inactive %s agents as idle',
    async (status) => {
      const agentDir = createAgent(`agent-${status}`, status);
      await expect(runDetermineHealthStatus(
        `agent-${status}`,
        join(agentDir, 'state.json'),
        activeSessions,
      )).resolves.toEqual({ status: 'idle' });
    },
  );

  it('shows missing state as unavailable instead of omitting the agent', async () => {
    const agentDir = createAgent('agent-no-state');
    await expect(runDetermineHealthStatus(
      'agent-no-state',
      join(agentDir, 'state.json'),
      activeSessions,
    )).resolves.toEqual({
      status: 'unavailable',
      reason: 'Agent state file is missing.',
    });
  });

  it('does not declare a starting agent dead inside the five-minute grace', async () => {
    const name = 'agent-starting';
    const agentDir = createAgent(name, 'starting');
    writeFileSync(join(agentDir, 'state.json'), JSON.stringify({
      id: name,
      role: 'work',
      status: 'starting',
      startedAt: new Date(NOW.getTime() - 4 * 60 * 1000).toISOString(),
    }));

    await expect(runDetermineHealthStatus(
      name,
      join(agentDir, 'state.json'),
      activeSessions,
    )).resolves.toEqual({ status: 'healthy' });
  });

  it('declares running agents dead when tmux is missing after startup grace', async () => {
    const name = 'agent-crashed';
    const agentDir = createAgent(name, 'running');
    const result = await runDetermineHealthStatus(
      name,
      join(agentDir, 'state.json'),
      activeSessions,
    );

    expect(result.status).toBe('dead');
    expect(result.reason).toContain('tmux session is missing');
  });

  it('shows a live running agent as healthy', async () => {
    const name = 'agent-healthy-test';
    const agentDir = createAgent(name, 'running');
    createTmuxSession(name);

    await expect(runDetermineHealthStatus(
      name,
      join(agentDir, 'state.json'),
      activeSessions,
    )).resolves.toEqual({ status: 'healthy' });
  });

  it('uses the canonical runtime mirror for context saturation', async () => {
    const name = 'agent-wedged-test';
    const agentDir = createAgent(name, 'running');
    createTmuxSession(name);
    await setRuntime(
      name,
      'working',
      NOW.toISOString(),
      '2026-07-16T11:55:00.000Z',
    );

    const result = await runDetermineHealthStatus(
      name,
      join(agentDir, 'state.json'),
      activeSessions,
    );
    expect(result.status).toBe('wedged');
    expect(result.reason).toContain('Context window exhausted');
  });

  it.each([
    [15, 'warning'],
    [30, 'stalled'],
  ] as const)(
    'classifies active runtime inactivity at %i minutes as %s',
    async (minutes, expected) => {
      const name = `agent-${expected}-test`;
      const activity = new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
      const agentDir = createAgent(name, 'running', activity);
      createTmuxSession(name);
      await setRuntime(name, 'working', activity);

      const result = await runDetermineHealthStatus(
        name,
        join(agentDir, 'state.json'),
        activeSessions,
      );
      expect(result.status).toBe(expected);
      expect(result.reason).toContain(`${minutes} minutes`);
    },
  );

  it('does not turn waiting runtime inactivity into a stall', async () => {
    const name = 'agent-waiting-test';
    const activity = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();
    const agentDir = createAgent(name, 'running', activity);
    createTmuxSession(name);
    await setRuntime(name, 'waiting', activity);

    await expect(runDetermineHealthStatus(
      name,
      join(agentDir, 'state.json'),
      activeSessions,
    )).resolves.toMatchObject({ status: 'waiting' });
  });

  it('shows corrupted state as unavailable with the resolver error', async () => {
    const agentDir = createAgent('agent-corrupted-state');
    writeFileSync(join(agentDir, 'state.json'), 'not valid json{{{');

    const result = await runDetermineHealthStatus(
      'agent-corrupted-state',
      join(agentDir, 'state.json'),
      activeSessions,
    );
    expect(result.status).toBe('unavailable');
    expect(result.reason).toContain('Agent state could not be read');
  });
});
