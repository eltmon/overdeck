/**
 * PAN-5176 FR-17: with every denied host tool missing, each PAN-5168 idle
 * poller spawns 0 denied tools per tick, over 3 ticks with 61 s of fake time
 * between them (past HOST_TOOL_MISSING_RECHECK_MS, so the recheck runs too).
 *
 * These tests run the pollers on their default dependencies: the real
 * `node:child_process` and the real `NodeServices.layer`, counted by the spawn
 * ledger. The per-poller tests next to each subject mock `child_process` or
 * inject a spawner instead. Each poller also has a positive control: with its
 * tool reported present, one tick records at least one call, which proves the
 * ledger sees this poller's spawn path. The ledger redirects that call, so no
 * real docker or tmux runs.
 *
 * Only `Date` is faked: `host-tools.ts` reads `Date.now`, and the Effect and
 * child-process callbacks need real timers and I/O.
 */
import * as NodeServices from '@effect/platform-node/NodeServices';
import { Effect } from 'effect';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockerStatsCollector } from '../../../src/lib/docker-stats.js';
import { resetHostToolsForTests, setHostToolFinderForTests, type HostToolName } from '../../../src/lib/host-tools.js';
import { conversationSessionAlive, listLiveConversationSessions } from '../../../src/lib/overdeck/conversation-liveness.js';
import { listHostTmuxPanes } from '../../../src/lib/runtime-census.js';
import { collectDockerContainerLifecycleSnapshot } from '../../../src/lib/workspace/stack-health.js';
import { loadDockerContainers } from '../../../src/dashboard/server/services/resource-discovery-shared.js';
import { DENIED_HOST_TOOLS, expectSpawnBudget, spawnsPerTick } from '../../helpers/spawn-budget.js';

const ledger = await vi.hoisted(async () =>
  (await import('../../helpers/spawn-budget.js')).installSpawnLedger());

const denied: readonly string[] = DENIED_HOST_TOOLS;
const betweenTicks = async (): Promise<void> => {
  vi.setSystemTime(Date.now() + 61_000);
};

function reportMissing(): void {
  setHostToolFinderForTests((name) => (denied.includes(name) ? null : name));
}

function reportPresent(tool: HostToolName): void {
  setHostToolFinderForTests((name) => (name === tool ? `/usr/bin/${name}` : null));
}

async function zeroBudget(label: string, tick: () => Promise<void>): Promise<void> {
  const perTick = await spawnsPerTick(ledger, tick, { ticks: 3, betweenTicks, programs: [...DENIED_HOST_TOOLS] });
  expectSpawnBudget(perTick, { max: 0, label });
}

/**
 * Positive control: with `tool` reported present, one run of `subject` must
 * reach `child_process` for it. The ledger redirects the call, so the subject
 * then sees a spawn failure; its outcome in that state is not this file's
 * contract, so the probe settles it explicitly.
 */
async function presentToolCalls(tool: HostToolName, subject: () => Promise<unknown>): Promise<number> {
  reportPresent(tool);
  const probe = (): Promise<void> => subject().then(() => undefined, () => undefined);
  const [calls] = await spawnsPerTick(ledger, probe, { ticks: 1, programs: [tool] });
  return calls ?? 0;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-13T00:00:00Z'), toFake: ['Date'] });
  reportMissing();
});

afterEach(() => {
  resetHostToolsForTests();
  vi.useRealTimers();
});

afterAll(() => {
  ledger.restore();
});

describe('DockerStatsCollector.collect', () => {
  const tick = async (): Promise<void> => {
    await expect(
      Effect.runPromise(Effect.provide(new DockerStatsCollector().collect(), NodeServices.layer)),
    ).resolves.toBeUndefined();
  };

  it('spawns 0 denied tools per tick with docker missing', async () => {
    await zeroBudget('DockerStatsCollector.collect', tick);
  });

  it('positive control: spawns docker when docker is present', async () => {
    const collect = () => Effect.runPromise(Effect.provide(new DockerStatsCollector().collect(), NodeServices.layer));
    expect(await presentToolCalls('docker', collect)).toBeGreaterThanOrEqual(1);
  });
});

describe('loadDockerContainers', () => {
  const tick = async (): Promise<void> => {
    expect(await loadDockerContainers()).toEqual([]);
  };

  it('spawns 0 denied tools per tick with docker missing', async () => {
    await zeroBudget('loadDockerContainers', tick);
  });

  it('positive control: spawns docker when docker is present', async () => {
    expect(await presentToolCalls('docker', () => loadDockerContainers())).toBeGreaterThanOrEqual(1);
  });
});

describe('collectDockerContainerLifecycleSnapshot', () => {
  // Its contract with docker missing is a failure with code ENOENT.
  const tick = async (): Promise<void> => {
    const result = await Effect.runPromise(Effect.result(collectDockerContainerLifecycleSnapshot()));
    if (result._tag !== 'Failure') throw new Error('expected the docker snapshot to fail with ENOENT');
    expect(result.failure.code).toBe('ENOENT');
  };

  it('spawns 0 denied tools per tick with docker missing', async () => {
    await zeroBudget('collectDockerContainerLifecycleSnapshot', tick);
  });

  it('positive control: spawns docker when docker is present', async () => {
    const snapshot = () => Effect.runPromise(collectDockerContainerLifecycleSnapshot());
    expect(await presentToolCalls('docker', snapshot)).toBeGreaterThanOrEqual(1);
  });
});

describe('listHostTmuxPanes', () => {
  // Its contract with tmux missing is a rejection with code ENOENT.
  const tick = async (): Promise<void> => {
    await expect(listHostTmuxPanes()).rejects.toMatchObject({ code: 'ENOENT' });
  };

  it('spawns 0 denied tools per tick with tmux missing', async () => {
    await zeroBudget('listHostTmuxPanes', tick);
  });

  it('positive control: spawns tmux when tmux is present', async () => {
    expect(await presentToolCalls('tmux', () => listHostTmuxPanes())).toBeGreaterThanOrEqual(1);
  });
});

describe('conversation liveness on the tmux backend', () => {
  const tick = async (): Promise<void> => {
    const live = await listLiveConversationSessions({ backend: 'tmux', listHerdr: async () => [] });
    expect(live).toBeInstanceOf(Set);
    expect(await conversationSessionAlive('conv-x', { backend: 'tmux' })).toBe(false);
  };

  it('spawns 0 denied tools per tick with tmux missing', async () => {
    await zeroBudget('conversation liveness', tick);
  });

  it('positive control: spawns tmux when tmux is present', async () => {
    expect(await presentToolCalls('tmux', () => Promise.all([
      listLiveConversationSessions({ backend: 'tmux', listHerdr: async () => [] }),
      conversationSessionAlive('conv-x', { backend: 'tmux' }),
    ]))).toBeGreaterThanOrEqual(1);
  });
});
