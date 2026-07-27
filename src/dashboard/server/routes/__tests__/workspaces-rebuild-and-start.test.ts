import { beforeEach, describe, expect, it, vi } from 'vitest';

// `spawnPanCommand` spawns real `pan` processes and mutates module-level
// activity/pendingOperation maps. To test the rebuild → start chaining logic we
// intercept `node:child_process.spawn` and drive fake children ourselves. The
// hoisted `harness` is shared with the (hoisted) mock factory so the test body
// can observe call order and emit close events.
const harness = vi.hoisted(() => ({
  spawnCalls: [] as { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }[],
  children: [] as Array<{ emit: (event: string, ...args: unknown[]) => void }>,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    spawn: (cmd: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
      const child = new EventEmitter();
      (child as { stdout: EventEmitter }).stdout = new EventEmitter();
      (child as { stderr: EventEmitter }).stderr = new EventEmitter();
      harness.spawnCalls.push({ cmd, args: [...args], env: options?.env });
      harness.children.push(child);
      return child;
    },
  };
});

// emitActivityEntrySync writes to the SQLite event store; keep this a pure
// unit test by no-op'ing it.
vi.mock('../../../../lib/activity-logger.js', () => ({
  emitActivityEntrySync: () => undefined,
}));

import { spawnPanCommand } from '../workspaces.js';
import { panCliInvocation } from '../../../../lib/pan-cli-invocation.js';

const CHAIN = { args: ['start', 'MIN-831'], phaseLabel: 'Stack rebuilt — starting agent for MIN-831' };
const expectedSpawn = (args: string[]) => {
  const invocation = panCliInvocation(args);
  return { cmd: invocation.command, args: invocation.args, env: expect.any(Object) };
};

describe('spawnPanCommand chainOnSuccess (rebuild-and-start)', () => {
  beforeEach(() => {
    harness.spawnCalls.length = 0;
    harness.children.length = 0;
  });

  it('spawns the chained command only after the first exits 0', () => {
    spawnPanCommand(['workspace', 'rebuild', 'MIN-831'], 'Rebuild & start for MIN-831', '/projects/myn', {
      issueId: 'MIN-831',
      pendingOperation: 'rebuild-stack',
      chainOnSuccess: CHAIN,
      env: { OVERDECK_AGENT_STARTED_BY: 'workspace-rebuild-recovery' },
    });

    // Phase 1 fired immediately; phase 2 has not.
    expect(harness.spawnCalls).toHaveLength(1);
    expect(harness.spawnCalls[0]).toEqual(expectedSpawn(['workspace', 'rebuild', 'MIN-831']));
    expect(harness.spawnCalls[0].env).toMatchObject({ OVERDECK_AGENT_STARTED_BY: 'workspace-rebuild-recovery' });

    // Rebuild succeeds → start spawns.
    harness.children[0].emit('close', 0);
    expect(harness.spawnCalls).toHaveLength(2);
    expect(harness.spawnCalls[1]).toEqual(expectedSpawn(['start', 'MIN-831']));
    expect(harness.spawnCalls[1].env).toMatchObject({ OVERDECK_AGENT_STARTED_BY: 'workspace-rebuild-recovery' });

    // Start succeeds → no further spawns.
    harness.children[1].emit('close', 0);
    expect(harness.spawnCalls).toHaveLength(2);
  });

  it('does not chain when the first command fails', () => {
    spawnPanCommand(['workspace', 'rebuild', 'MIN-831'], 'Rebuild & start for MIN-831', '/projects/myn', {
      issueId: 'MIN-831',
      pendingOperation: 'rebuild-stack',
      chainOnSuccess: CHAIN,
    });

    harness.children[0].emit('close', 1);
    expect(harness.spawnCalls).toHaveLength(1);
  });

  it('does not chain when chainOnSuccess is omitted', () => {
    spawnPanCommand(['workspace', 'rebuild', 'MIN-831'], 'Rebuild stack for MIN-831', '/projects/myn', {
      issueId: 'MIN-831',
      pendingOperation: 'rebuild-stack',
    });

    harness.children[0].emit('close', 0);
    expect(harness.spawnCalls).toHaveLength(1);
  });
});
