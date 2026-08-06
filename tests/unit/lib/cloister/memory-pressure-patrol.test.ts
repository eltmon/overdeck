import { describe, it, expect, beforeEach } from 'vitest';
import { memoryFeedLevel, patrolMemoryPressure, __resetMemoryPressurePatrolState, MemoryFeedLevel } from '../../../../src/lib/cloister/memory-pressure-patrol.js';
import type { MemoryVerdict, MemoryPressureBand } from '../../../../src/lib/cloister/memory-governor.js';

const GIB = 1024 ** 3;

describe('memory-pressure-patrol', () => {
  beforeEach(() => {
    __resetMemoryPressurePatrolState();
  });

  describe('memoryFeedLevel', () => {
    it('returns "shedding" for hard band', () => {
      const level = memoryFeedLevel('hard', 10 * GIB, 12 * GIB);
      expect(level).toBe('shedding');
    });

    it('returns "holding" for soft band', () => {
      const level = memoryFeedLevel('soft', 10 * GIB, 12 * GIB);
      expect(level).toBe('holding');
    });

    it('returns "watch" for ok band below watch reserve', () => {
      const level = memoryFeedLevel('ok', 10 * GIB, 12 * GIB);
      expect(level).toBe('watch');
    });

    it('returns "ok" for ok band above watch reserve', () => {
      const level = memoryFeedLevel('ok', 15 * GIB, 12 * GIB);
      expect(level).toBe('ok');
    });
  });

  describe('patrolMemoryPressure', () => {
    it('emits a warn-level entry when crossing into watch level', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'warn',
        source: 'cloister',
        link: '/resources',
      });
      expect((emitted[0] as any).message).toContain('watch reserve');
      expect((emitted[0] as any).message).toContain('10.0 GiB');
      expect(typeof (emitted[0] as any).details).toBe('string');
      expect(actions).toHaveLength(1);
    });

    it('emits nothing on second call with same watch level', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      await patrolMemoryPressure(deps);
      expect(emitted).toHaveLength(1);

      emitted.length = 0;
      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(0);
      expect(actions).toHaveLength(0);
    });

    it('emits a warn-level entry for soft band (admission hold)', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'soft' as const,
        availableBytes: 7 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'warn',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('stopped admitting');
      expect((emitted[0] as any).message).toContain('recovery reserve');
      expect(actions).toHaveLength(1);
    });

    it('emits an error-level entry for hard band (shedding)', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'hard' as const,
        availableBytes: 3 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      const actions = await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'error',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('critical');
      expect(actions).toHaveLength(1);
    });

    it('emits an info-level entry when recovering from watch to ok', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      // First call: enter watch
      await patrolMemoryPressure(deps);
      expect(emitted).toHaveLength(1);
      expect((emitted[0] as any).level).toBe('warn');

      // Second call: recover to ok
      emitted.length = 0;
      const recoverVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 15 * GIB,
      };
      const recoverDeps = {
        ...deps,
        assess: async () => recoverVerdict,
      };
      const actions = await patrolMemoryPressure(recoverDeps);

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        level: 'info',
        source: 'cloister',
      });
      expect((emitted[0] as any).message).toContain('cleared');
      expect(actions).toHaveLength(1);
    });

    it('always returns a string-valued details field', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        emit: (entry: object) => emitted.push(entry),
      };

      await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      const details = (emitted[0] as any).details;
      expect(typeof details).toBe('string');
      expect(details).toContain('MemAvailable');
      expect(details).toContain('Watch reserve');
    });
  });
});

  describe('topMemoryConsumers', () => {
    it('returns top N processes by RSS', async () => {
      const { topMemoryConsumers } = await import('../../../../src/lib/cloister/memory-pressure-patrol.js');
      const mockCensus = {
        processAvailable: true,
        panesBySession: new Map([['agent-test', [{ panePid: 100, sessionName: 'agent-test' }]]]),
        processesByPid: new Map([
          [1000, { pid: 1000, ppid: 1, rssBytes: 5 * GIB, command: 'python' }],
          [1001, { pid: 1001, ppid: 1, rssBytes: 3 * GIB, command: 'java' }],
          [1002, { pid: 1002, ppid: 100, rssBytes: 2 * GIB, command: 'node' }],
        ]),
      };
      const top = topMemoryConsumers(mockCensus, 2);
      expect(top).toHaveLength(2);
      expect(top[0].pid).toBe(1000);
      expect(top[1].pid).toBe(1001);
    });

    it('attributes process to session via parent chain', async () => {
      const { topMemoryConsumers } = await import('../../../../src/lib/cloister/memory-pressure-patrol.js');
      const mockCensus = {
        processAvailable: true,
        panesBySession: new Map([['agent-test', [{ panePid: 50, sessionName: 'agent-test' }]]]),
        processesByPid: new Map([
          [100, { pid: 100, ppid: 50, rssBytes: 4 * GIB, command: 'work-agent' }],
        ]),
      };
      const top = topMemoryConsumers(mockCensus, 1);
      expect(top[0].sessionName).toBe('agent-test');
    });
  });

  describe('parseOomKills', () => {
    it('parses kernel OOM lines and joins on pid', async () => {
      const { parseOomKills } = await import('../../../../src/lib/cloister/memory-pressure-patrol.js');
      const journal = `oom-kill:constraint=CONSTRAINT_NONE,nodemask=(null),cpuset=docker-0647,mems_allowed=0,global_oom,task_memcg=/app.slice/overdeck-tmux-server.service,task=python,pid=2230723,uid=1000
Out of memory: Killed process 2230723 (python) total-vm:349473036kB, anon-rss:41321032kB, file-rss:66872kB, shmem-rss:8744kB, UID:1000 pgtables:85936kB oom_score_adj:200`;
      const kills = parseOomKills(journal);
      expect(kills).toHaveLength(1);
      expect(kills[0].pid).toBe(2230723);
      expect(kills[0].comm).toBe('python');
      expect(kills[0].inOverdeckTree).toBe(true);
      expect(kills[0].rssBytes).toBe((41321032 + 66872 + 8744) * 1024);
    });

    it('handles cgroup outside Overdeck tree', async () => {
      const { parseOomKills } = await import('../../../../src/lib/cloister/memory-pressure-patrol.js');
      const journal = `oom-kill:constraint=CONSTRAINT_NONE,task_memcg=/user.slice/user-1000.slice/user@1000.service/app.slice/Chrome.scope,task=Chrome,pid=5956,uid=1000`;
      const kills = parseOomKills(journal);
      expect(kills[0].inOverdeckTree).toBe(false);
    });
  });
});
