import { describe, it, expect, beforeEach } from 'vitest';
import { memoryFeedLevel, patrolMemoryPressure, __resetMemoryPressurePatrolState, MemoryFeedLevel } from '../../../../src/lib/cloister/memory-pressure-patrol.js';
import type { MemoryVerdict, MemoryPressureBand } from '../../../../src/lib/cloister/memory-governor.js';

const GIB = 1024 ** 3;
const THRESHOLDS = { warningBytes: 8 * GIB, criticalBytes: 4 * GIB };

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
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
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
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
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
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
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

    it('explains a hold from its stored trigger, current reading, and both exit conditions', async () => {
      const emitted: any[] = [];
      const triggerAt = Date.UTC(2026, 0, 1, 14, 22);
      const verdict: MemoryVerdict = {
        band: 'soft',
        availableBytes: 12.5 * GIB,
        thresholds: THRESHOLDS,
        trigger: { kind: 'soft-dip', readingBytes: 7 * GIB, thresholdBytes: 8 * GIB, at: triggerAt },
      };

      await patrolMemoryPressure({
        assess: async () => verdict,
        readWatchReserveBytes: () => 14 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
        emit: (entry) => emitted.push(entry),
      });

      expect(emitted[0].message).toContain('14:22 UTC');
      expect(emitted[0].message).toContain('dipped to 7.0 GiB, under the 8.0 GiB soft reserve');
      expect(emitted[0].message).toContain('12.5 GiB is available now');
      expect(emitted[0].message).toContain('16.0 GiB recovery reserve');
      expect(emitted[0].message).toContain('8.0 GiB soft reserve');
      expect(emitted[0].message).toContain('below 0.05 for 10 minutes');
    });

    it('emits an error-level entry for hard band (shedding)', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'hard' as const,
        availableBytes: 3 * GIB,
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
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

    it('attributes swap/PSI shedding without claiming current memory is below hard', async () => {
      const emitted: any[] = [];
      const verdict: MemoryVerdict = {
        band: 'hard',
        availableBytes: 12.5 * GIB,
        thresholds: THRESHOLDS,
        trigger: {
          kind: 'swap-psi',
          readingBytes: 1 * GIB,
          thresholdBytes: 2 * GIB,
          at: Date.UTC(2026, 0, 1, 14, 22),
        },
      };

      await patrolMemoryPressure({
        assess: async () => verdict,
        readWatchReserveBytes: () => 14 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
        emit: (entry) => emitted.push(entry),
      });

      expect(emitted[0].message).toContain('swap free fell to 1.0 GiB');
      expect(emitted[0].message).toContain('memory pressure stalls were active');
      expect(emitted[0].message).not.toContain('12.5 GiB available is under the 4.0 GiB hard reserve');
    });

    it('keeps every availability-versus-reserve claim numerically true across bands and triggers', async () => {
      const triggerCases = [
        { kind: 'soft-dip' as const, readingBytes: 7 * GIB, thresholdBytes: 8 * GIB },
        { kind: 'hard' as const, readingBytes: 3 * GIB, thresholdBytes: 4 * GIB },
        { kind: 'swap-psi' as const, readingBytes: 1 * GIB, thresholdBytes: 2 * GIB },
        { kind: 'psi-unavailable' as const, readingBytes: 1 * GIB, thresholdBytes: 2 * GIB },
      ];
      const bands: MemoryPressureBand[] = ['ok', 'soft', 'hard'];

      for (const band of bands) {
        for (const trigger of triggerCases) {
          for (const availableGib of [3, 6, 10, 20]) {
            __resetMemoryPressurePatrolState();
            const emitted: any[] = [];
            await patrolMemoryPressure({
              assess: async () => ({
                band,
                availableBytes: availableGib * GIB,
                thresholds: THRESHOLDS,
                trigger: { ...trigger, at: Date.UTC(2026, 0, 1, 14, 22) },
              }),
              readWatchReserveBytes: () => 12 * GIB,
              readSoftReserveBytes: () => 8 * GIB,
              readHardReserveBytes: () => 4 * GIB,
              readRecoveryReserveBytes: () => 16 * GIB,
              readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
              emit: (entry) => emitted.push(entry),
            });

            const message = emitted[0].message as string;
            for (const match of message.matchAll(/([\d.]+) GiB available, below the ([\d.]+) GiB/g)) {
              expect(Number(match[1])).toBeLessThan(Number(match[2]));
            }
            for (const match of message.matchAll(/([\d.]+) GiB available, at or above the ([\d.]+) GiB/g)) {
              expect(Number(match[1])).toBeGreaterThanOrEqual(Number(match[2]));
            }
            for (const match of message.matchAll(/(?:dipped|fell) to ([\d.]+) GiB, under the ([\d.]+) GiB/g)) {
              expect(Number(match[1])).toBeLessThan(Number(match[2]));
            }
          }
        }
      }
    });

    it('emits an info-level entry when recovering from watch to ok', async () => {
      const emitted: object[] = [];

      const mockVerdict: MemoryVerdict = {
        band: 'ok' as const,
        availableBytes: 10 * GIB,
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
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
        thresholds: THRESHOLDS,
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
        thresholds: THRESHOLDS,
      };

      const deps = {
        assess: async () => mockVerdict,
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
        emit: (entry: object) => emitted.push(entry),
      };

      await patrolMemoryPressure(deps);

      expect(emitted).toHaveLength(1);
      const details = (emitted[0] as any).details;
      expect(typeof details).toBe('string');
      expect(details).toContain('MemAvailable');
      expect(details).toContain('Watch reserve');
    });

    it('prints real swap and PSI readings in the details block', async () => {
      const emitted: any[] = [];
      await patrolMemoryPressure({
        assess: async () => ({
          band: 'ok',
          availableBytes: 20 * GIB,
          thresholds: THRESHOLDS,
          swapFreeBytes: 0,
          swapTotalBytes: 8 * GIB,
          psiSomeAvg10: 0,
          psiFullAvg10: 0,
        }),
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
        emit: (entry) => emitted.push(entry),
      });

      expect(emitted[0].details).toContain('Swap: 0.0 GiB free of 8.0 GiB');
      expect(emitted[0].details).toContain('PSI some avg10: 0.00 | full avg10: 0.00');
      expect(emitted[0].details).not.toContain('Swap free: unavailable');
    });

    it('labels only unreadable PSI values unavailable while preserving swap readings', async () => {
      const emitted: any[] = [];
      await patrolMemoryPressure({
        assess: async () => ({
          band: 'ok',
          availableBytes: 20 * GIB,
          thresholds: THRESHOLDS,
          swapFreeBytes: 2 * GIB,
          swapTotalBytes: 8 * GIB,
          psiSomeAvg10: 0.12,
          psiFullAvg10: null,
        }),
        readWatchReserveBytes: () => 12 * GIB,
        readSoftReserveBytes: () => 8 * GIB,
        readHardReserveBytes: () => 4 * GIB,
        readRecoveryReserveBytes: () => 16 * GIB,
        readPsiCalmConfig: () => ({ readmitAvg10: 0.05, windowMs: 600_000 }),
        emit: (entry) => emitted.push(entry),
      });

      expect(emitted[0].details).toContain('Swap: 2.0 GiB free of 8.0 GiB');
      expect(emitted[0].details).toContain(
        'PSI some avg10: 0.12 | full avg10: unavailable (pressure stall data not readable)',
      );
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
