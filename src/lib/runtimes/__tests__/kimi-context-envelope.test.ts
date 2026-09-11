import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KIMI_CONTEXT_END,
  KIMI_CONTEXT_START,
  KIMI_TASK_END,
  KIMI_TASK_START,
  markKimiContextDelivered,
  prepareKimiMessage,
  waitForManagedKimiSessionId,
} from '../kimi-context-envelope.js';

describe('native Kimi managed-context envelope', () => {
  let overdeckHome: string;
  let previousOverdeckHome: string | undefined;
  let contextFile: string;

  beforeEach(() => {
    previousOverdeckHome = process.env.OVERDECK_HOME;
    overdeckHome = mkdtempSync(join(tmpdir(), 'overdeck-kimi-context-'));
    process.env.OVERDECK_HOME = overdeckHome;
    contextFile = join(overdeckHome, 'workspace-context.md');
    writeFileSync(contextFile, '# Project rules\n\nPreserve project-specific guidance.\n');
  });

  afterEach(() => {
    if (previousOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousOverdeckHome;
    rmSync(overdeckHome, { recursive: true, force: true });
  });

  it('puts managed context before the exact task and sends it once per native session', async () => {
    const agentId = 'agent-kimi-context';
    const first = await prepareKimiMessage(agentId, '/workspace/project', 'Implement PAN-3779.', {
      sessionId: 'session-one',
      contextFiles: [contextFile],
    });

    expect(first.contextIncluded).toBe(true);
    expect(first.message).toContain(KIMI_CONTEXT_START);
    expect(first.message).toContain(KIMI_CONTEXT_END);
    expect(first.message).toContain(`${KIMI_TASK_START}\nImplement PAN-3779.\n${KIMI_TASK_END}`);
    expect(first.message.indexOf('Preserve project-specific guidance.')).toBeLessThan(
      first.message.indexOf('Implement PAN-3779.'),
    );
    expect(existsSync(join(overdeckHome, 'agents', agentId, 'kimi-context-delivery.json'))).toBe(false);

    markKimiContextDelivered(agentId, first);
    const sameSession = await prepareKimiMessage(agentId, '/workspace/project', 'Continue.', {
      sessionId: 'session-one',
      contextFiles: [contextFile],
    });
    expect(sameSession).toMatchObject({ message: 'Continue.', contextIncluded: false });

    const freshSession = await prepareKimiMessage(agentId, '/workspace/project', 'Resume in a fresh session.', {
      sessionId: 'session-two',
      contextFiles: [contextFile],
    });
    expect(freshSession.contextIncluded).toBe(true);
    expect(freshSession.message).toContain('Resume in a fresh session.');

    const receipt = JSON.parse(readFileSync(
      join(overdeckHome, 'agents', agentId, 'kimi-context-delivery.json'),
      'utf8',
    )) as { sessions: Record<string, unknown> };
    expect(Object.keys(receipt.sessions)).toEqual(['session-one']);
  });

  it('fails closed when the native session identity is unavailable', async () => {
    await expect(prepareKimiMessage('agent-no-session', '/workspace/project', 'Task', {
      contextFiles: [contextFile],
    })).rejects.toThrow(/captured kimi-session-id is missing/);
  });

  describe('waitForManagedKimiSessionId', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves once the spawn path writes the pointer file', async () => {
      const agentId = 'conv-kimi-wait';
      const pending = waitForManagedKimiSessionId(agentId, { timeoutMs: 5_000, pollMs: 250, overdeckHome });

      await vi.advanceTimersByTimeAsync(600);
      mkdirSync(join(overdeckHome, 'agents', agentId), { recursive: true });
      writeFileSync(join(overdeckHome, 'agents', agentId, 'kimi-session-id'), 'session-late\n');
      await vi.advanceTimersByTimeAsync(300);

      await expect(pending).resolves.toBe('session-late');
    });

    it('returns null at the deadline when the id never appears', async () => {
      const pending = waitForManagedKimiSessionId('conv-kimi-never', { timeoutMs: 1_000, pollMs: 250, overdeckHome });
      await vi.advanceTimersByTimeAsync(1_100);
      await expect(pending).resolves.toBeNull();
    });
  });
});
