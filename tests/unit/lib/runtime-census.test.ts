import { describe, expect, it, vi } from 'vitest';

import {
  createRuntimeCensusService,
  descendantPidsForSession,
  panePidsForSession,
  parseRuntimeProcessTable,
  runtimeCensusHasHarnessProcess,
} from '../../../src/lib/runtime-census.js';

const pane = (sessionName: string, panePid: number) => ({
  sessionName,
  panePid,
  paneDead: false,
  paneDeadStatus: null,
});

const process = (pid: number, ppid: number, comm: string) => ({
  pid,
  ppid,
  cpuPercent: 1,
  rssBytes: 1024,
  comm,
  command: comm,
});

describe('runtime census', () => {
  it('parses one ps table into process records', () => {
    expect(parseRuntimeProcessTable([
      ' 100 1 2.5 1024 bash bash launcher.sh',
      ' 101 100 7.0 2048 node node pty-supervisor.js',
    ].join('\n'))).toEqual([
      { pid: 100, ppid: 1, cpuPercent: 2.5, rssBytes: 1024 * 1024, comm: 'bash', command: 'bash launcher.sh' },
      { pid: 101, ppid: 100, cpuPercent: 7, rssBytes: 2048 * 1024, comm: 'node', command: 'node pty-supervisor.js' },
    ]);
  });

  it('is single-flight, TTL-cached, and keeps the last good census on refresh failure', async () => {
    let now = 1_000;
    let resolvePanes!: (value: ReturnType<typeof pane>[]) => void;
    const listPanes = vi.fn(() => new Promise<ReturnType<typeof pane>[]>((resolve) => { resolvePanes = resolve; }));
    const readProcesses = vi.fn().mockResolvedValue([process(100, 1, 'bash')]);
    const service = createRuntimeCensusService({ listPanes, readProcesses, now: () => now, ttlMs: 3_000 });

    const first = service.get();
    const concurrent = service.get();
    expect(listPanes).toHaveBeenCalledOnce();
    expect(readProcesses).toHaveBeenCalledOnce();

    resolvePanes([pane('conv-one', 100)]);
    const [firstResult, concurrentResult] = await Promise.all([first, concurrent]);
    expect(firstResult).toBe(concurrentResult);
    expect(firstResult.sessionNames.has('conv-one')).toBe(true);

    now += 2_000;
    expect(await service.get()).toBe(firstResult);
    expect(listPanes).toHaveBeenCalledOnce();

    now += 2_000;
    listPanes.mockRejectedValueOnce(new Error('tmux unavailable'));
    const stale = await service.get({ fresh: true });
    expect(stale).toMatchObject({
      available: false,
      tmuxAvailable: false,
      processAvailable: true,
      stale: true,
      error: 'tmux unavailable',
    });
    expect(stale.sessionNames.has('conv-one')).toBe(true);
  });

  it('keeps tmux liveness usable while process inspection fails open', async () => {
    const service = createRuntimeCensusService({
      listPanes: async () => [pane('conv-live', 100)],
      readProcesses: async () => { throw new Error('ps unavailable'); },
    });
    const census = await service.get();

    expect(census).toMatchObject({ available: true, tmuxAvailable: true, processAvailable: false });
    expect(census.sessionNames.has('conv-live')).toBe(true);
    expect(runtimeCensusHasHarnessProcess(census, 'conv-live')).toBe(true);
  });

  it('indexes pane roots and process descendants for liveness and memory consumers', async () => {
    const service = createRuntimeCensusService({
      listPanes: async () => [pane('conv-live', 100), pane('conv-corpse', 200)],
      readProcesses: async () => [
        process(100, 1, 'bash'),
        process(101, 100, 'node'),
        process(102, 101, 'claude'),
        process(200, 1, 'bash'),
        process(201, 200, 'sleep'),
      ],
    });
    const census = await service.get();

    expect(panePidsForSession(census, 'conv-live')).toEqual([100]);
    expect([...descendantPidsForSession(census, 'conv-live')]).toEqual([100, 101, 102]);
    expect(runtimeCensusHasHarnessProcess(census, 'conv-live')).toBe(true);
    expect(runtimeCensusHasHarnessProcess(census, 'conv-corpse')).toBe(false);
  });
});
