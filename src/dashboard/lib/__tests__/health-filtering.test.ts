import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { determineHealthStatus } from '../health-filtering.js';

let tmpDir: string;
const now = new Date('2026-06-05T20:30:00.000Z');

function writeState(agentId: string, state: Record<string, unknown>): string {
  const stateFile = join(tmpDir, `${agentId}-state.json`);
  writeFileSync(stateFile, JSON.stringify(state));
  return stateFile;
}

function runningWorkState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-health-test',
    role: 'work',
    status: 'running',
    startedAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
    lastActivity: now.toISOString(),
    ...overrides,
  };
}

describe('determineHealthStatus kickoff delivery stalls', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pan-health-'));
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns stalled for a running work agent with no confirmed kickoff past the grace window', async () => {
    const agentId = 'agent-stalled';
    const stateFile = writeState(agentId, runningWorkState({ id: agentId, kickoffDelivered: false }));

    await expect(Effect.runPromise(determineHealthStatus(agentId, stateFile, new Set([agentId])))).resolves.toEqual({
      status: 'stalled',
      reason: 'Work agent running with no kickoff delivered since spawn',
    });
  });

  it('does not return stalled while the agent is inside the kickoff grace window', async () => {
    const agentId = 'agent-within-grace';
    const stateFile = writeState(
      agentId,
      runningWorkState({
        id: agentId,
        kickoffDelivered: false,
        startedAt: new Date(now.getTime() - 4 * 60 * 1000).toISOString(),
      }),
    );

    await expect(Effect.runPromise(determineHealthStatus(agentId, stateFile, new Set([agentId])))).resolves.toEqual({
      status: 'healthy',
    });
  });

  it('does not return stalled when kickoff delivery is confirmed', async () => {
    const agentId = 'agent-kickoff-confirmed';
    const stateFile = writeState(agentId, runningWorkState({ id: agentId, kickoffDelivered: true }));

    await expect(Effect.runPromise(determineHealthStatus(agentId, stateFile, new Set([agentId])))).resolves.toEqual({
      status: 'healthy',
    });
  });

  it('does not return stalled for legacy agents without kickoffDelivered', async () => {
    const agentId = 'agent-legacy';
    const stateFile = writeState(agentId, runningWorkState({ id: agentId }));

    await expect(Effect.runPromise(determineHealthStatus(agentId, stateFile, new Set([agentId])))).resolves.toEqual({
      status: 'healthy',
    });
  });
});
